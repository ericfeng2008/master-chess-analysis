import unittest

import chess
import chess.engine

from app.analysis.evaluation import MATE_SCORE_PAWNS
from app.engines.stockfish_client import StockfishClient


class FakeEngine:
    def __init__(self, infos):
        self.infos = infos
        self.calls = []

    def analyse(self, board, limit, **kwargs):
        self.calls.append((board.fen(), kwargs))
        return self.infos


class StockfishRootMoveTests(unittest.TestCase):
    def make_client(self, infos):
        client = StockfishClient.__new__(StockfishClient)
        client.depth = 12
        client.engine = FakeEngine(infos)
        return client

    def test_empty_root_set_avoids_engine_call(self):
        client = self.make_client([])
        self.assertEqual(client.evaluate_root_moves(chess.Board(), []), {})
        self.assertEqual(client.engine.calls, [])

    def test_illegal_root_is_rejected(self):
        client = self.make_client([])
        with self.assertRaisesRegex(ValueError, "Illegal root move"):
            client.evaluate_root_moves(chess.Board(), [chess.Move.from_uci("e2e5")])

    def test_explicit_roots_preserve_eval_pv_and_mate(self):
        board = chess.Board()
        e4 = chess.Move.from_uci("e2e4")
        d4 = chess.Move.from_uci("d2d4")
        infos = [
            {
                "pv": [e4],
                "score": chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE),
            },
            {
                "pv": [d4],
                "score": chess.engine.PovScore(chess.engine.Mate(1), chess.WHITE),
            },
        ]
        client = self.make_client(infos)

        results = client.evaluate_root_moves(board, [e4, d4, e4], depth=14)

        self.assertEqual(results[e4], (0.5, [e4], None))
        self.assertAlmostEqual(results[d4][0], MATE_SCORE_PAWNS - 0.01)
        self.assertEqual(results[d4][1:], ([d4], 1))
        _, kwargs = client.engine.calls[0]
        self.assertEqual(kwargs["multipv"], 2)
        self.assertEqual(kwargs["root_moves"], [e4, d4])


if __name__ == "__main__":
    unittest.main()
