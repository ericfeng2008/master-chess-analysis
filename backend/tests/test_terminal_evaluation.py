import unittest

import chess

from app.analysis.evaluation import MATE_SCORE_PAWNS, terminal_eval_white
from app.analysis.metrics import compute_epe
from app.engines.stockfish_client import StockfishClient


def first_terminal_move(board: chess.Board, winner: chess.Color | None):
    for move in board.legal_moves:
        after = board.copy()
        after.push(move)
        outcome = after.outcome(claim_draw=False)
        if outcome is not None and outcome.winner == winner:
            return move
    raise AssertionError("No matching terminal move in fixture")


class PolicyMaia:
    model_name = "test"
    use_history = False

    def __init__(self, move):
        self.move = move

    def predict(self, board, **kwargs):
        return {self.move: 1.0}


class NoEngineCalls:
    def quick_evaluate(self, board, depth=8):
        raise AssertionError("Terminal candidate should not call Stockfish")


class TerminalEvaluationTests(unittest.TestCase):
    def test_terminal_helper_scores_white_and_black_wins_and_draw(self):
        white_mate = chess.Board("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1")
        white_mate.push(first_terminal_move(white_mate, chess.WHITE))
        black_mate = chess.Board("8/8/8/8/8/6k1/5q2/7K b - - 0 1")
        black_mate.push(first_terminal_move(black_mate, chess.BLACK))
        drawn = chess.Board("8/8/8/8/8/8/7k/5K2 w - - 0 1")

        self.assertEqual(terminal_eval_white(white_mate), MATE_SCORE_PAWNS)
        self.assertEqual(terminal_eval_white(black_mate), -MATE_SCORE_PAWNS)
        self.assertEqual(terminal_eval_white(drawn), 0.0)

    def test_epe_scores_white_checkmate(self):
        board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1")
        move = first_terminal_move(board, chess.WHITE)
        self.assertEqual(compute_epe(board, NoEngineCalls(), PolicyMaia(move)), MATE_SCORE_PAWNS)

    def test_epe_scores_black_checkmate(self):
        board = chess.Board("8/8/8/8/8/6k1/5q2/7K b - - 0 1")
        move = first_terminal_move(board, chess.BLACK)
        self.assertEqual(compute_epe(board, NoEngineCalls(), PolicyMaia(move)), -MATE_SCORE_PAWNS)

    def test_epe_scores_stalemate_as_draw(self):
        board = chess.Board("k7/2Q5/2K5/8/8/8/8/8 w - - 0 1")
        move = first_terminal_move(board, None)
        self.assertEqual(compute_epe(board, NoEngineCalls(), PolicyMaia(move)), 0.0)

    def test_evaluate_move_scores_immediate_mate_without_engine_call(self):
        client = StockfishClient.__new__(StockfishClient)
        client.depth = 12
        board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1")
        move = first_terminal_move(board, chess.WHITE)

        evaluation, pv, mate = client.evaluate_move(board, move)

        self.assertEqual(evaluation, MATE_SCORE_PAWNS)
        self.assertEqual(pv, [move])
        self.assertEqual(mate, 1)


if __name__ == "__main__":
    unittest.main()
