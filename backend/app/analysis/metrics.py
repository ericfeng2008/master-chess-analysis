"""Metric computation functions for chess position analysis.

Provides the core computation routines used by the analysis pipeline:
- ``compute_cti``: Critical Tension Index -- measures how hard a position is
  for a human to play correctly by combining Stockfish multi-PV evaluation
  with Maia human-move-prediction probabilities.
- ``populate_eval_after``: Post-processing pass that fills in post-move evals
  and mate-in values using the ``eval_after[i] = stockfish_eval[i+1]`` convention.
"""

import chess
from collections.abc import Sequence

from app.config import DEFAULT_MAIA3_ELO
from app.engines.maia3_client import Maia3Client
from app.engines.stockfish_client import StockfishClient
from app.analysis.data_models import (
    AnalysisMoveData,
    CTIResult,
    CTI_POLICY_COVERAGE,
    MIN_ANALYSIS_DEPTH,
    PROBE_DEPTH,
)
from app.analysis.diagnostics import diagnostic_stage
from app.analysis.evaluation import terminal_eval_white


MaiaPolicyCacheKey = tuple[str, bool, int, int, str, tuple[str, ...]]
MaiaPolicyCache = dict[MaiaPolicyCacheKey, dict[chess.Move, float]]


def _maia_elos_for_position(
    board: chess.Board,
    white_elo: int,
    black_elo: int,
) -> tuple[int, int]:
    """Return Maia3 self/opponent Elo values for the current side to move."""
    if board.turn == chess.WHITE:
        return int(white_elo), int(black_elo)
    return int(black_elo), int(white_elo)


def _predict_maia(
    board: chess.Board,
    maia: Maia3Client,
    cache: MaiaPolicyCache | None = None,
    maia3_white_elo: int = DEFAULT_MAIA3_ELO,
    maia3_black_elo: int = DEFAULT_MAIA3_ELO,
    history_fens: Sequence[str] | None = None,
) -> dict[chess.Move, float]:
    """Return Maia policy, reusing per-analysis predictions when provided."""
    self_elo, opponent_elo = _maia_elos_for_position(
        board,
        maia3_white_elo,
        maia3_black_elo,
    )
    if cache is None:
        return maia.predict(
            board,
            self_elo=self_elo,
            opponent_elo=opponent_elo,
            history_fens=history_fens,
        )

    history_key = tuple(history_fens) if history_fens is not None else (board.fen(),)
    key: MaiaPolicyCacheKey = (
        maia.model_name,
        maia.use_history,
        self_elo,
        opponent_elo,
        board.fen(),
        history_key,
    )
    policy = cache.get(key)
    if policy is None:
        policy = maia.predict(
            board,
            self_elo=self_elo,
            opponent_elo=opponent_elo,
            history_fens=history_fens,
        )
        cache[key] = policy
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


# CTI: Critical Tension Index

def compute_cti(
    board: chess.Board,
    stockfish: StockfishClient,
    maia: Maia3Client,
    acceptable_drop: float = 0.5,
    prev_eval: float | None = None,
    full_depth: int = 18,
    maia_policy_cache: MaiaPolicyCache | None = None,
    maia3_white_elo: int = DEFAULT_MAIA3_ELO,
    maia3_black_elo: int = DEFAULT_MAIA3_ELO,
    history_fens: Sequence[str] | None = None,
    played_move: chess.Move | None = None,
    minefield_threshold: float | None = None,
) -> CTIResult | None:
    """Compute the Critical Tension Index for a position.

    CTI = 1 - sum(maia_probability for each move in set S)

    where set S is the set of moves whose Stockfish eval is within
    ``acceptable_drop`` pawns of the best move's eval. High CTI means
    humans are unlikely to find a good move. CTI applies regardless of
    who is winning -- a position at +5.0 can still be a minefield if only
    one capture among many is correct.

    Stockfish evaluates its unrestricted best root plus the smallest prefix of
    Maia moves covering ``CTI_POLICY_COVERAGE`` probability. The unevaluated
    policy tail is represented as a formal CTI interval. If that interval can
    change minefield classification, additional roots are evaluated in Maia
    probability order until the classification is unambiguous.

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

    # ----- Eval estimate for depth selection -----
    # Use carry-forward eval from the previous position if available;
    # otherwise run a quick shallow search as the Phase 1 probe.
    eval_estimate = prev_eval if prev_eval is not None else stockfish.quick_evaluate(board, depth=PROBE_DEPTH)

    # ----- Depth triage: reduce depth for lopsided positions -----
    analysis_depth = _select_depth(eval_estimate, full_depth)

    with diagnostic_stage("maia_inference"):
        policy = _predict_maia(
            board,
            maia,
            maia_policy_cache,
            maia3_white_elo=maia3_white_elo,
            maia3_black_elo=maia3_black_elo,
            history_fens=history_fens,
        )
    if not policy:
        return None

    sorted_policy = sorted(
        ((move, prob) for move, prob in policy.items() if move in board.legal_moves),
        key=lambda item: item[1],
        reverse=True,
    )
    if not sorted_policy:
        return None

    with diagnostic_stage("cti_best"):
        best_result = stockfish.evaluate_best_move(board, depth=analysis_depth)
    if best_result is None:
        return None
    best_move_obj, best_eval, best_pv, best_mate = best_result

    candidate_moves: list[chess.Move] = []
    candidate_set: set[chess.Move] = set()
    cumulative = 0.0
    for candidate, probability in sorted_policy:
        candidate_moves.append(candidate)
        candidate_set.add(candidate)
        cumulative += probability
        if cumulative >= CTI_POLICY_COVERAGE:
            break

    # These roots are required by best-line/BRI, EIG, and MBI respectively.
    required_moves = [best_move_obj, sorted_policy[0][0]]
    if played_move is not None:
        required_moves.append(played_move)
    for required in required_moves:
        if required in board.legal_moves and required not in candidate_set:
            candidate_moves.append(required)
            candidate_set.add(required)

    def evaluate_candidates(
        moves: Sequence[chess.Move],
        stage: str,
    ) -> dict[chess.Move, tuple[float, list[chess.Move], int | None]]:
        with diagnostic_stage(stage):
            results = stockfish.evaluate_root_moves(board, list(moves), depth=analysis_depth)
            # UCI engines should return every requested root. Preserve a complete
            # uncertainty accounting even if an individual MultiPV line is absent.
            for missing in moves:
                if missing not in results:
                    results[missing] = stockfish.evaluate_move(board, missing, depth=analysis_depth)
        return results

    evaluated = evaluate_candidates(candidate_moves, "cti_candidates")
    # Preserve the unrestricted best search as the objective baseline and PV.
    evaluated[best_move_obj] = (best_eval, best_pv, best_mate)

    def summarize() -> tuple[list[chess.Move], float, float, float, float]:
        good = [
            candidate
            for candidate, (evaluation, _pv, _mate) in evaluated.items()
            if best_eval - evaluation <= acceptable_drop
        ]
        good_probability = sum(policy.get(candidate, 0.0) for candidate in good)
        remaining_probability = sum(
            probability for candidate, probability in sorted_policy if candidate not in evaluated
        )
        lower = max(0.0, min(1.0, 1.0 - good_probability - remaining_probability))
        upper = max(0.0, min(1.0, 1.0 - good_probability))
        return good, lower, upper, remaining_probability, (lower + upper) / 2.0

    good_moves, lower_bound, upper_bound, remaining_mass, cti = summarize()

    # Refine only when the uncertainty could change minefield classification.
    if minefield_threshold is not None:
        remaining_moves = [move for move, _prob in sorted_policy if move not in evaluated]
        while lower_bound < minefield_threshold <= upper_bound and remaining_moves:
            batch = remaining_moves[:3]
            remaining_moves = remaining_moves[3:]
            new_results = evaluate_candidates(batch, "cti_refinement")
            evaluated.update(new_results)
            good_moves, lower_bound, upper_bound, remaining_mass, cti = summarize()

    exact = remaining_mass <= 1e-12
    if exact:
        remaining_mass = 0.0
        lower_bound = upper_bound = cti

    all_evals = {move: result[0] for move, result in evaluated.items()}

    return CTIResult(
        cti=max(0.0, min(1.0, cti)),
        cti_lower_bound=lower_bound,
        cti_upper_bound=upper_bound,
        cti_remaining_mass=remaining_mass,
        cti_is_approximate=not exact,
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
    positions: list[tuple[chess.Board, chess.Move, int, str, tuple[str, ...]]],
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
    last_board, last_move, _last_move_number, _last_side, _last_history_fens = positions[-1]
    final_board = last_board.copy()
    final_board.push(last_move)

    terminal_eval = terminal_eval_white(final_board)
    if terminal_eval is not None:
        final_eval_white = terminal_eval
        final_mate_white: int | None = 0 if final_board.is_checkmate() else None
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
