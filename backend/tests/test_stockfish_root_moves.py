import unittest

import chess
import chess.engine

from app.analysis.data_models import RootEvaluationSnapshot
from app.analysis.evaluation import MATE_SCORE_PAWNS
from app.engines.stockfish_client import StockfishClient


class FakeEngine:
    def __init__(self, infos):
        self.infos = infos
        self.calls = []

    def analyse(self, board, limit, **kwargs):
        self.calls.append((board.fen(), kwargs))
        return self.infos


class SequencedFakeEngine(FakeEngine):
    def analyse(self, board, limit, **kwargs):
        self.calls.append((board.fen(), kwargs))
        index = min(len(self.calls) - 1, len(self.infos) - 1)
        return self.infos[index]


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

    def test_snapshot_selects_maximum_and_preserves_rank_for_ties(self):
        board = chess.Board()
        e4 = chess.Move.from_uci("e2e4")
        d4 = chess.Move.from_uci("d2d4")
        client = self.make_client([
            {"pv": [d4], "score": chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE)},
            {"pv": [e4], "score": chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE)},
        ])

        snapshot = client.evaluate_root_snapshot(board, [e4, d4], depth=14)

        self.assertTrue(snapshot.complete)
        self.assertEqual(snapshot.ranks, {d4: 0, e4: 1})
        self.assertEqual(snapshot.authoritative()[0], d4)
        self.assertEqual(snapshot.depth, 14)
        self.assertEqual(snapshot.attempts, 1)

    def test_snapshot_uses_uci_fallback_when_rank_is_unavailable(self):
        e4 = chess.Move.from_uci("e2e4")
        d4 = chess.Move.from_uci("d2d4")
        snapshot = RootEvaluationSnapshot(
            requested_roots=(e4, d4),
            evaluations={e4: (0.5, [e4], None), d4: (0.5, [d4], None)},
            ranks={},
            depth=14,
        )

        self.assertEqual(snapshot.authoritative()[0], d4)

    def test_snapshot_retries_the_complete_set_and_discards_incomplete_result(self):
        board = chess.Board()
        e4 = chess.Move.from_uci("e2e4")
        d4 = chess.Move.from_uci("d2d4")
        first = [
            {"pv": [e4], "score": chess.engine.PovScore(chess.engine.Cp(20), chess.WHITE)},
        ]
        second = [
            {"pv": [d4], "score": chess.engine.PovScore(chess.engine.Cp(40), chess.WHITE)},
            {"pv": [e4], "score": chess.engine.PovScore(chess.engine.Cp(20), chess.WHITE)},
        ]
        client = self.make_client([])
        client.engine = SequencedFakeEngine([first, second])

        snapshot = client.evaluate_root_snapshot(board, [e4, d4], depth=14)

        self.assertTrue(snapshot.complete)
        self.assertEqual(snapshot.attempts, 2)
        self.assertEqual(snapshot.authoritative()[0], d4)
        self.assertEqual(
            [tuple(move.uci() for move in call[1]["root_moves"]) for call in client.engine.calls],
            [("e2e4", "d2d4"), ("e2e4", "d2d4")],
        )

    def test_snapshot_reports_missing_roots_after_retry(self):
        board = chess.Board()
        e4 = chess.Move.from_uci("e2e4")
        d4 = chess.Move.from_uci("d2d4")
        incomplete = [
            {"pv": [e4], "score": chess.engine.PovScore(chess.engine.Cp(20), chess.WHITE)},
        ]
        client = self.make_client([])
        client.engine = SequencedFakeEngine([incomplete, incomplete])

        snapshot = client.evaluate_root_snapshot(board, [e4, d4], depth=14)

        self.assertFalse(snapshot.complete)
        self.assertEqual(snapshot.missing_roots, (d4,))
        self.assertIsNone(snapshot.authoritative())
        self.assertEqual(snapshot.attempts, 2)


if __name__ == "__main__":
    unittest.main()
