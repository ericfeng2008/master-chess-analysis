"""Small repeatable full-game workload benchmark for OpenSpec verification.

Set BENCH_APP_ROOT to compare another checkout's backend implementation while
using this runner. The benchmark never changes Stockfish Hash during a run.
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

from app.analysis.analyzer import analyze_game  # noqa: E402
from app.engines.stockfish_client import StockfishClient  # noqa: E402

try:  # The pre-optimization comparison revision has no diagnostics module.
    from app.analysis.diagnostics import AnalysisDiagnostics, activate_diagnostics  # noqa: E402
except ModuleNotFoundError:
    AnalysisDiagnostics = None
    activate_diagnostics = None


PGN = """[Event "Workload benchmark"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 *
"""


class ConcentratedMaia:
    model_name = "benchmark-policy"
    use_history = True

    def __init__(self):
        self.calls = 0

    def predict(self, board, **_kwargs):
        self.calls += 1
        moves = list(board.legal_moves)
        if not moves:
            return {}
        tail = 0.004 / max(1, len(moves) - 1)
        return {move: 0.996 if index == 0 else tail for index, move in enumerate(moves)}


class CountingEngine:
    def __init__(self, engine):
        self.engine = engine
        self.id = engine.id
        self.searches = 0
        self.nodes = 0
        self.elapsed_ms = 0.0

    def analyse(self, board, limit, **kwargs):
        started = perf_counter()
        result = self.engine.analyse(board, limit, **kwargs)
        self.elapsed_ms += (perf_counter() - started) * 1000
        self.searches += 1
        rows = result if isinstance(result, list) else [result]
        self.nodes += max((int(row.get("nodes", 0)) for row in rows), default=0)
        return result

    def quit(self):
        return self.engine.quit()


def instrument_methods(client):
    counts: Counter[str] = Counter()
    snapshots_by_fen: Counter[str] = Counter()
    original_quick = client.quick_evaluate
    original_best = client.evaluate_best_move
    original_snapshot = client.evaluate_root_snapshot

    def counted_quick(*args, **kwargs):
        counts["depth_probes"] += 1
        return original_quick(*args, **kwargs)

    def counted_best(*args, **kwargs):
        counts["timeline_single_pv"] += 1
        return original_best(*args, **kwargs)

    def counted_snapshot(board, *args, **kwargs):
        fen = board.fen()
        category = "coherent_snapshots" if snapshots_by_fen[fen] == 0 else "refinements"
        snapshots_by_fen[fen] += 1
        counts[category] += 1
        result = original_snapshot(board, *args, **kwargs)
        counts["snapshot_retries"] += max(0, int(getattr(result, "attempts", 1)) - 1)
        return result

    client.quick_evaluate = counted_quick
    client.evaluate_best_move = counted_best
    client.evaluate_root_snapshot = counted_snapshot
    return counts, snapshots_by_fen


def main() -> None:
    kwargs = {"depth": 10, "threads": 2, "hash_mb": 256}
    if "search_cache_entries" in inspect.signature(StockfishClient).parameters:
        kwargs["search_cache_entries"] = 2048
    runs = []
    for analysis_scope in ("both", "white", "black"):
        client = StockfishClient("/opt/homebrew/bin/stockfish", **kwargs)
        engine = CountingEngine(client.engine)
        client.engine = engine
        method_counts, snapshots_by_fen = instrument_methods(client)
        try:
            for cache_state in ("cold", "warm"):
                snapshots_by_fen.clear()
                searches_before = engine.searches
                nodes_before = engine.nodes
                engine_ms_before = engine.elapsed_ms
                methods_before = method_counts.copy()
                maia = ConcentratedMaia()
                started = perf_counter()
                diagnostics = AnalysisDiagnostics("benchmark") if AnalysisDiagnostics else None
                if diagnostics is not None and activate_diagnostics is not None:
                    with activate_diagnostics(diagnostics):
                        complete = list(
                            analyze_game(
                                PGN,
                                client,
                                maia,
                                analysis_scope=analysis_scope,
                            )
                        )[-1]
                    stage_totals = diagnostics.summary("complete")["stages"]
                else:
                    complete = list(
                        analyze_game(
                            PGN,
                            client,
                            maia,
                            analysis_scope=analysis_scope,
                        )
                    )[-1]
                    stage_totals = None
                call_categories = {
                    key: method_counts[key] - methods_before[key]
                    for key in (
                        "timeline_single_pv",
                        "depth_probes",
                        "coherent_snapshots",
                        "refinements",
                        "snapshot_retries",
                    )
                }
                call_categories["maia_inferences"] = maia.calls
                runs.append(
                    {
                        "analysis_scope": analysis_scope,
                        "cache_state": cache_state,
                        "plies": len(complete.moves),
                        "wall_elapsed_ms": round((perf_counter() - started) * 1000, 1),
                        "stockfish_searches": engine.searches - searches_before,
                        "stockfish_nodes": engine.nodes - nodes_before,
                        "stockfish_elapsed_ms": round(engine.elapsed_ms - engine_ms_before, 1),
                        "call_categories": call_categories,
                        "serialized_best_line_detail_entries": sum(
                            len(move.best_line_evals) for move in complete.moves
                        ),
                        "stage_totals": stage_totals,
                    }
                )
        finally:
            client.close()

    print(json.dumps({"depth": 10, "threads": 2, "hash_mb": 256, "runs": runs}))


if __name__ == "__main__":
    main()
