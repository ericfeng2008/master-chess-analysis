import json
import logging

from app.analysis.diagnostics import (
    aggregate_engine_info,
    diagnostic_scope,
    diagnostic_stage,
    record_cache_eviction,
    record_stockfish_search,
)


def test_multipv_nodes_and_hashfull_are_aggregated_once():
    infos = [
        {"nodes": 1200, "hashfull": 50},
        {"nodes": 1180, "hashfull": 52},
        {"nodes": 1190, "hashfull": 51},
    ]
    assert aggregate_engine_info(infos) == (1200, 52)


def test_structured_success_summary_has_stages_cache_and_no_chess_content(caplog):
    caplog.set_level(logging.INFO, logger="app.analysis.workload")
    with diagnostic_scope("lazy_variation_detail", "correlation-test"):
        with diagnostic_stage("lazy_variation_detail"):
            record_stockfish_search(
                search_kind="restricted_roots",
                elapsed_ms=12.5,
                infos=[{"nodes": 100}, {"nodes": 90}],
                root_count=2,
                depth=10,
                cache_outcome="miss",
            )
            record_cache_eviction()
            record_stockfish_search(
                search_kind="restricted_roots",
                elapsed_ms=0,
                infos=[],
                root_count=2,
                depth=10,
                cache_outcome="hit",
            )

    payload = json.loads(caplog.records[-1].message)
    assert payload["status"] == "complete"
    assert payload["correlation_id"] == "correlation-test"
    assert payload["stockfish_searches"] == 1
    assert payload["cache_hits"] == 1
    assert payload["nodes"] == 100
    assert payload["evictions"] == 1
    assert "lazy_variation_detail" in payload["stages"]
    assert "pgn" not in caplog.records[-1].message.lower()
    assert "fen" not in caplog.records[-1].message.lower()


def test_failure_summary_is_emitted_once(caplog):
    caplog.set_level(logging.INFO, logger="app.analysis.workload")
    try:
        with diagnostic_scope("full_analysis", "failed-test"):
            raise ValueError("secret PGN content")
    except ValueError:
        pass

    payload = json.loads(caplog.records[-1].message)
    assert payload["status"] == "failure"
    assert payload["error_type"] == "ValueError"
    assert "secret" not in caplog.records[-1].message
