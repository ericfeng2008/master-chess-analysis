import chess
import chess.engine
import pytest

from app.analysis.metrics import compute_cti
from app.engines.stockfish_client import StockfishClient


class SearchEngine:
    id = {"name": "Stockfish Test"}

    def __init__(self):
        self.calls: list[tuple[str, ...]] = []
        self.fail_next = False

    def analyse(self, board, limit, **kwargs):
        roots = tuple(move.uci() for move in kwargs.get("root_moves") or ())
        self.calls.append(roots)
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("search failed")
        requested = kwargs.get("root_moves") or [next(iter(board.legal_moves))]
        return [
            {
                "pv": [move],
                "score": chess.engine.PovScore(chess.engine.Cp(30 - index), board.turn),
                "nodes": 100 + index,
                "hashfull": 10 + index,
            }
            for index, move in enumerate(requested)
        ] if "multipv" in kwargs else {
            "pv": [requested[0]],
            "score": chess.engine.PovScore(chess.engine.Cp(30), board.turn),
            "nodes": 100,
            "hashfull": 10,
        }


def client(capacity: int = 8) -> StockfishClient:
    value = StockfishClient.__new__(StockfishClient)
    value.path = "/test/stockfish"
    value.depth = 12
    value.threads = 2
    value.hash_mb = 256
    value.search_cache_entries = capacity
    value.engine = SearchEngine()
    return value


def board_after(*moves: str) -> chess.Board:
    board = chess.Board()
    for uci in moves:
        board.push_uci(uci)
    return board


def test_best_search_hit_and_mutation_isolation():
    stockfish = client()
    board = chess.Board()

    first = stockfish.evaluate_best_move(board, depth=14)
    assert first is not None
    first[2].clear()
    second = stockfish.evaluate_best_move(board, depth=14)

    assert len(stockfish.engine.calls) == 1
    assert second is not None and second[2]


def test_restricted_search_hit_is_exact_and_defensively_cloned():
    stockfish = client()
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    d4 = chess.Move.from_uci("d2d4")

    first = stockfish.evaluate_root_moves(board, [e4, d4], depth=14)
    first[e4][1].clear()
    second = stockfish.evaluate_root_moves(board, [e4, d4], depth=14)

    assert len(stockfish.engine.calls) == 1
    assert second[e4][1] == [e4]


def test_history_depth_root_order_and_engine_options_are_cache_misses():
    stockfish = client()
    e4 = chess.Move.from_uci("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    start = chess.Board()

    stockfish.evaluate_root_moves(start, [e4, d4], depth=12)
    stockfish.evaluate_root_moves(start, [d4, e4], depth=12)
    stockfish.evaluate_root_moves(start, [e4, d4], depth=14)

    repeated = board_after("g1f3", "g8f6", "f3g1", "f6g8")
    reconstructed = chess.Board(repeated.fen())
    repeated_roots = list(repeated.legal_moves)[:2]
    stockfish.evaluate_root_moves(repeated, repeated_roots, depth=12)
    stockfish.evaluate_root_moves(reconstructed, repeated_roots, depth=12)

    stockfish.threads = 3
    stockfish.evaluate_root_moves(start, [e4, d4], depth=12)

    assert len(stockfish.engine.calls) == 6


def test_failed_and_incomplete_searches_are_not_cached():
    stockfish = client()
    board = chess.Board()
    stockfish.engine.fail_next = True
    with pytest.raises(RuntimeError, match="search failed"):
        stockfish.evaluate_best_move(board)
    stockfish.evaluate_best_move(board)
    assert len(stockfish.engine.calls) == 2


def test_lru_eviction_is_deterministic():
    stockfish = client(capacity=2)
    first = chess.Board()
    second = board_after("e2e4")
    third = board_after("d2d4")

    stockfish.evaluate_best_move(first)
    stockfish.evaluate_best_move(second)
    stockfish.evaluate_best_move(first)  # refresh first
    stockfish.evaluate_best_move(third)  # evicts second
    stockfish.evaluate_best_move(second)

    assert len(stockfish.engine.calls) == 4


def test_zero_capacity_disables_cache():
    stockfish = client(capacity=0)
    stockfish.evaluate_best_move(chess.Board())
    stockfish.evaluate_best_move(chess.Board())
    assert len(stockfish.engine.calls) == 2


def test_cache_can_clear_after_engine_identity_becomes_unavailable():
    stockfish = client()
    stockfish.evaluate_best_move(chess.Board())
    stockfish._engine_name = "Stockfish Test"
    stockfish.engine.id = None
    stockfish.clear_search_cache()
    assert len(stockfish._search_cache) == 0


class FixedMaia:
    model_name = "maia-test"
    use_history = False

    def __init__(self, policy):
        self.policy = policy

    def predict(self, board, **kwargs):
        return self.policy


def test_warm_cti_result_matches_cold_without_new_engine_searches():
    stockfish = client()
    board = chess.Board()
    moves = list(board.legal_moves)
    tail = 0.004 / (len(moves) - 1)
    policy = {move: 0.996 if index == 0 else tail for index, move in enumerate(moves)}
    kwargs = {
        "acceptable_drop": 0.5,
        "prev_eval": 0.0,
        "full_depth": 12,
        "played_move": moves[1],
        "minefield_threshold": 0.8,
    }

    cold = compute_cti(board, stockfish, FixedMaia(policy), **kwargs)
    cold_call_count = len(stockfish.engine.calls)
    warm = compute_cti(board, stockfish, FixedMaia(policy), **kwargs)

    assert cold is not None and warm is not None
    assert len(stockfish.engine.calls) == cold_call_count
    assert warm.best_pv == cold.best_pv
    assert warm.best_eval == cold.best_eval
    assert warm.all_evals == cold.all_evals
    assert warm.good_moves == cold.good_moves
    assert warm.cti == cold.cti
    assert warm.cti_lower_bound == cold.cti_lower_bound
    assert warm.cti_upper_bound == cold.cti_upper_bound
