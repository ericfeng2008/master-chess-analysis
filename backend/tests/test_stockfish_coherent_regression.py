from pathlib import Path

import chess
import pytest

from app.config import settings
from app.engines.stockfish_client import StockfishClient


REPORTED_FEN = "r4k2/pp3p2/4bP1p/5p2/1q6/5NQP/5PP1/3R2K1 w - - 0 29"


@pytest.mark.skipif(
    not Path(settings.stockfish_path).is_file(),
    reason="configured Stockfish binary is unavailable",
)
def test_reported_position_has_one_coherent_best_and_no_positive_good_delta():
    board = chess.Board(REPORTED_FEN)
    stockfish = StockfishClient(
        settings.stockfish_path,
        depth=20,
        threads=1,
        hash_mb=64,
        search_cache_entries=0,
    )
    try:
        discovery = stockfish.evaluate_best_move(board, depth=20)
        assert discovery is not None
        roots = [
            discovery[0],
            board.parse_san("Nd4"),
            board.parse_san("Qc7"),
            board.parse_san("Rd6"),
        ]
        snapshot = stockfish.evaluate_root_snapshot(board, roots, depth=20)
        authoritative = snapshot.authoritative()

        assert snapshot.complete
        assert authoritative is not None
        best_move, best_eval, _pv, _mate = authoritative
        assert best_eval == max(value[0] for value in snapshot.evaluations.values())
        assert best_move in snapshot.evaluations
        good_deltas = [
            evaluation - best_eval
            for evaluation, _line, _root_mate in snapshot.evaluations.values()
            if best_eval - evaluation < 0.3
        ]
        assert good_deltas
        assert all(-0.3 < delta <= 0.0 for delta in good_deltas)
    finally:
        stockfish.close()
