"""Benchmark CTI root-comparison call shapes with real Stockfish.

Run from ``backend``. Set ``BENCH_APP_ROOT`` to another checkout's backend
directory to compare implementations while keeping this runner unchanged.
The benchmark reports timing but uses call/root counts as the stable contract.
"""

from __future__ import annotations

from collections import Counter
import inspect
import json
import os
from pathlib import Path
import sys
from time import perf_counter


app_root = Path(os.environ.get("BENCH_APP_ROOT", Path(__file__).parents[1])).resolve()
sys.path.insert(0, str(app_root))

import chess  # noqa: E402

from app.analysis.metrics import compute_cti  # noqa: E402
from app.config import settings  # noqa: E402
from app.engines.stockfish_client import StockfishClient  # noqa: E402


class FixedPolicy:
    model_name = "coherent-benchmark-policy"
    use_history = False

    def __init__(self, top_move: chess.Move):
        self.top_move = top_move

    def predict(self, board, **_kwargs):
        moves = list(board.legal_moves)
        tail = 0.004 / (len(moves) - 1)
        return {
            move: 0.996 if move == self.top_move else tail
            for move in moves
        }


def new_stockfish(path: str, depth: int) -> StockfishClient:
    kwargs = {"depth": depth, "threads": 1, "hash_mb": 64}
    if "search_cache_entries" in inspect.signature(StockfishClient).parameters:
        kwargs["search_cache_entries"] = 0
    return StockfishClient(path, **kwargs)


def run_scenario(path: str, depth: int, top_move: chess.Move, scenario: str) -> dict:
    board = chess.Board()
    client = new_stockfish(path, depth)
    calls: Counter[str] = Counter()
    root_counts: list[int] = []
    root_elapsed_ms: list[float] = []
    original_best = client.evaluate_best_move
    original_roots = client.evaluate_root_moves
    original_move = client.evaluate_move

    def counted_best(*args, **kwargs):
        calls["discovery"] += 1
        return original_best(*args, **kwargs)

    def counted_roots(board_arg, roots, depth=None):
        requested = list(dict.fromkeys(roots))
        calls["restricted_snapshot"] += 1
        root_counts.append(len(requested))
        started = perf_counter()
        result = original_roots(board_arg, requested, depth=depth)
        root_elapsed_ms.append((perf_counter() - started) * 1000)
        if scenario == "retry" and calls["restricted_snapshot"] == 1 and result:
            result.pop(requested[0], None)
        return result

    def counted_move(*args, **kwargs):
        calls["forced_root_fallback"] += 1
        return original_move(*args, **kwargs)

    client.evaluate_best_move = counted_best
    client.evaluate_root_moves = counted_roots
    client.evaluate_move = counted_move
    threshold = 0.002 if scenario == "refinement" else 0.8
    started = perf_counter()
    try:
        result = compute_cti(
            board,
            client,
            FixedPolicy(top_move),
            acceptable_drop=0.3,
            prev_eval=0.0,
            full_depth=depth,
            minefield_threshold=threshold,
        )
        elapsed_ms = (perf_counter() - started) * 1000
        return {
            "scenario": scenario,
            "wall_elapsed_ms": round(elapsed_ms, 1),
            "calls": dict(calls),
            "restricted_root_counts": root_counts,
            "restricted_elapsed_ms": [round(value, 1) for value in root_elapsed_ms],
            "cti_bounds": [
                round(result.cti_lower_bound, 6) if result.cti_lower_bound is not None else None,
                round(result.cti_upper_bound, 6) if result.cti_upper_bound is not None else None,
            ],
            "comparison_status": getattr(result, "comparison_status", "legacy"),
        }
    finally:
        client.close()


def main() -> None:
    depth = 10
    path = settings.stockfish_path
    discovery_client = new_stockfish(path, depth)
    try:
        discovery = discovery_client.evaluate_best_move(chess.Board(), depth=depth)
        if discovery is None:
            raise RuntimeError("Stockfish returned no benchmark discovery root")
        top_move = discovery[0]
    finally:
        discovery_client.close()

    rows = [
        run_scenario(path, depth, top_move, scenario)
        for scenario in ("normal", "refinement", "retry")
    ]
    print(
        json.dumps(
            {
                "app_root": str(app_root),
                "stockfish": path,
                "depth": depth,
                "threads": 1,
                "hash_mb": 64,
                "policy_top_root": top_move.uci(),
                "results": rows,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
