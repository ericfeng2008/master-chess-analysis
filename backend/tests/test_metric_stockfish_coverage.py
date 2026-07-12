import unittest

import chess

from app.analysis.analyzer import analyze_game
from app.analysis.metrics import compute_cti


class FakeMaia:
    model_name = "maia3-79m"
    use_history = True

    def __init__(self, policy):
        self.policy = policy

    def predict(self, board, elo=2200, self_elo=None, opponent_elo=None, history_fens=None):
        return {move: prob for move, prob in self.policy.items() if move in board.legal_moves}


class CandidateStockfish:
    depth = 12

    def __init__(self, best_move, evaluations):
        self.best_move = best_move
        self.evaluations = evaluations
        self.root_calls: list[tuple[chess.Move, ...]] = []
        self.evaluate_move_calls: list[chess.Move] = []

    def quick_evaluate(self, board, depth=8):
        return 0.0

    def quick_evaluate_with_mate(self, board, depth=8):
        return 0.0, None

    def evaluate_best_move(self, board, depth=None):
        value = self.evaluations[self.best_move]
        return self.best_move, value, [self.best_move], None

    def evaluate_root_moves(self, board, root_moves, depth=None):
        roots = tuple(root_moves)
        self.root_calls.append(roots)
        return {
            move: (self.evaluations[move], [move], None)
            for move in roots
            if move in self.evaluations
        }

    def evaluate_move(self, board, move, depth=None):
        self.evaluate_move_calls.append(move)
        return self.evaluations[move], [move], None

    def evaluate_position(self, board, depth=12, acceptable_drop=0.5):
        return {
            "best_move": "",
            "good_moves": [],
            "good_moves_with_eval": {},
            "mate_in": None,
        }


def concentrated_policy(board: chess.Board, top_probability: float = 0.996):
    moves = list(board.legal_moves)
    tail = (1.0 - top_probability) / (len(moves) - 1)
    return moves, {move: top_probability if i == 0 else tail for i, move in enumerate(moves)}


class MetricStockfishCoverageTests(unittest.TestCase):
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
        self.assertLess(len(first_roots), board.legal_moves.count())
        self.assertTrue(result.cti_is_approximate)
        self.assertLessEqual(result.cti_remaining_mass, 0.005)

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
        self.assertLess(result.cti_upper_bound, 0.002)
        self.assertLess(result.cti_remaining_mass, 0.004)

    def test_analyzer_includes_played_move_without_fallback_call(self):
        board = chess.Board()
        moves, policy = concentrated_policy(board)
        played_move = chess.Move.from_uci("e2e4")
        best_move = moves[1] if moves[1] != played_move else moves[2]
        evaluations = {move: 1.0 if move == best_move else 0.95 for move in moves}
        stockfish = CandidateStockfish(best_move, evaluations)

        events = list(analyze_game("1. e4 *", stockfish, FakeMaia(policy)))

        self.assertTrue(any(played_move in roots for roots in stockfish.root_calls))
        self.assertEqual(stockfish.evaluate_move_calls, [])
        self.assertIsNone(events[-1].moves[0].mbi_classification)


if __name__ == "__main__":
    unittest.main()
