"""Game analysis orchestrator for the Master Chess Game Analyzer.

Parses a PGN game and walks through every position, computing a suite of
metrics for each move:
- CTI (Critical Tension Index) -- how hard the position is for a human
- MBI (Master Blunder Index) -- classifies blunders by Maia probability
- EIG (Engine-Intuition Gap) -- divergence between engine and human top-choice
- BRI (Brilliancy Score) -- engine-best moves that humans rarely find
- EPE (Expected Practical Evaluation) -- probability-weighted 1-ply lookahead

Results are streamed as Server-Sent Events: periodic AnalysisProgressEvent
updates during processing, and a final AnalysisCompleteEvent with the
full results.
"""

from typing import Generator
import chess
import chess.pgn

from app.engines.maia_client import MaiaClient
from app.engines.stockfish_client import StockfishClient
from app.analysis.data_models import (
    AnalysisCompleteEvent,
    AnalysisMoveData,
    AnalysisProgressEvent,
    SKIP_EVAL_THRESHOLD,
)
from app.analysis.metrics import compute_cti, compute_epe, populate_eval_after
from app.pgn_utils import normalize_pgn_for_python_chess


def analyze_game(
    pgn_text: str,
    stockfish: StockfishClient,
    maia: MaiaClient,
    acceptable_drop: float = 0.5,
    minefield_threshold: float = 0.80,
    blunder_threshold: float = 1.0,
    mbi_trap_threshold: float = 0.40,
    mbi_outlier_threshold: float = 0.05,
    eig_threshold: float = 2.0,
    bri_threshold: float = 0.05,
) -> Generator[AnalysisProgressEvent | AnalysisCompleteEvent, None, None]:
    """Analyze every position in a PGN game, yielding SSE-streaming events.

    Walks through the mainline of the game move-by-move. For each position,
    computes CTI (via ``compute_cti``), then derives MBI, EIG, BRI, and EPE
    from the CTI result's engine evals and Maia policy. Positions that are
    heavily lopsided (|eval| >= SKIP_EVAL_THRESHOLD) get a lightweight
    pass with no full analysis.

    Progress events are emitted every 5 moves and on the last move. A final
    complete event carries the full results list and minefield indices.

    Args:
        pgn_text: Complete PGN text of the game to analyze.
        stockfish: Stockfish engine client (shared singleton).
        maia: Maia engine client (shared singleton).
        acceptable_drop: Max eval drop (pawns) for a move to be in set S
            (used by CTI). Default 0.5.
        minefield_threshold: CTI value above which a position has a minefield.
            Default 0.80.
        blunder_threshold: Eval-drop (pawns) to classify a move as a blunder
            for MBI-analysis. Default 1.0.
        mbi_trap_threshold: Maia probability above which a blunder is a
            "cognitive trap" (human-natural bad move). Default 0.40.
        mbi_outlier_threshold: Maia probability below which a blunder is a
            "random oversight" (move humans almost never consider). Default 0.05.
        eig_threshold: EIG value (pawns) above which a position is flagged
            for engine-intuition divergence. Default 2.0.
        bri_threshold: Maia probability below which the engine's best move
            is considered brilliant (good but hard for humans to find).

    Yields:
        AnalysisProgressEvent updates during processing.
        AnalysisCompleteEvent with all results.
    """
    import io

    pgn_io = io.StringIO(normalize_pgn_for_python_chess(pgn_text))
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        yield AnalysisCompleteEvent(moves=[], minefields=[])
        return

    # ----- Walk the mainline and collect (board, move, move_number, side) tuples -----
    positions: list[tuple[chess.Board, chess.Move, int, str]] = []
    node = game
    half_move = 0
    while node.variations:
        next_node = node.variations[0]
        board = node.board()
        move = next_node.move
        move_number = half_move // 2 + 1
        side = "white" if board.turn == chess.WHITE else "black"
        positions.append((board.copy(), move, move_number, side))
        node = next_node
        half_move += 1

    total = len(positions)
    move_results: list[AnalysisMoveData] = []
    minefields: list[int] = []

    # prev_eval carries the eval from one position to the next to avoid
    # redundant Phase-1 probes. It is stored from the NEXT side-to-move's
    # perspective (negated after each position).
    prev_eval: float | None = None

    # Mate-in-N values (side-to-move perspective) for the post-processing pass
    mate_stm_per_pos: list[int | None] = []

    # Reuse Maia policy calls across CTI and EPE. The post-move board used by
    # EPE is commonly the next loop iteration's pre-move board.
    maia_policy_cache: dict[str, dict[chess.Move, float]] = {}

    for idx, (board, move, move_number, side) in enumerate(positions):
        is_white = side == "white"

        # Core CTI computation (also provides engine-evals and Maia policy
        # needed for all other metrics)
        result = compute_cti(
            board,
            stockfish,
            maia,
            acceptable_drop=acceptable_drop,
            prev_eval=prev_eval,
            full_depth=stockfish.depth,
            maia_policy_cache=maia_policy_cache,
        )

        if result is not None:
            # ----- Eval perspective normalization -----
            # result.best_eval is from side-to-move perspective.
            # We normalize to White's perspective for storage:
            # if Black to move, negate the eval.
            stm_eval = result.best_eval
            stm_mate = result.best_mate
            white_eval = stm_eval if is_white else -stm_eval

            if stm_mate is not None:
                white_mate = stm_mate if is_white else -stm_mate
            else:
                white_mate = None

            # Carry forward prev_eval for the next position (opponent's perspective)
            prev_eval = -stm_eval

            is_minefield = result.cti is not None and result.cti >= minefield_threshold

            best_move_obj = max(result.all_evals, key=result.all_evals.get)
            # SAN map for good moves together with their eval drop from best (for UI display)
            good_moves_eval = {
                board.san(m): round(result.all_evals[m] - result.best_eval, 2)
                for m in result.good_moves
            }

            # ----- MBI: Master Blunder Index -----
            # Classifies blunders by how "human-natural" they are using
            # Maia-probability of the played move.
            mbi_classification = None
            mbi_maia_prob = None

            played_move_eval = result.all_evals.get(move)
            if played_move_eval is not None:
                eval_drop = result.best_eval - played_move_eval
            else:
                # Played move not in multi-PV results (rare, happens when
                # adaptive MultiPV didn't include it). Use a pessimistic
                # estimate: worst eval in the set + 0.5 pawn penalty.
                eval_drop = result.best_eval - min(result.all_evals.values()) + 0.5

            if eval_drop >= blunder_threshold:
                maia_prob_for_played = result.maia_policy.get(move, 0.0)
                mbi_maia_prob = round(maia_prob_for_played, 4)
                if maia_prob_for_played >= mbi_trap_threshold:
                    # Cognitive trap: Maia thinks humans would very likely play it.
                    mbi_classification = "cognitive_trap"
                elif maia_prob_for_played <= mbi_outlier_threshold:
                    # Very unlikely human move under pressure.
                    mbi_classification = "random_oversight"
                else:
                    mbi_classification = "unclassified_blunder"

            # ----- EIG: Engine-Intuition Gap -----
            # Measures how far apart the engine's best move and Maia's
            # top-predicted human move are in eval terms.
            eig_value = None
            is_eig_flagged = False
            if result.maia_policy:
                maia_top_move = max(result.maia_policy, key=result.maia_policy.get)
                maia_top_eval = result.all_evals.get(maia_top_move)

                if maia_top_eval is None:
                    # Maia's top move wasn't in the multi-PV set -- evaluate it separately.
                    temp_board = board.copy()
                    temp_board.push(maia_top_move)
                    if temp_board.is_game_over():
                        maia_top_eval = 0.0
                    else:
                        # Negate because quick_evaluate returns from stm
                        # perspective of the resulting position, but we need
                        # perspective of the current position.
                        maia_top_eval = -stockfish.quick_evaluate(temp_board)

                eig_value = round(abs(result.best_eval - maia_top_eval), 2)
                if eig_value >= eig_threshold:
                    is_eig_flagged = True

            # ----- BRI: Brilliancy Score -----
            # A move is "brilliant" if it is objectively the best move
            # AND Maia assigns it very low probability (humans rarely find it).
            is_brilliant = False
            bri_maia_prob = None
            if move == best_move_obj:
                played_maia_prob = result.maia_policy.get(move, 0.0)
                bri_maia_prob = round(played_maia_prob, 4)
                if played_maia_prob < bri_threshold:
                    is_brilliant = True

            # ----- EPE: Expected Practical Evaluation -----
            # For heavily lopsided positions, skip the expensive 1-ply
            # lookahead and just use the raw eval (result is obvious).
            board_after = board.copy()
            board_after.push(move)
            if abs(white_eval) >= SKIP_EVAL_THRESHOLD:
                epe_score = round(white_eval, 2)
            else:
                epe_score = compute_epe(
                    board_after,
                    stockfish,
                    maia,
                    maia_policy_cache=maia_policy_cache,
                )

            # Convert PV moves to SAN notation, stopping at 6 moves or
            # if a move is no-longer legal (can happen with hash collisions).
            best_line: list[str] = []
            best_line_evals: dict[str, dict] = {}
            pv_board = board.copy()
            for pv_move in result.best_pv[:6]:
                if pv_move in pv_board.legal_moves:
                    best_line.append(pv_board.san(pv_move))
                    pv_board.push(pv_move)
                else:
                    break

            # Pre-compute evals for each variation position so the UI can
            # display variation info instantly without on-demand API calls.
            # We use cheap shallow searches here to avoid slowing down batch analysis:
            # - Post-move quick_evaluate (depth 10) for eval + mate in
            # - Pre-move evaluate_position at reduced depth (10) for best_move/good_moves context
            VARIATION_EVAL_DEPTH = 10
            var_board = board.copy()
            for _vi, pv_move in enumerate(result.best_pv[: len(best_line)]):
                pre_board = var_board.copy()
                var_board.push(pv_move)
                post_fen = var_board.fen()

                if var_board.is_game_over():
                    best_line_evals[post_fen] = {
                        "eval": 0.0,
                        "best_move": "",
                        "good_moves": [],
                        "good_moves_with_eval": {},
                        "mate_in": None,
                    }
                    continue

                # Cheap post-move eval (single PV, low-depth)
                post_eval, post_mate = stockfish.quick_evaluate_with_mate(
                    var_board, depth=VARIATION_EVAL_DEPTH
                )
                is_white_to_move = var_board.turn == chess.WHITE
                white_post_eval = post_eval if is_white_to_move else -post_eval
                white_post_mate = (
                    post_mate if is_white_to_move else -post_mate
                    if post_mate is not None else None
                )

                # Pre-move eval at reduced depth for best_move/good_moves
                pre_result = stockfish.evaluate_position(
                    pre_board, depth=VARIATION_EVAL_DEPTH,
                    acceptable_drop=acceptable_drop,
                )

                best_line_evals[post_fen] = {
                    "eval": round(white_post_eval, 2),
                    "best_move": pre_result["best_move"],
                    "good_moves": pre_result["good_moves"],
                    "good_moves_with_eval": pre_result["good_moves_with_eval"],
                    "mate_in": white_post_mate,
                }

            move_data = AnalysisMoveData(
                move_number=move_number,
                side=side,
                move=board.san(move),
                fen=board.fen(),
                stockfish_eval=round(white_eval, 2),
                eval_after=0.0,  # populated in post-processing pass
                cti=result.cti,
                best_move=board.san(best_move_obj),
                good_moves=[board.san(m) for m in result.good_moves],
                good_moves_with_eval=good_moves_eval,
                is_minefield=is_minefield,
                mbi_classification=mbi_classification,
                mbi_maia_prob=mbi_maia_prob,
                eig_value=eig_value,
                is_eig_flagged=is_eig_flagged,
                is_brilliant=is_brilliant,
                bri_maia_prob=bri_maia_prob,
                epe_score=epe_score,
                best_line=best_line,
                best_line_evals=best_line_evals,
                mate_in=None,  # populated in post-processing pass
            )
            mate_stm_per_pos.append(stm_mate)
        else:
            # ----- Skipped position -----
            # game over, forced move, or tablebase territory.
            # We still need eval and mate for continuity.
            if board.is_game_over():
                stm_eval = 0.0
                stm_mate = None
            else:
                stm_eval, stm_mate = stockfish.quick_evaluate_with_mate(board)

            # Carry forward prev_eval for the next position.
            # If we already had a prev_eval from the last analyzed position,
            # just negate it (opponent's perspective). Otherwise use this
            # position's quick-eval.
            if prev_eval is not None:
                prev_eval = -prev_eval
            else:
                prev_eval = -stm_eval

            # Normalize eval to White's perspective
            white_eval = stm_eval if is_white else -stm_eval

            move_data = AnalysisMoveData(
                move_number=move_number,
                side=side,
                move=board.san(move) if not board.is_game_over() else move.uci(),
                fen=board.fen(),
                stockfish_eval=round(white_eval, 2),
                eval_after=0.0,  # populated in post-processing pass
                cti=None,
                best_move=None,
                good_moves=[],
                good_moves_with_eval={},
                is_minefield=False,
                mbi_classification=None,
                mbi_maia_prob=None,
                eig_value=None,
                is_eig_flagged=False,
                is_brilliant=False,
                bri_maia_prob=None,
                epe_score=None,
                best_line=[],
                best_line_evals={},
                mate_in=None,
            )
            mate_stm_per_pos.append(stm_mate)
            is_minefield = False

        move_results.append(move_data)

        if is_minefield:
            minefields.append(len(move_results) - 1)

        # Emit progress events every 5 moves and on the final move
        if (idx + 1) % 5 == 0 or idx == total - 1:
            yield AnalysisProgressEvent(idx + 1, total, len(minefields))

    # ----- Post-processing: fill in eval_after and mate_in -----
    # eval_after[i] = stockfish_eval[i+1] (Lichess convention).
    # The last move's eval_after requires a separate Stockfish evaluation
    # of the final position.
    populate_eval_after(move_results, mate_stm_per_pos, positions, stockfish)

    yield AnalysisCompleteEvent(moves=move_results, minefields=minefields)
