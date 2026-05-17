"""Metric computation functions for chess position analysis.

Provides the core computation routines used by the analysis pipeline:
- ``compute_cti``: Critical Tension Index -- measures how hard a position is
  for a human to play correctly by combining Stockfish multi-PV evaluation
  with Maia human-move-prediction probabilities.
- ``compute_epe``: Expected Practical Evaluation -- 1-ply lookahead that
  weights each candidate reply by its Maia probability to estimate what
  evaluation can realistically be expected.
- ``populate_eval_after``: Post-processing pass that fills in post-move evals
  and mate-in values using the ``eval_after[i] = stockfish_eval[i+1]`` convention.
"""

import chess

from app.engines.maia_client import MaiaClient
from app.engines.stockfish_client import StockfishClient
from app.analysis.data_models import (
    AnalysisMoveData,
    CTIResult,
    MIN_ANALYSIS_DEPTH,
    PROBE_DEPTH,
    EPE_CUMULATIVE_CUTOFF,
    EPE_MAX_MOVES,
)


MaiaPolicyCache = dict[str, dict[chess.Move, float]]


def _predict_maia(
    board: chess.Board,
    maia: MaiaClient,
    cache: MaiaPolicyCache | None = None,
) -> dict[chess.Move, float]:
    """Return Maia policy, reusing per-analysis predictions when provided."""
    if cache is None:
        return maia.predict(board)

    fen = board.fen()
    policy = cache.get(fen)
    if policy is None:
        policy = maia.predict(board)
        cache[fen] = policy
    return policy


# Depth-selection (eval-based triage)
def _select_depth(eval_estimate: float, full_depth: int) -> int:
    """Choose analysis depth based on how lopsided the position is.

    Positions that are already decided (large eval advantage or forced mate)
    don't need full-depth search -- we reduce depth to save time while still
    meeting the MIN_ANALYSIS_DEPTH floor.

    Args:
        eval_estimate: Estimated evaluation from side-to-move perspective.
            Absolute values >= 100 indicate a forced mate.
        full_depth: The configured full-analysis depth (e.g. 18).

    Returns:
        The depth to use for this position's multi-PV search.
    """
    abs_eval = abs(eval_estimate)

    if abs_eval >= 100.0:  # mate -- minimal depth needed
        return max(MIN_ANALYSIS_DEPTH, full_depth - 8)
    elif abs_eval >= 5.0:  # winning (piece+ advantage)
        return max(MIN_ANALYSIS_DEPTH, full_depth - 6)
    elif abs_eval >= 2.0:  # clear positional/material advantage
        return max(MIN_ANALYSIS_DEPTH, full_depth - 4)
    else:  # balanced or tense -- use full depth for accuracy
        return full_depth


# EPE: Expected Practical Evaluation

def compute_epe(
    board_after_move: chess.Board,
    stockfish: StockfishClient,
    maia: MaiaClient,
    maia_policy_cache: MaiaPolicyCache | None = None,
) -> float | None:
    """Compute the Expected Practical Evaluation for a position.

    EPE performs a 1-ply lookahead from the given position: it asks Maia
    which moves a human would most likely play, evaluates each with
    Stockfish, and returns the probability-weighted average evaluation.

    The intuition is: "Given that the opponent is human (not an engine),
    what evaluation can we realistically expect after their reply?"

    Move-selection:
      Candidate moves are taken from Maia's policy in descending
      probability order. Selection stops when either:
      - Cumulative probability reaches EPE_CUMULATIVE_CUTOFF (0.95), or
      - EPE_MAX_MOVES (5) candidates have been collected.

    Residual-probability:
      Any probability mass not covered by selected moves is assigned
      the worst-case eval among the selected moves. This is conservative:
      if 5% of the time the opponent plays an unknown move, we assume
      it's as bad (for the opponent) as the worst selected move.

    "Worst-case" direction depends on side-to-move: for White, the
    worst eval is the minimum; for Black, the worst eval is the maximum
    (since evals are from White's perspective).

    All evaluations are normalized to White's perspective.

    Args:
        board_after_move: The position to evaluate (after a move has been played).
        stockfish: Stockfish engine client.
        maia: Maia engine client for human move prediction.

    Returns:
        The EPE score (from White's perspective), or None if the position
        should be skipped.
    """
    if board_after_move.is_game_over():
        return None

    # Get Maia's prediction of what a human would play here
    policy = _predict_maia(board_after_move, maia, maia_policy_cache)
    if not policy:
        return None

    # ----- Select candidate moves by descending Maia-probability -----
    sorted_moves = sorted(policy.items(), key=lambda x: x[1], reverse=True)
    selected: list[tuple[chess.Move, float]] = []
    cumulative = 0.0
    for move, prob in sorted_moves:
        if len(selected) >= EPE_MAX_MOVES:
            break
        selected.append((move, prob))
        cumulative += prob
        # Stop once we cover enough of the probability mass
        if cumulative >= EPE_CUMULATIVE_CUTOFF:
            break

    if not selected:
        return None

    # ----- Evaluate each candidate move with Stockfish -----
    evals: list[tuple[float, float]] = []  # (probability, white_eval) pairs
    for move, prob in selected:
        temp_board = board_after_move.copy()
        temp_board.push(move)

        if temp_board.is_game_over():
            white_eval = 0.0  # draw or stalemate
        else:
            # Stockfish returns eval from side-to-move perspective;
            # negate for Black so all evals are from White's perspective.
            stm_eval = stockfish.quick_evaluate(temp_board)
            white_eval = stm_eval if temp_board.turn == chess.WHITE else -stm_eval

        evals.append((prob, white_eval))

    # ----- Handle residual probability (unselected moves) -----
    selected_prob = sum(prob for prob, _ in evals)
    residual_prob = max(0.0, 1.0 - selected_prob)

    # Worst-case eval direction depends on who is to move:
    # White to move: worst-case is the lowest eval (opponent minimizing)
    # Black to move: worst-case is the highest eval (opponent maximizing)
    is_white_to_move = board_after_move.turn == chess.WHITE
    if is_white_to_move:
        worst_eval = min(ev for _, ev in evals)
    else:
        worst_eval = max(ev for _, ev in evals)

    # ----- Compute probability-weighted average -----
    weighted_sum = sum(prob * ev for prob, ev in evals)
    if residual_prob > 0:
        # Assign residual mass to worst-case eval (conservative estimate)
        weighted_sum += residual_prob * worst_eval

    return round(weighted_sum, 2)


# CTI: Critical Tension Index

def compute_cti(
    board: chess.Board,
    stockfish: StockfishClient,
    maia: MaiaClient,
    acceptable_drop: float = 0.5,
    prev_eval: float | None = None,
    full_depth: int = 18,
    maia_policy_cache: MaiaPolicyCache | None = None,
) -> CTIResult | None:
    """Compute the Critical Tension Index for a position.

    CTI = 1 - sum(maia_probability for each move in set S)

    where set S is the set of moves whose Stockfish eval is within
    ``acceptable_drop`` pawns of the best move's eval. High CTI means
    humans are unlikely to find a good move. CTI applies regardless of
    who is winning -- a position at +5.0 can still be a minefield if only
    one capture among many is correct.

    The function uses density-based adaptive MultiPV (two-phase approach):
      1. Phase 1 (Probe): Cheap shallow search to see how top moves cluster.
         Skipped when ``prev_eval`` is provided (carry-forward from prior position).
      2. Phase 2 (Full-depth): MultiPV is right-sized based on probe clustering.

    Positions with <= 6 pieces (endgame tablebases territory) or only one
    legal move are skipped (returns None).

    Args:
        board: The position to analyze (before the move is played).
        stockfish: Stockfish engine client for multi-PV evaluation.
        maia: Maia engine client for human-move prediction.
        acceptable_drop: Maximum eval drop (in pawns) from best for a move
            to be considered "good" (member of set S). Default 0.5.
        prev_eval: Eval estimate from the previous position (negated, so from
            current side-to-move perspective). If provided, the Phase-1
            probe is skipped and this value is used for depth selection
            and as the probe_eval for evaluate_all_moves.
        full_depth: The configured full-analysis depth.

    Returns:
        A CTIResult with all computed data, or None if the position should
        be skipped (game over, forced move, or endgame tablebase territory).
    """
    if board.is_game_over():
        return None

    legal_moves = list(board.legal_moves)
    if len(legal_moves) <= 1:
        # Only one legal move -- no decision to make, CTI is meaningless
        return None

    # Skip endgame tablebase territory (6 or fewer pieces on the board)
    if len(board.piece_map()) <= 6:
        return None

    # ----- Eval estimate for depth selection and MultiPV probe -----
    # Use carry-forward eval from the previous position if available;
    # otherwise run a quick shallow search as the Phase 1 probe.
    eval_estimate = prev_eval if prev_eval is not None else stockfish.quick_evaluate(board, depth=PROBE_DEPTH)

    # ----- Depth triage: reduce depth for lopsided positions -----
    analysis_depth = _select_depth(eval_estimate, full_depth)

    # ----- Density-based adaptive MultiPV evaluation -----
    # evaluate_all_moves uses the probe_eval to right-size MultiPV:
    # it counts how many probe moves cluster within acceptable_drop + 0.3
    # (safety margin) of the best, then uses that count for full-depth search.
    all_evals_with_pv, _ = stockfish.evaluate_all_moves(
        board, acceptable_drop=acceptable_drop, depth=analysis_depth, probe_eval=eval_estimate
    )
    if not all_evals_with_pv:
        return None

    # Extract just the eval values for convenience
    all_evals = {m: ev for m, (ev, _pv, _mate) in all_evals_with_pv.items()}
    best_move_obj = max(all_evals, key=all_evals.get)
    best_eval = all_evals[best_move_obj]
    best_pv = all_evals_with_pv[best_move_obj][1]
    best_mate = all_evals_with_pv[best_move_obj][2]

    # ----- Compute set S: moves within acceptable_drop of the best move -----
    good_moves = [move for move, ev in all_evals.items() if best_eval - ev <= acceptable_drop]
    if not good_moves:
        # Edge case: no moves within acceptable_drop (shouldn't normally happen
        # since the best move itself should qualify). CTI = 1.0 (maximum difficulty).
        policy = _predict_maia(board, maia, maia_policy_cache)
        return CTIResult(
            cti=1.0,
            good_moves=[],
            best_eval=best_eval,
            best_mate=best_mate,
            all_evals=all_evals,
            maia_policy=policy,
            best_pv=best_pv,
        )

    # ----- Sum Maia probabilities for moves in set S -----
    policy = _predict_maia(board, maia, maia_policy_cache)
    prob_sum = sum(policy.get(move, 0.0) for move in good_moves)

    # CTI = 1 - P(human plays a good move). Clamped to [0, 1].
    cti = 1.0 - prob_sum

    return CTIResult(
        cti=round(max(0.0, min(1.0, cti)), 4),
        good_moves=good_moves,
        best_eval=best_eval,
        best_mate=best_mate,
        all_evals=all_evals,
        maia_policy=policy,
        best_pv=best_pv,
    )


# Post-processing: eval_after and mate_in population

def populate_eval_after(
    move_results: list[AnalysisMoveData],
    mate_stm_per_pos: list[int | None],
    positions: list[tuple[chess.Board, chess.Move, int, str]],
    stockfish: StockfishClient,
) -> None:
    """Fill in ``eval_after`` and ``mate_in`` fields on move-results.

    The convention is: ``eval_after[i] = stockfish_eval[i+1]``. That is, the
    post-move eval for move i is the pre-move eval of the next position.
    This matches Lichess behavior -- when you click on a move, you see the
    resulting position's evaluation.

    For the last move in the game, there is no "next position", so a separate
    quick_evaluate is run on the final position.

    Mate normalization: ``mate_stm_per_pos`` stores mate-in-N from the
    side-to-move perspective. This function converts to White's perspective:
      - If White just moved (side == "white"), the next position has Black to
        move, so we negate the mate value.
      - If Black just moved (side == "black"), the next position has White to
        move, so the mate value is already from White's perspective.

    Args:
        move_results: The list of AnalysisMoveData to mutate in-place.
        mate_stm_per_pos: Mate-in-N values (side-to-move perspective) for
            each position, parallel to move_results.
        positions: The (board, move, move_number, side) tuples for each position.
        stockfish: Stockfish engine client for evaluating the final position.
    """
    # ----- Shift eval forward: eval_after[i] = stockfish_eval[i+1] -----
    for i in range(len(move_results) - 1):
        move_results[i].eval_after = move_results[i + 1].stockfish_eval

        # Convert next position's mate-in-N from side-to-move to White's perspective
        next_mate_stm = mate_stm_per_pos[i + 1]
        if next_mate_stm is not None:
            # If move i was White's move, next position's stm is Black -> negate
            # If move i was Black's move, next position's stm is White -> keep
            move_results[i].mate_in = -next_mate_stm if move_results[i].side == "white" else next_mate_stm
        else:
            move_results[i].mate_in = None

    if not move_results:
        return

    # ----- Evaluate the final position for the last move's eval_after -----
    last_board, last_move, _last_move_number, _last_side = positions[-1]
    final_board = last_board.copy()
    final_board.push(last_move)

    if final_board.is_game_over():
        final_eval_white = 0.0
        final_mate_white: int | None = None
        if final_board.is_checkmate():
            # Side to move is checkmated, so White mates iff Black is to move.
            final_mate_white = 0 if final_board.turn == chess.BLACK else 0
    else:
        final_stm, final_mate_stm = stockfish.quick_evaluate_with_mate(final_board)
        # Normalize from side-to-move to White's perspective
        is_white_to_move = final_board.turn == chess.WHITE
        final_eval_white = final_stm if is_white_to_move else -final_stm
        if final_mate_stm is not None:
            final_mate_white = final_mate_stm if is_white_to_move else -final_mate_stm
        else:
            final_mate_white = None

    move_results[-1].eval_after = round(final_eval_white, 2)
    move_results[-1].mate_in = final_mate_white
