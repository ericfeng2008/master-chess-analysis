from __future__ import annotations

import json
import sqlite3

import pytest

from app.mistakes import MistakeRepository
from app.persistence import AnalysisRepository, Database, DatabaseUnavailableError
from app.persistence.database import (
    MIGRATION_1,
    MIGRATION_2,
    MIGRATION_3,
    MIGRATION_4,
    MIGRATION_5,
    SCHEMA_VERSION,
)
from app.persistence.provenance import build_analysis_snapshot


PGN = '[Event "Original"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 *'
DECORATED_PGN = (
    '[Event "Updated"]\n[White "Renamed"]\n[Black "B"]\n\n'
    '1. e4! {central [%clk 0:10:00]} e5 (1... c5) 2. Nf3 1-0'
)


def snapshot(pgn: str = PGN, depth: int = 12):
    return build_analysis_snapshot(
        pgn,
        request={
            "engine_depth": depth,
            "acceptable_drop": 0.5,
            "minefield_threshold": 0.8,
        },
        engine={"name": "Stockfish 17", "path": "/one/stockfish", "threads": 2},
        maia={"model": "maia3-79m", "checkpoint": "model.pt", "use_history": True},
        moves=[],
        minefields=[],
    )


def create_schema4(path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(MIGRATION_1 + MIGRATION_2 + MIGRATION_3 + MIGRATION_4)
    connection.execute("PRAGMA user_version=4")
    connection.commit()
    connection.close()


def create_schema5(path) -> None:
    create_schema4(path)
    connection = sqlite3.connect(path)
    connection.executescript(MIGRATION_5)
    connection.execute("PRAGMA user_version=5")
    connection.commit()
    connection.close()


def test_game_upsert_history_cache_and_grouped_listing(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    analyses = AnalysisRepository(database)

    first = analyses.upsert_game(PGN)
    repeated = analyses.upsert_game(DECORATED_PGN)
    assert repeated["id"] == first["id"]
    assert repeated["headers"]["Event"] == "Updated"

    run_12 = analyses.create_analysis_run(snapshot(PGN, 12))
    assert analyses.create_analysis_run(snapshot(DECORATED_PGN, 12)) == run_12
    run_18 = analyses.create_analysis_run(snapshot(DECORATED_PGN, 18))
    assert run_18 != run_12

    history = analyses.analysis_history(first["id"])
    assert {item["engine_depth"] for item in history} == {12, 18}
    assert analyses.preferred_analysis_run(first["id"])["id"] == run_18
    compatible = analyses.find_compatible_analysis(
        first["id"], analyses.get_analysis_run(run_12)["analysis_fingerprint"]
    )
    assert compatible and compatible["id"] == run_12

    listing = MistakeRepository(database).list_games()
    assert listing["total"] == 1
    assert listing["items"][0]["analysis_count"] == 2
    assert listing["items"][0]["preferred_analysis_run_id"] == run_18


def test_import_and_completed_analysis_survive_repository_restart(tmp_path):
    path = tmp_path / "analysis.db"
    first_database = Database(path)
    first_database.initialize()
    imported = AnalysisRepository(first_database).upsert_game(PGN)
    first_database.close()

    before_analysis_database = Database(path)
    before_analysis_database.initialize()
    before_analysis = AnalysisRepository(before_analysis_database)
    assert before_analysis.get_game(imported["id"])["normalized_pgn"].startswith('[Event "Original"]')
    assert before_analysis.analysis_history(imported["id"]) == []
    run_id = before_analysis.create_analysis_run(snapshot(PGN, 12))
    before_analysis_database.close()

    completed_database = Database(path)
    completed_database.initialize()
    completed = AnalysisRepository(completed_database)
    assert completed.preferred_analysis_run(imported["id"])["id"] == run_id
    assert len(completed.analysis_history(imported["id"])) == 1


def test_schema5_groups_equivalent_runs_and_reconciles_duplicate_mistakes(tmp_path):
    path = tmp_path / "analysis.db"
    create_schema4(path)
    connection = sqlite3.connect(path)
    request_12 = json.dumps({"engine_depth": 12})
    request_18 = json.dumps({"engine_depth": 18})
    for run_id, pgn, old_game, old_prov, request in (
        ("run-a", PGN, "old-a", "prov-a", request_12),
        ("run-b", DECORATED_PGN, "old-b", "prov-b", request_18),
    ):
        connection.execute(
            """INSERT INTO analysis_runs
               (id,pgn_fingerprint,provenance_fingerprint,normalized_pgn,headers_json,
                request_json,engine_json,maia_json,metric_schema_version,result_json,
                created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                run_id,
                old_game,
                old_prov,
                pgn,
                '{}',
                request,
                '{"name":"Stockfish 17"}',
                '{"model":"maia3-79m"}',
                2,
                '{"moves":[]}',
                "2026-01-01T00:00:00+00:00" if run_id == "run-a" else "2026-01-02T00:00:00+00:00",
                "2026-01-01T00:00:00+00:00" if run_id == "run-a" else "2026-01-02T00:00:00+00:00",
            ),
        )
    initial_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    for mistake_id, run_id, note, created in (
        ("mistake-a", "run-a", "First note", "2026-01-01T00:00:00+00:00"),
        ("mistake-b", "run-b", "Second note", "2026-01-02T00:00:00+00:00"),
    ):
        connection.execute(
            """INSERT INTO saved_mistakes
               (id,analysis_run_id,ply,move_number,side,decision_fen,played_move,best_move,
                objective_loss,system_reasons_json,evidence_json,note,lifecycle,practice_count,
                last_practice_state,last_practiced_at,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                mistake_id,
                run_id,
                0,
                1,
                "white",
                initial_fen,
                "e4",
                "d4",
                0.8,
                '["high_cti_mistake"]',
                json.dumps({"source": run_id}),
                note,
                "active" if mistake_id == "mistake-a" else "archived",
                1,
                "understood",
                created,
                created,
                created,
            ),
        )
        tag_id = f"tag-{mistake_id}"
        connection.execute(
            "INSERT INTO mistake_tags VALUES (?,?,?,?,?)",
            (tag_id, tag_id, tag_id, created, created),
        )
        connection.execute(
            "INSERT INTO saved_mistake_tags VALUES (?,?,?)",
            (mistake_id, tag_id, created),
        )
        connection.execute(
            """INSERT INTO mistake_attempts
               (id,mistake_id,chosen_move,revealed_without_move,objective_acceptable,
                outcome,revealed_at,created_at) VALUES (?,?,?,?,?,?,?,?)""",
            (f"attempt-{mistake_id}", mistake_id, "d4", 0, 1, "understood", created, created),
        )
    connection.commit()
    connection.close()

    database = Database(path)
    database.initialize()
    with database.connect() as upgraded:
        assert upgraded.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert upgraded.execute("SELECT count(*) FROM games").fetchone()[0] == 1
        assert upgraded.execute(
            "SELECT count(DISTINCT game_id) FROM analysis_runs"
        ).fetchone()[0] == 1
        mistakes = upgraded.execute("SELECT * FROM saved_mistakes").fetchall()
        assert len(mistakes) == 1
        assert "First note" in mistakes[0]["note"] and "Second note" in mistakes[0]["note"]
        assert upgraded.execute("SELECT count(*) FROM saved_mistake_tags").fetchone()[0] == 2
        assert upgraded.execute("SELECT count(*) FROM mistake_attempts").fetchone()[0] == 2
        alias = upgraded.execute("SELECT * FROM mistake_id_aliases").fetchone()
        assert alias["retired_id"] == "mistake-b"
        metadata = json.loads(mistakes[0]["migration_metadata_json"])
        assert metadata["merged_legacy_duplicates"][0]["evidence"]["source"] == "run-b"
    assert database.last_backup_path and database.last_backup_path.exists()


def test_unparseable_legacy_run_is_preserved_and_reported(tmp_path):
    path = tmp_path / "analysis.db"
    create_schema4(path)
    connection = sqlite3.connect(path)
    connection.execute(
        """INSERT INTO analysis_runs VALUES
           ('legacy','old','prov','*','{}','{}','{}','{}',2,'{"moves":[]}','now','now')"""
    )
    connection.commit()
    connection.close()

    database = Database(path)
    database.initialize()
    with database.connect() as upgraded:
        row = upgraded.execute("SELECT * FROM analysis_runs WHERE id='legacy'").fetchone()
        assert row is not None and row["game_id"] is None and row["cacheable"] == 0
        assert upgraded.execute("SELECT count(*) FROM migration_issues").fetchone()[0] == 1


def test_schema5_backfill_failure_rolls_back_structural_changes(tmp_path):
    path = tmp_path / "analysis.db"
    create_schema4(path)

    class FailingDatabase(Database):
        def _backfill_schema_5(self, connection):
            raise RuntimeError("injected backfill failure")

    database = FailingDatabase(path)
    with pytest.raises(DatabaseUnavailableError, match="injected backfill failure"):
        database.initialize()
    connection = sqlite3.connect(path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 4
        assert connection.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()[0] == 0
    finally:
        connection.close()
    assert database.last_backup_path and database.last_backup_path.exists()


def test_schema6_backfills_complete_partial_placeholder_malformed_and_empty_metadata(tmp_path):
    path = tmp_path / "analysis.db"
    create_schema5(path)
    connection = sqlite3.connect(path)
    rows = (
        ("complete", '{"Event":" Club ","White":"A","Black":"B"}'),
        ("partial", '{"Event":"?","White":"W"}'),
        ("malformed", "not-json"),
        ("empty", "{}"),
    )
    for game_id, headers in rows:
        connection.execute(
            """INSERT INTO games
               (id,fingerprint_version,game_fingerprint,canonical_initial_fen,mainline_uci_json,
                normalized_pgn,headers_json,move_count,created_at,updated_at,last_opened_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (game_id, 1, game_id, "start", "[]", "*", headers, 0, "now", "now", "now"),
        )
    connection.commit()
    connection.close()

    database = Database(path)
    database.initialize()
    with database.connect() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        imported = {row["id"]: json.loads(row["imported_metadata_json"]) for row in connection.execute("SELECT id, imported_metadata_json FROM games")}
        assert imported["complete"] == {"Black": "B", "Event": "Club", "White": "A"}
        assert imported["partial"] == {"White": "W"}
        assert imported["malformed"] == imported["empty"] == {}
        assert connection.execute("SELECT metadata_overrides_json FROM games WHERE id='complete'").fetchone()[0] == "{}"
        issue = connection.execute("SELECT schema_version FROM migration_issues WHERE entity_id='malformed'").fetchone()
        assert issue and issue[0] == 6
    assert database.last_backup_path and database.last_backup_path.exists()


def test_schema6_backfill_failure_rolls_back_structural_changes(tmp_path):
    path = tmp_path / "analysis.db"
    create_schema5(path)

    class FailingDatabase(Database):
        def _backfill_schema_6(self, connection):
            raise RuntimeError("injected metadata backfill failure")

    database = FailingDatabase(path)
    with pytest.raises(DatabaseUnavailableError, match="injected metadata backfill failure"):
        database.initialize()
    connection = sqlite3.connect(path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 5
        names = {row[1] for row in connection.execute("PRAGMA table_info(games)")}
        assert "imported_metadata_json" not in names
    finally:
        connection.close()
    assert database.last_backup_path and database.last_backup_path.exists()
