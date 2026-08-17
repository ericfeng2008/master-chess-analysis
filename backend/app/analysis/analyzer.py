"""Game analysis orchestrator for the Master Chess Game Analyzer.

Parses a PGN game and walks through every position, computing a suite of
metrics for each move:
- CTI (Critical Tension Index) -- how hard the position is for a human
- MBI (Master Blunder Index) -- classifies blunders by Maia probability
- EIG (Engine-Intuition Gap) -- divergence between engine and human top-choice
- BRI (Brilliancy Score) -- engine-best moves that humans rarely find

Results are streamed as Server-Sent Events: periodic AnalysisProgressEvent
updates during processing, and a final AnalysisCompleteEvent with the
full results.
"""

from typing import Generator
import chess
import chess.pgn

from app.config import DEFAULT_MAIA3_ELO
from app.engines.maia3_client import Maia3Client
from app.engines.stockfish_client import StockfishClient
from app.analysis.data_models import (
    AnalysisCompleteEvent,
    AnalysisMoveData,
    AnalysisProgressEvent,
)
from app.analysis.diagnostics import diagnostic_stage
from app.analysis.metrics import (
    MaiaPolicyCache,
    compute_cti,
    evaluate_timeline_position,
    populate_eval_after,
)
from app.pgn_utils import normalize_pgn_for_python_chess


def analyze_game(
    pgn_text: str,
    stockfish: StockfishClient,
    maia: Maia3Client,
    acceptable_drop: float = 0.3,
    minefield_threshold: float = 0.80,
    blunder_threshold: float = 1.0,
    mbi_trap_threshold: float = 0.40,
    mbi_outlier_threshold: float = 0.05,
    eig_threshold: float = 2.0,
    bri_threshold: float = 0.05,
    maia3_white_elo: int = DEFAULT_MAIA3_ELO,
    maia3_black_elo: int = DEFAULT_MAIA3_ELO,
    analysis_scope: str = "both",
    initial_moves: list[AnalysisMoveData] | None = None,
    initial_minefields: list[int] | None = None,
    start_index: int = 0,
) -> Generator[AnalysisProgressEvent | AnalysisCompleteEvent, None, None]:
    """Analyze every position in a PGN game, yielding SSE-streaming events.

    Walks through the mainline of the game move-by-move. For each position,
    computes CTI (via ``compute_cti``), then derives MBI, EIG, and BRI
    from the CTI result's engine evals and Maia policy. Positions that are
    Positions with forced moves, terminal states, or tablebase-sized material
    get a lightweight pass with no full CTI analysis.

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

    if analysis_scope not in {"both", "white", "black"}:
        raise ValueError("analysis_scope must be both, white, or black")

    pgn_io = io.StringIO(normalize_pgn_for_python_chess(pgn_text))
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        yield AnalysisCompleteEvent(moves=[], minefields=[])
        return

    # ----- Walk the mainline and collect (board, move, move_number, side) tuples -----
    positions: list[tuple[chess.Board, chess.Move, int, str, tuple[str, ...]]] = []
    history_fens: list[str] = [game.board().fen()]
    node = game
    half_move = 0
    while node.variations:
        next_node = node.variations[0]
        board = node.board()
        move = next_node.move
        move_number = half_move // 2 + 1
        side = "white" if board.turn == chess.WHITE else "black"
        positions.append((board.copy(), move, move_number, side, tuple(history_fens)))
        board_after = board.copy()
        board_after.push(move)
        history_fens.append(board_after.fen())
        node = next_node
        half_move += 1

    total = len(positions)
    move_results: list[AnalysisMoveData] = list(initial_moves or [])
    minefields: list[int] = list(initial_minefields or [])
    # Checkpoints are written only at event boundaries, so a mismatched or
    # stale prefix must never make the analyzer skip a real position.
    if start_index < 0 or start_index != len(move_results) or start_index > total:
        start_index = 0
        move_results = []
        minefields = []

    # prev_eval carries the eval from one position to the next to avoid
    # redundant Phase-1 probes. It is stored from the NEXT side-to-move's
    # perspective (negated after each position).
    prev_eval: float | None = None
    if move_results:
        previous = move_results[-1]
        if (
            previous.comparison_status == "complete"
            and previous.matched_played_eval is not None
        ):
            prev_eval = -previous.matched_played_eval

    # Mate-in-N values (side-to-move perspective) for the post-processing pass
    mate_stm_per_pos: list[int | None] = []
    for position_index in range(start_index):
        if position_index == 0:
            mate_stm_per_pos.append(None)
            continue
        white_mate = move_results[position_index - 1].mate_in
        position_side = positions[position_index][3]
        mate_stm_per_pos.append(
            white_mate
            if white_mate is None or position_side == "white"
            else -white_mate
        )

    # Reuse Maia policy calls across positions within this analysis.
    maia_policy_cache: MaiaPolicyCache = {}

    for idx in range(start_index, total):
        board, move, move_number, side, position_history_fens = positions[idx]
        is_white = side == "white"

        timeline = evaluate_timeline_position(
            board,
            stockfish,
            prev_eval=prev_eval,
            full_depth=stockfish.depth,
        )
        if timeline is None:
            raise RuntimeError("Stockfish did not return a timeline result for a legal position")

        timeline_stm_eval = timeline.evaluation
        white_eval = timeline_stm_eval if is_white else -timeline_stm_eval
        if timeline.mate is not None:
            white_mate = timeline.mate if is_white else -timeline.mate
        else:
            white_mate = None

        cti_skip_reason: str | None = None
        if idx == 0 and board.fen() == chess.STARTING_FEN:
            cti_skip_reason = "initial_position"
        elif analysis_scope != "both" and analysis_scope != side:
            cti_skip_reason = "side_not_selected"

        # Core CTI computation (also provides engine-evals and Maia policy
        # needed for all other metrics)
        result = None
        if cti_skip_reason is None:
            result = compute_cti(
                board,
                stockfish,
                maia,
                acceptable_drop=acceptable_drop,
                prev_eval=prev_eval,
                full_depth=stockfish.depth,
                maia_policy_cache=maia_policy_cache,
                maia3_white_elo=maia3_white_elo,
                maia3_black_elo=maia3_black_elo,
                history_fens=position_history_fens,
                played_move=move,
                minefield_threshold=minefield_threshold,
                timeline=timeline,
            )

        comparison_status = result.comparison_status if result is not None else "not_applicable"
        if result is not None and result.comparison_status == "complete":
            assert result.best_eval is not None
            assert result.best_move is not None
            assert result.cti_lower_bound is not None
            assert result.cti_upper_bound is not None
            # Refinement guarantees the bounds do not straddle the threshold.
            is_minefield = result.cti_lower_bound >= minefield_threshold

            best_move_obj = result.best_move
            # SAN map for good moves together with their eval drop from best (for UI display)
            good_moves_eval: dict[str, float] = {}
            for good_move in result.good_moves:
                raw_delta = result.all_evals[good_move] - result.best_eval
                if not (-acceptable_drop < raw_delta <= 0.0):
                    raise RuntimeError("Coherent good-move delta invariant violated")
                displayed_delta = round(raw_delta, 2)
                good_moves_eval[board.san(good_move)] = (
                    0.0 if displayed_delta == 0 else displayed_delta
                )

            # ----- MBI: Master Blunder Index -----
            # Classifies blunders by how "human-natural" they are using
            # Maia-probability of the played move.
            mbi_classification = None
            mbi_maia_prob = None

            played_move_eval = result.played_move_eval
            if played_move_eval is None:
                raise RuntimeError("Complete root snapshot omitted the played move")
            eval_drop = result.best_eval - played_move_eval

            # Carry the actual played continuation into the next position's
            # depth triage. The score is currently from this side-to-move's
            # perspective, so negate it for the opponent to move next.
            prev_eval = -played_move_eval

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
                    raise RuntimeError("Complete root snapshot omitted Maia's top move")

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

            # Convert PV moves to SAN notation, stopping at 6 moves or
            # if a move is no-longer legal (can happen with hash collisions).
            best_line: list[str] = []
            pv_board = board.copy()
            for pv_move in result.best_pv[:6]:
                if pv_move in pv_board.legal_moves:
                    best_line.append(pv_board.san(pv_move))
                    pv_board.push(pv_move)
                else:
                    break

            with diagnostic_stage("result_finalization"):
                move_data = AnalysisMoveData(
                    move_number=move_number,
                    side=side,
                    move=board.san(move),
                    fen=board.fen(),
                    stockfish_eval=round(white_eval, 2),
                    eval_after=0.0,  # populated in post-processing pass
                    cti=result.cti,
                    cti_lower_bound=result.cti_lower_bound,
                    cti_upper_bound=result.cti_upper_bound,
                    cti_remaining_mass=result.cti_remaining_mass,
                    cti_is_approximate=result.cti_is_approximate,
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
                    epe_score=None,
                    best_line=best_line,
                    best_line_evals={},
                    mate_in=None,  # populated in post-processing pass
                    played_move_eval_drop=max(0.0, eval_drop),
                    matched_best_eval=result.best_eval,
                    matched_played_eval=played_move_eval,
                    comparison_depth=result.comparison_depth,
                    comparison_method=result.comparison_method,
                    comparison_status="complete",
                    cti_skip_reason=None,
                )
            mate_stm_per_pos.append(timeline.mate)
        else:
            # ----- Skipped position -----
            # Without a coherent played-root score, the next actual position
            # must run its own shallow depth-selection probe.
            prev_eval = None

            move_data = AnalysisMoveData(
                move_number=move_number,
                side=side,
                move=board.san(move) if not board.is_game_over() else move.uci(),
                fen=board.fen(),
                stockfish_eval=round(white_eval, 2),
                eval_after=0.0,  # populated in post-processing pass
                cti=None,
                cti_lower_bound=None,
                cti_upper_bound=None,
                cti_remaining_mass=None,
                cti_is_approximate=False,
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
                played_move_eval_drop=None,
                matched_best_eval=None,
                matched_played_eval=None,
                comparison_depth=result.comparison_depth if result is not None else None,
                comparison_method=result.comparison_method if result is not None else None,
                comparison_status=comparison_status,
                cti_skip_reason=cti_skip_reason,
            )
            mate_stm_per_pos.append(timeline.mate)
            is_minefield = False

        if move_results:
            move_results[-1].eval_after = round(white_eval, 2)
            move_results[-1].mate_in = white_mate

        move_results.append(move_data)

        if is_minefield:
            minefields.append(len(move_results) - 1)

        # Emit progress events every 5 moves and on the final move
        if (idx + 1) % 5 == 0 or idx == total - 1:
            yield AnalysisProgressEvent(
                idx + 1,
                total,
                len(minefields),
                moves=list(move_results),
                minefields=list(minefields),
            )

    # ----- Post-processing: fill in eval_after and mate_in -----
    # eval_after[i] = stockfish_eval[i+1] (Lichess convention).
    # The last move's eval_after requires a separate Stockfish evaluation
    # of the final position.
    with diagnostic_stage("result_finalization"):
        populate_eval_after(
            move_results,
            mate_stm_per_pos,
            positions,
            stockfish,
            final_prev_eval=prev_eval,
        )

    yield AnalysisCompleteEvent(moves=move_results, minefields=minefields)
