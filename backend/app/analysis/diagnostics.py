"""Request-scoped workload diagnostics for engine-backed analysis.

Diagnostics intentionally stay out of public API models. They are emitted as one
structured log record per request and never include PGN or FEN content.
"""

from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
import json
import logging
from time import perf_counter
from typing import Any, Iterator
from uuid import uuid4


logger = logging.getLogger("app.analysis.workload")
logger.setLevel(logging.INFO)


def aggregate_engine_info(infos: Any) -> tuple[int, int]:
    """Return per-search nodes/hashfull without summing duplicated MultiPV totals."""
    rows = infos if isinstance(infos, list) else [infos]
    nodes = [int(row.get("nodes", 0)) for row in rows if isinstance(row, dict)]
    hashfull = [int(row.get("hashfull", 0)) for row in rows if isinstance(row, dict)]
    return max(nodes, default=0), max(hashfull, default=0)


class AnalysisDiagnostics:
    def __init__(self, request_kind: str, correlation_id: str | None = None):
        self.request_kind = request_kind
        self.correlation_id = correlation_id or uuid4().hex
        self.started_at = perf_counter()
        self.searches: list[dict[str, Any]] = []
        self.stage_elapsed_ms: dict[str, float] = defaultdict(float)
        self._emitted = False

    def record_search(
        self,
        *,
        search_kind: str,
        stage: str,
        elapsed_ms: float,
        nodes: int,
        hashfull: int,
        root_count: int,
        depth: int,
        cache_outcome: str,
        failed: bool = False,
    ) -> None:
        self.searches.append(
            {
                "search_kind": search_kind,
                "stage": stage,
                "elapsed_ms": round(elapsed_ms, 3),
                "nodes": nodes,
                "hashfull": hashfull,
                "root_count": root_count,
                "depth": depth,
                "cache_outcome": cache_outcome,
                "evictions": 0,
                "failed": failed,
            }
        )

    def record_eviction(self) -> None:
        if self.searches:
            self.searches[-1]["evictions"] += 1

    def summary(self, status: str, error_type: str | None = None) -> dict[str, Any]:
        stages: dict[str, dict[str, Any]] = {}
        for row in self.searches:
            aggregate = stages.setdefault(
                row["stage"],
                {
                    "searches": 0,
                    "cache_hits": 0,
                    "elapsed_ms": 0.0,
                    "nodes": 0,
                    "hashfull_max": 0,
                    "evictions": 0,
                },
            )
            aggregate["searches"] += 1
            aggregate["cache_hits"] += int(row["cache_outcome"] == "hit")
            aggregate["elapsed_ms"] += row["elapsed_ms"]
            aggregate["nodes"] += row["nodes"]
            aggregate["hashfull_max"] = max(aggregate["hashfull_max"], row["hashfull"])
            aggregate["evictions"] += row["evictions"]

        for stage, elapsed in self.stage_elapsed_ms.items():
            stages.setdefault(stage, {})["stage_elapsed_ms"] = round(elapsed, 3)
        for aggregate in stages.values():
            if "elapsed_ms" in aggregate:
                aggregate["elapsed_ms"] = round(aggregate["elapsed_ms"], 3)

        result: dict[str, Any] = {
            "event": "analysis_workload",
            "correlation_id": self.correlation_id,
            "request_kind": self.request_kind,
            "status": status,
            "elapsed_ms": round((perf_counter() - self.started_at) * 1000, 3),
            "stockfish_searches": sum(row["cache_outcome"] != "hit" for row in self.searches),
            "cache_hits": sum(row["cache_outcome"] == "hit" for row in self.searches),
            "nodes": sum(row["nodes"] for row in self.searches),
            "evictions": sum(row["evictions"] for row in self.searches),
            "stages": stages,
            "searches": self.searches,
        }
        if error_type is not None:
            result["error_type"] = error_type
        return result

    def emit(self, status: str, error_type: str | None = None) -> None:
        if self._emitted:
            return
        self._emitted = True
        logger.info(json.dumps(self.summary(status, error_type), sort_keys=True))


_collector: ContextVar[AnalysisDiagnostics | None] = ContextVar(
    "analysis_diagnostics", default=None
)
_stage: ContextVar[str] = ContextVar("analysis_diagnostic_stage", default="unattributed")


@contextmanager
def diagnostic_scope(
    request_kind: str, correlation_id: str | None = None
) -> Iterator[AnalysisDiagnostics]:
    collector = AnalysisDiagnostics(request_kind, correlation_id)
    collector_token = _collector.set(collector)
    stage_token = _stage.set("request")
    try:
        yield collector
    except BaseException as exc:
        collector.emit("failure", type(exc).__name__)
        raise
    else:
        collector.emit("complete")
    finally:
        _stage.reset(stage_token)
        _collector.reset(collector_token)


@contextmanager
def activate_diagnostics(collector: AnalysisDiagnostics) -> Iterator[None]:
    """Activate an existing collector for one non-yielding unit of generator work."""
    collector_token = _collector.set(collector)
    stage_token = _stage.set("request")
    try:
        yield
    finally:
        _stage.reset(stage_token)
        _collector.reset(collector_token)


@contextmanager
def diagnostic_stage(stage: str) -> Iterator[None]:
    token = _stage.set(stage)
    started = perf_counter()
    try:
        yield
    finally:
        collector = _collector.get()
        if collector is not None:
            collector.stage_elapsed_ms[stage] += (perf_counter() - started) * 1000
        _stage.reset(token)


def record_stockfish_search(
    *,
    search_kind: str,
    elapsed_ms: float,
    infos: Any,
    root_count: int,
    depth: int,
    cache_outcome: str,
    failed: bool = False,
) -> None:
    collector = _collector.get()
    if collector is None:
        return
    nodes, hashfull = aggregate_engine_info(infos)
    collector.record_search(
        search_kind=search_kind,
        stage=_stage.get(),
        elapsed_ms=elapsed_ms,
        nodes=nodes,
        hashfull=hashfull,
        root_count=root_count,
        depth=depth,
        cache_outcome=cache_outcome,
        failed=failed,
    )


def record_cache_eviction() -> None:
    collector = _collector.get()
    if collector is not None:
        collector.record_eviction()
