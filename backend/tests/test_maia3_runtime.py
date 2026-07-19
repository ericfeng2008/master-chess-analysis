import asyncio
import unittest

import chess
from pydantic import ValidationError

from app.analysis.metrics import _predict_maia
from app.config import DEFAULT_MAIA3_ELO
from app.engines.maia3_client import Maia3Client
from app.models.schemas import AnalyzeRequest


class FakeMaia3Client:
    model_name = "maia3-79m"
    use_history = True

    def __init__(self):
        self.calls: list[tuple[int, int, tuple[str, ...] | None]] = []

    def predict(
        self,
        board,
        elo=DEFAULT_MAIA3_ELO,
        self_elo=None,
        opponent_elo=None,
        history_fens=None,
    ):
        side_to_move_elo = elo if self_elo is None else self_elo
        other_side_elo = elo if opponent_elo is None else opponent_elo
        self.calls.append((
            side_to_move_elo,
            other_side_elo,
            tuple(history_fens) if history_fens is not None else None,
        ))
        return {next(iter(board.legal_moves)): 1.0}


class Maia3RuntimeTests(unittest.TestCase):
    def test_analyze_request_defaults_maia3_elos_to_2600(self):
        request = AnalyzeRequest(pgn="1. e4 e5 *")

        self.assertEqual(request.maia3_white_elo, 2600)
        self.assertEqual(request.maia3_black_elo, 2600)

    def test_analyze_request_validates_maia3_elo_range(self):
        with self.assertRaises(ValidationError):
            AnalyzeRequest(pgn="1. e4 *", maia3_white_elo=-50)
        with self.assertRaises(ValidationError):
            AnalyzeRequest(pgn="1. e4 *", maia3_black_elo=5050)

    def test_missing_checkpoint_fails_before_dependency_imports(self):
        with self.assertRaisesRegex(RuntimeError, "maia3-79m.pt"):
            asyncio.run(Maia3Client.create("/tmp/definitely-missing-maia3-79m.pt"))

    def test_policy_cache_reuses_same_context(self):
        board = chess.Board()
        maia = FakeMaia3Client()
        cache = {}
        history = (board.fen(),)

        _predict_maia(
            board,
            maia,
            cache,
            maia3_white_elo=2200,
            maia3_black_elo=2100,
            history_fens=history,
        )
        _predict_maia(
            board,
            maia,
            cache,
            maia3_white_elo=2200,
            maia3_black_elo=2100,
            history_fens=history,
        )

        self.assertEqual(len(maia.calls), 1)

    def test_policy_cache_separates_elos_and_history(self):
        board = chess.Board()
        maia = FakeMaia3Client()
        cache = {}
        history = (board.fen(),)
        different_history = ("8/8/8/8/8/8/8/8 w - - 0 1", board.fen())

        _predict_maia(
            board,
            maia,
            cache,
            maia3_white_elo=2200,
            maia3_black_elo=2100,
            history_fens=history,
        )
        _predict_maia(
            board,
            maia,
            cache,
            maia3_white_elo=2300,
            maia3_black_elo=2100,
            history_fens=history,
        )
        _predict_maia(
            board,
            maia,
            cache,
            maia3_white_elo=2200,
            maia3_black_elo=2100,
            history_fens=different_history,
        )

        self.assertEqual(len(maia.calls), 3)

    def test_policy_prediction_maps_white_and_black_elos_by_side_to_move(self):
        white_board = chess.Board()
        black_board = chess.Board()
        black_board.push(chess.Move.from_uci("e2e4"))
        maia = FakeMaia3Client()

        _predict_maia(white_board, maia, maia3_white_elo=2200, maia3_black_elo=1800)
        _predict_maia(black_board, maia, maia3_white_elo=2200, maia3_black_elo=1800)

        self.assertEqual(maia.calls[0][:2], (2200, 1800))
        self.assertEqual(maia.calls[1][:2], (1800, 2200))


if __name__ == "__main__":
    unittest.main()
