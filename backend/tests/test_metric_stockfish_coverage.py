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
        legal_policy = {move: prob for move, prob in self.policy.items() if move in board.legal_moves}
        if legal_policy:
            return legal_policy
        return {next(iter(board.legal_moves)): 1.0}


class CtiStockfish:
    depth = 12

    def __init__(self):
        self.acceptable_drops = []

    def quick_evaluate(self, board, depth=8):
        return 0.0

    def evaluate_all_moves(self, board, acceptable_drop=0.0, depth=None, probe_eval=None):
        self.acceptable_drops.append(acceptable_drop)
        moves = list(board.legal_moves)
        return {
            moves[0]: (1.0, [moves[0]], None),
            moves[1]: (0.8, [moves[1]], None),
            moves[2]: (0.0, [moves[2]], None),
        }, 1.0


class AnalyzerStockfish:
    depth = 12

    def __init__(self, played_move):
        self.played_move = played_move
        self.evaluate_move_calls = []

    def quick_evaluate(self, board, depth=8):
        return 0.0

    def quick_evaluate_with_mate(self, board, depth=8):
        return 0.0, None

    def evaluate_all_moves(self, board, acceptable_drop=0.0, depth=None, probe_eval=None):
        legal_moves = list(board.legal_moves)
        sampled_move = next(move for move in legal_moves if move != self.played_move)
        return {sampled_move: (1.0, [sampled_move], None)}, 1.0

    def evaluate_move(self, board, move, depth=None):
        self.evaluate_move_calls.append(move)
        return 0.95, [move], None

    def evaluate_position(self, board, depth=12, acceptable_drop=0.5):
        return {
            "best_move": "",
            "good_moves": [],
            "good_moves_with_eval": {},
            "mate_in": None,
        }


class MetricStockfishCoverageTests(unittest.TestCase):
    def test_cti_requests_full_legal_move_coverage(self):
        board = chess.Board()
        moves = list(board.legal_moves)
        maia = FakeMaia({moves[0]: 0.2, moves[1]: 0.3, moves[2]: 0.5})
        stockfish = CtiStockfish()

        result = compute_cti(
            board,
            stockfish,
            maia,
            acceptable_drop=0.5,
            full_depth=12,
        )

        self.assertEqual(stockfish.acceptable_drops, [0.0])
        self.assertIsNotNone(result)
        self.assertEqual(set(result.good_moves), {moves[0], moves[1]})
        self.assertEqual(result.cti, 0.5)

    def test_mbi_evaluates_played_move_when_missing_from_stockfish_map(self):
        board = chess.Board()
        played_move = chess.Move.from_uci("e2e4")
        stockfish = AnalyzerStockfish(played_move)
        maia = FakeMaia({played_move: 0.9})

        events = list(
            analyze_game(
                "1. e4 *",
                stockfish,
                maia,
                blunder_threshold=1.0,
            )
        )

        complete = events[-1]
        self.assertEqual(stockfish.evaluate_move_calls, [played_move])
        self.assertIsNone(complete.moves[0].mbi_classification)


if __name__ == "__main__":
    unittest.main()
