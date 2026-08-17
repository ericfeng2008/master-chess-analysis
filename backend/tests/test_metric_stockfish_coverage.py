import unittest
from dataclasses import asdict

import chess

from app.analysis.analyzer import analyze_game
from app.analysis.data_models import (
    CTI_POLICY_COVERAGE,
    AnalysisMoveData,
    RootEvaluationSnapshot,
)
from app.mistakes import derive_mistake_suggestions
from app.analysis.metrics import compute_cti


NON_INITIAL_START_PGN = (
    '[SetUp "1"]\n'
    '[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 1 1"]\n\n'
    '1. e4 *'
)
NON_INITIAL_TWO_PLY_PGN = (
    '[SetUp "1"]\n'
    '[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 1 1"]\n\n'
    '1. e4 e5 *'
)


class FakeMaia:
    model_name = "maia3-79m"
    use_history = True

    def __init__(self, policy):
        self.policy = policy

    def predict(self, board, elo=2200, self_elo=None, opponent_elo=None, history_fens=None):
        return {move: prob for move, prob in self.policy.items() if move in board.legal_moves}


class CandidateStockfish:
    depth = 12

    def __init__(
        self,
        best_move,
        evaluations,
        *,
        discovery_result=None,
        root_evaluation_sequence=None,
        root_order_sequence=None,
        missing_roots_by_call=None,
    ):
        self.best_move = best_move
        self.evaluations = evaluations
        self.discovery_result = discovery_result
        self.root_evaluation_sequence = root_evaluation_sequence or [evaluations]
        self.root_order_sequence = root_order_sequence or []
        self.missing_roots_by_call = missing_roots_by_call or []
        self.root_calls: list[tuple[chess.Move, ...]] = []
        self.root_depths: list[int | None] = []
        self.evaluate_move_calls: list[chess.Move] = []
        self.best_calls = 0
        self.quick_calls = 0
        self.quick_mate_calls = 0
        self.position_calls = 0

    def quick_evaluate(self, board, depth=8):
        self.quick_calls += 1
        return 0.0

    def quick_evaluate_with_mate(self, board, depth=8):
        self.quick_mate_calls += 1
        return 0.0, None

    def evaluate_best_move(self, board, depth=None):
        self.best_calls += 1
        if self.discovery_result is not None:
            return self.discovery_result
        value = self.evaluations[self.best_move]
        if isinstance(value, tuple):
            evaluation, pv, mate = value
            return self.best_move, evaluation, list(pv), mate
        return self.best_move, value, [self.best_move], None

    def evaluate_root_moves(self, board, root_moves, depth=None):
        call_index = len(self.root_calls)
        roots = tuple(root_moves)
        self.root_calls.append(roots)
        self.root_depths.append(depth)
        source = self.root_evaluation_sequence[
            min(call_index, len(self.root_evaluation_sequence) - 1)
        ]
        missing = (
            set(self.missing_roots_by_call[call_index])
            if call_index < len(self.missing_roots_by_call)
            else set()
        )
        requested_order = (
            self.root_order_sequence[call_index]
            if call_index < len(self.root_order_sequence)
            else roots
        )
        ordered = [move for move in requested_order if move in roots]
        ordered.extend(move for move in roots if move not in ordered)
        results = {}
        for move in ordered:
            if move not in source or move in missing:
                continue
            value = source[move]
            results[move] = (
                (value[0], list(value[1]), value[2])
                if isinstance(value, tuple)
                else (value, [move], None)
            )
        return results

    def evaluate_root_snapshot(
        self, board, root_moves, depth=None, *, retry_incomplete=True
    ):
        roots = tuple(dict.fromkeys(root_moves))
        attempts = 0
        results = {}
        while attempts < (2 if retry_incomplete else 1):
            attempts += 1
            results = self.evaluate_root_moves(board, roots, depth=depth)
            if all(move in results for move in roots):
                break
        return RootEvaluationSnapshot(
            requested_roots=roots,
            evaluations=results,
            ranks={move: rank for rank, move in enumerate(results)},
            depth=depth or self.depth,
            attempts=attempts,
        )

    def evaluate_move(self, board, move, depth=None):
        self.evaluate_move_calls.append(move)
        return self.evaluations[move], [move], None

    def evaluate_position(self, board, depth=12, acceptable_drop=0.5):
        self.position_calls += 1
        return {
            "best_move": "",
            "good_moves": [],
            "good_moves_with_eval": {},
            "mate_in": None,
        }


class PlayedContinuationMaia:
    model_name = "maia3-79m"
    use_history = True

    def predict(self, board, **_kwargs):
        if board.ply() == 0:
            return {
                chess.Move.from_uci("e2e4"): 0.8,
                chess.Move.from_uci("d2d4"): 0.2,
            }
        return {
            chess.Move.from_uci("e7e5"): 0.8,
            chess.Move.from_uci("c7c5"): 0.2,
        }


class PlayedContinuationStockfish:
    depth = 16

    def __init__(self):
        self.best_depths: list[int] = []
        self.evaluate_move_calls: list[chess.Move] = []

    def quick_evaluate(self, board, depth=8):
        return 0.0

    def quick_evaluate_with_mate(self, board, depth=8):
        return 0.0, None

    def evaluate_best_move(self, board, depth=None):
        self.best_depths.append(depth)
        if board.ply() == 0:
            move = chess.Move.from_uci("d2d4")
        else:
            move = chess.Move.from_uci("e7e5")
        return move, 0.0, [move], None

    def evaluate_root_moves(self, board, root_moves, depth=None):
        evaluations = (
            {
                chess.Move.from_uci("d2d4"): 0.0,
                chess.Move.from_uci("e2e4"): -3.0,
            }
            if board.ply() == 0
            else {
                chess.Move.from_uci("e7e5"): 0.0,
                chess.Move.from_uci("c7c5"): -1.0,
            }
        )
        return {
            move: (evaluations[move], [move], None)
            for move in root_moves
        }

    def evaluate_root_snapshot(
        self, board, root_moves, depth=None, *, retry_incomplete=True
    ):
        roots = tuple(dict.fromkeys(root_moves))
        results = self.evaluate_root_moves(board, roots, depth=depth)
        return RootEvaluationSnapshot(
            requested_roots=roots,
            evaluations=results,
            ranks={move: rank for rank, move in enumerate(results)},
            depth=depth or self.depth,
        )

    def evaluate_move(self, board, move, depth=None):
        self.evaluate_move_calls.append(move)
        raise AssertionError("Played moves are required CTI roots and should not fall back")


def concentrated_policy(board: chess.Board, top_probability: float = 0.996):
    moves = list(board.legal_moves)
    tail = (1.0 - top_probability) / (len(moves) - 1)
    return moves, {move: top_probability if i == 0 else tail for i, move in enumerate(moves)}


class MetricStockfishCoverageTests(unittest.TestCase):
    def test_discovery_numeric_evidence_is_ignored_everywhere(self):
        board = chess.Board()
        discovered = chess.Move.from_uci("g1h3")
        maia_top = chess.Move.from_uci("d2d4")
        played = chess.Move.from_uci("e2e4")
        policy = {maia_top: 0.98, played: 0.01, discovered: 0.01}
        root_evaluations = {
            discovered: (0.0, [discovered], None),
            maia_top: (0.7, [maia_top], None),
            played: (1.0, [played], None),
        }
        stockfish = CandidateStockfish(
            discovered,
            root_evaluations,
            discovery_result=(discovered, 99.0, [discovered], 1),
        )

        complete = list(
            analyze_game(
                NON_INITIAL_START_PGN,
                stockfish,
                FakeMaia(policy),
                acceptable_drop=0.3,
                bri_threshold=0.05,
            )
        )[-1]
        move = complete.moves[0]

        self.assertEqual(move.best_move, "e4")
        self.assertEqual(move.matched_best_eval, 1.0)
        self.assertEqual(move.matched_played_eval, 1.0)
        self.assertEqual(move.played_move_eval_drop, 0.0)
        self.assertEqual(move.good_moves, ["e4"])
        self.assertAlmostEqual(move.cti, 0.99)
        self.assertAlmostEqual(move.eig_value, 0.3)
        self.assertTrue(move.is_brilliant)
        self.assertIsNone(move.mbi_classification)
        self.assertEqual(move.comparison_status, "complete")
        self.assertEqual(stockfish.evaluate_move_calls, [])

    def test_acceptable_membership_uses_raw_strict_boundary(self):
        board = chess.Board()
        best, below, equal, above = list(board.legal_moves)[:4]
        policy = {best: 0.25, below: 0.25, equal: 0.25, above: 0.25}
        evaluations = {
            best: 1.0,
            below: 0.7001,
            equal: 0.7,
            above: 0.6999,
        }

        result = compute_cti(
            board,
            CandidateStockfish(best, evaluations),
            FakeMaia(policy),
            acceptable_drop=0.3,
            full_depth=12,
        )

        self.assertEqual(set(result.good_moves), {best, below})
        self.assertAlmostEqual(result.cti, 0.5)
        self.assertAlmostEqual(result.best_eval - result.all_evals[equal], 0.3)

    def test_incomplete_snapshot_retries_then_fails_closed(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        discovered = moves[1]
        evaluations = {move: 1.0 for move in moves}
        stockfish = CandidateStockfish(
            discovered,
            evaluations,
            missing_roots_by_call=[[discovered], [discovered]],
        )

        result = compute_cti(
            board,
            stockfish,
            FakeMaia(policy),
            played_move=moves[2],
            full_depth=12,
        )

        self.assertEqual(result.comparison_status, "unavailable")
        self.assertIsNone(result.cti)
        self.assertIsNone(result.best_eval)
        self.assertEqual(result.good_moves, [])
        self.assertEqual(result.all_evals, {})
        self.assertEqual(len(stockfish.root_calls), 2)
        self.assertEqual(stockfish.root_calls[0], stockfish.root_calls[1])
        self.assertEqual(stockfish.evaluate_move_calls, [])

    def test_analyzer_and_mistake_selection_fail_closed_on_unavailable_snapshot(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        discovered = moves[1]
        stockfish = CandidateStockfish(
            discovered,
            {move: 1.0 for move in moves},
            missing_roots_by_call=[[discovered], [discovered]],
        )

        complete = list(
            analyze_game(NON_INITIAL_START_PGN, stockfish, FakeMaia(policy))
        )[-1]
        move = complete.moves[0]

        self.assertEqual(move.comparison_status, "unavailable")
        self.assertIsNone(move.cti)
        self.assertIsNone(move.cti_lower_bound)
        self.assertIsNone(move.best_move)
        self.assertEqual(move.good_moves, [])
        self.assertFalse(move.is_minefield)
        self.assertIsNone(move.mbi_classification)
        self.assertIsNone(move.eig_value)
        self.assertFalse(move.is_eig_flagged)
        self.assertFalse(move.is_brilliant)
        self.assertIsNone(move.played_move_eval_drop)

        stale_claim = asdict(move)
        stale_claim.update(
            played_move_eval_drop=9.0,
            cti=0.99,
            cti_lower_bound=0.99,
            mbi_classification="cognitive_trap",
        )
        analysis_run = {
            "id": "unavailable-run",
            "pgn_fingerprint": "game",
            "request": {
                "acceptable_drop": 0.3,
                "minefield_threshold": 0.8,
                "blunder_threshold": 1.0,
                "mbi_trap_threshold": 0.4,
            },
            "result": {"moves": [stale_claim], "move_context": []},
        }
        self.assertEqual(derive_mistake_suggestions(analysis_run, "white"), [])

    def test_historical_move_payload_defaults_comparison_evidence(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        complete = list(
            analyze_game(
                "1. e4 *",
                CandidateStockfish(moves[0], {move: 1.0 for move in moves}),
                FakeMaia(policy),
            )
        )[-1]
        legacy_payload = asdict(complete.moves[0])
        for field in (
            "played_move_eval_drop",
            "matched_best_eval",
            "matched_played_eval",
            "comparison_depth",
            "comparison_method",
            "comparison_status",
        ):
            legacy_payload.pop(field)

        restored = AnalysisMoveData(**legacy_payload)

        self.assertIsNone(restored.matched_best_eval)
        self.assertIsNone(restored.matched_played_eval)
        self.assertEqual(restored.comparison_status, "not_applicable")

    def test_incomplete_snapshot_successful_complete_set_retry_is_authoritative(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        discovered = moves[1]
        evaluations = {move: 1.0 if move == discovered else 0.9 for move in moves}
        stockfish = CandidateStockfish(
            discovered,
            evaluations,
            missing_roots_by_call=[[discovered]],
        )

        result = compute_cti(
            board,
            stockfish,
            FakeMaia(policy),
            played_move=moves[2],
            full_depth=12,
        )

        self.assertEqual(result.comparison_status, "complete")
        self.assertEqual(result.best_pv[0], discovered)
        self.assertEqual(len(stockfish.root_calls), 2)
        self.assertEqual(stockfish.root_calls[0], stockfish.root_calls[1])

    def test_cti_uses_probability_bounded_roots_and_required_moves(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        best_move = moves[1]
        played_move = moves[2]
        evaluations = {move: (1.0 if move == best_move else 0.0) for move in moves}
        stockfish = CandidateStockfish(best_move, evaluations)

        result = compute_cti(
            board,
            stockfish,
            FakeMaia(policy),
            acceptable_drop=0.5,
            full_depth=12,
            played_move=played_move,
        )

        self.assertIsNotNone(result)
        first_roots = set(stockfish.root_calls[0])
        self.assertEqual(first_roots, {moves[0], best_move, played_move})
        self.assertEqual(stockfish.root_calls[0], (moves[0], best_move, played_move))
        self.assertEqual(stockfish.root_depths, [12])
        self.assertEqual(CTI_POLICY_COVERAGE, 0.99)
        self.assertLess(len(first_roots), board.legal_moves.count())
        self.assertTrue(result.cti_is_approximate)
        self.assertLessEqual(result.cti_remaining_mass, 0.01)

    def test_full_reference_cti_is_inside_reported_bounds(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        best_move = moves[1]
        evaluations = {move: 1.0 if move in {best_move, moves[-1]} else 0.0 for move in moves}
        result = compute_cti(
            board,
            CandidateStockfish(best_move, evaluations),
            FakeMaia(policy),
            acceptable_drop=0.5,
            full_depth=12,
        )

        exact_good_mass = policy[best_move] + policy[moves[-1]]
        exact_cti = 1.0 - exact_good_mass
        self.assertLessEqual(result.cti_lower_bound, exact_cti)
        self.assertGreaterEqual(result.cti_upper_bound, exact_cti)

    def test_minefield_bounds_below_threshold_do_not_refine(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        evaluations = {move: 1.0 for move in moves}
        stockfish = CandidateStockfish(moves[0], evaluations)

        result = compute_cti(
            board,
            stockfish,
            FakeMaia(policy),
            minefield_threshold=0.8,
        )

        self.assertLess(result.cti_upper_bound, 0.8)
        self.assertEqual(len(stockfish.root_calls), 1)

    def test_minefield_bounds_above_threshold_do_not_refine(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        best_move = moves[1]
        evaluations = {move: 1.0 if move == best_move else 0.0 for move in moves}
        stockfish = CandidateStockfish(best_move, evaluations)

        result = compute_cti(
            board,
            stockfish,
            FakeMaia(policy),
            acceptable_drop=0.5,
            minefield_threshold=0.8,
        )

        self.assertGreaterEqual(result.cti_lower_bound, 0.8)
        self.assertEqual(len(stockfish.root_calls), 1)

    def test_straddling_minefield_bounds_refine_to_exact(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        evaluations = {move: 1.0 for move in moves}
        stockfish = CandidateStockfish(moves[0], evaluations)

        result = compute_cti(
            board,
            stockfish,
            FakeMaia(policy),
            acceptable_drop=0.5,
            minefield_threshold=0.002,
        )

        self.assertGreater(len(stockfish.root_calls), 1)
        for previous, expanded in zip(stockfish.root_calls, stockfish.root_calls[1:]):
            self.assertTrue(set(previous).issubset(expanded))
            self.assertGreater(len(expanded), len(previous))
        self.assertLess(result.cti_upper_bound, 0.002)
        self.assertLess(result.cti_remaining_mass, 0.004)

    def test_analyzer_includes_played_move_without_fallback_call(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        played_move = chess.Move.from_uci("e2e4")
        best_move = moves[1] if moves[1] != played_move else moves[2]
        evaluations = {move: 1.0 if move == best_move else 0.95 for move in moves}
        stockfish = CandidateStockfish(best_move, evaluations)

        events = list(
            analyze_game(NON_INITIAL_START_PGN, stockfish, FakeMaia(policy))
        )

        self.assertTrue(any(played_move in roots for roots in stockfish.root_calls))
        self.assertEqual(stockfish.evaluate_move_calls, [])
        self.assertIsNone(events[-1].moves[0].mbi_classification)

    def test_analyzer_has_only_cti_and_final_position_searches(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        played_move = chess.Move.from_uci("e2e4")
        best_move = moves[1] if moves[1] != played_move else moves[2]
        evaluations = {move: 1.0 if move == best_move else 0.95 for move in moves}
        stockfish = CandidateStockfish(best_move, evaluations)

        complete = list(
            analyze_game(NON_INITIAL_START_PGN, stockfish, FakeMaia(policy))
        )[-1]

        self.assertEqual(stockfish.quick_calls, 1)  # first-position depth probe
        self.assertEqual(stockfish.best_calls, 2)  # decision plus final timeline
        self.assertEqual(len(stockfish.root_calls), 1)
        self.assertEqual(stockfish.position_calls, 0)  # no eager line details
        self.assertEqual(stockfish.quick_mate_calls, 0)
        self.assertIsNone(complete.moves[0].epe_score)
        self.assertTrue(complete.moves[0].best_line)
        self.assertEqual(complete.moves[0].best_line_evals, {})

    def test_analyzer_triages_the_next_position_from_the_played_move(self):
        stockfish = PlayedContinuationStockfish()

        list(analyze_game(NON_INITIAL_TWO_PLY_PGN, stockfish, PlayedContinuationMaia()))

        # e4 evaluates to -3.0 for White, so Black's next-position estimate is
        # +3.0. That crosses the existing >=2.0 triage threshold: 16 -> 12.
        self.assertEqual(stockfish.best_depths[:2], [16, 12])
        self.assertEqual(stockfish.evaluate_move_calls, [])


if __name__ == "__main__":
    unittest.main()
