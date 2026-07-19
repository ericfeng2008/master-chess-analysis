from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.mistakes import MistakeRepository, derive_mistake_suggestions
from app.persistence import AnalysisRepository, Database
from app.persistence.database import MIGRATION_1, MIGRATION_2, MIGRATION_3, SCHEMA_VERSION
from app.persistence.models import AnalysisRunSnapshot
from app.persistence.provenance import parse_single_game_pgn
from app.routers.mistake_router import router


TEST_PGN = '[White "Master"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. d4 *'


def run_payload() -> dict:
    base = {
        "move_number": 1,
        "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "move": "e4",
        "best_move": "d4",
        "good_moves": ["d4"],
        "good_moves_with_eval": {"d4": 0.0},
        "best_line": ["d4", "d5"],
        "stockfish_eval": 0.4,
        "eval_after": -0.4,
        "cti": 0.9,
        "cti_lower_bound": 0.86,
        "cti_upper_bound": 0.91,
        "cti_is_approximate": True,
        "played_move_eval_drop": 0.8,
        "mbi_classification": None,
        "mbi_maia_prob": None,
        "side": "white",
    }
    black = {**base, "side": "black", "move": "e5", "mbi_classification": "cognitive_trap", "mbi_maia_prob": 0.55}
    natural = {
        **base,
        "move_number": 2,
        "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        "cti": 0.3,
        "cti_lower_bound": 0.28,
        "cti_upper_bound": 0.32,
        "mbi_classification": "cognitive_trap",
        "mbi_maia_prob": 0.62,
    }
    overlap = {
        **base,
        "move_number": 3,
        "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
        "mbi_classification": "cognitive_trap",
        "mbi_maia_prob": 0.48,
    }
    solved = {**base, "move_number": 4, "played_move_eval_drop": 0.1, "move": "d4", "best_move": "d4"}
    parsed = parse_single_game_pgn(TEST_PGN)
    return {
        "id": "run-1",
        "headers": {"White": "Master", "Black": "Opponent", "Event": "Test"},
        "request": {
            "acceptable_drop": 0.5,
            "minefield_threshold": 0.8,
            "blunder_threshold": 1.0,
            "mbi_trap_threshold": 0.4,
            "engine_depth": 12,
            "maia3_white_elo": 2400,
            "maia3_black_elo": 2350,
        },
        "engine": {"name": "Stockfish"},
        "maia": {"model": "maia3-79m"},
        "metric_schema_version": 2,
        "result": {
            "moves": [base, black, natural, {**black, "move_number": 2}, overlap, {**black, "move_number": 3}, solved],
            "move_context": list(parsed.move_context),
        },
    }


def create_run(
    database: Database,
    *,
    depth: int = 12,
    pgn: str = TEST_PGN,
    payload: dict | None = None,
) -> str:
    payload = payload or run_payload()
    request = {**payload["request"], "engine_depth": depth}
    snapshot = AnalysisRunSnapshot(
        normalized_pgn=pgn,
        headers=payload["headers"],
        request=request,
        engine=payload["engine"],
        maia=payload["maia"],
        metric_schema_version=payload["metric_schema_version"],
        result=payload["result"],
        pgn_fingerprint="game",
        provenance_fingerprint="provenance",
    )
    return AnalysisRepository(database).create_analysis_run(snapshot)


def test_schema3_upgrades_to_current_schema_without_losing_existing_rows(tmp_path):
    path = tmp_path / "analysis.db"
    connection = sqlite3.connect(path)
    connection.executescript(MIGRATION_1 + MIGRATION_2 + MIGRATION_3)
    connection.execute("PRAGMA user_version=3")
    connection.execute(
        """INSERT INTO analysis_runs VALUES
           ('run','game','prov','*','{}','{}','{}','{}',1,'{"moves":[]}','now','now')"""
    )
    connection.commit()
    connection.close()

    database = Database(path)
    database.initialize()
    with database.connect() as upgraded:
        assert upgraded.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert upgraded.execute("SELECT id FROM analysis_runs").fetchone()[0] == "run"
        assert upgraded.execute("SELECT name FROM sqlite_master WHERE name='saved_mistakes'").fetchone()
        assert upgraded.execute("SELECT name FROM sqlite_master WHERE name='games'").fetchone()
        assert upgraded.execute("SELECT count(*) FROM migration_issues").fetchone()[0] == 1
    assert database.last_backup_path and database.last_backup_path.exists()


def test_selector_uses_union_lower_bound_and_side_isolation():
    suggestions = derive_mistake_suggestions(run_payload(), "white")
    assert [item["ply"] for item in suggestions] == [0, 2, 4]
    assert suggestions[0]["system_reasons"] == ["high_cti_mistake"]
    assert suggestions[1]["system_reasons"] == ["human_natural_blunder"]
    assert suggestions[2]["system_reasons"] == ["high_cti_mistake", "human_natural_blunder"]
    assert suggestions[0]["evidence"]["maia3_white_elo"] == 2400


def test_repository_save_tags_attempt_lifecycle_and_full_game_preservation(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    run_id = create_run(database)
    repository = MistakeRepository(database)

    first = repository.save_selected(run_id, "white", [0, 2])
    repeated = repository.save_selected(run_id, "white", [0])
    assert len(first["created"]) == 2
    assert repeated["created"] == [] and len(repeated["existing"]) == 1

    mistake_id = first["created"][0]["id"]
    updated = repository.replace_tags(mistake_id, ["Calculation horizon", "My motif"])
    assert updated and updated["tags"] == ["Calculation horizon", "My motif"]
    repository.replace_tags(mistake_id, ["Calculation horizon"])
    assert "My motif" not in {tag["name"] for tag in repository.list_tags()}
    repository.replace_tags(mistake_id, ["Calculation horizon", "My motif"])
    repository.update_mistake(mistake_id, note="Check forcing replies")
    attempt = repository.add_attempt(mistake_id, "d4", "understood")
    assert attempt and attempt["objective_acceptable"] is True
    detail = repository.get_mistake(mistake_id)
    assert detail and detail["note"] == "Check forcing replies"
    assert detail["last_practice_state"] == "understood"
    assert len(detail["attempts"]) == 1
    assert repository.list_mistakes(player_name="mast")["total"] == 2
    assert repository.list_mistakes(player_name="opponent", tag="My motif")["total"] == 1
    assert repository.list_mistakes(player_name="unknown")["total"] == 0

    repository.update_mistake(mistake_id, lifecycle="archived")
    assert repository.list_mistakes()["total"] == 1
    assert repository.list_mistakes(lifecycle="archived")["total"] == 1
    assert repository.delete_mistake(mistake_id)
    assert repository.get_game(run_id) is not None


def test_legacy_training_import_preserves_note_and_tags_idempotently(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    run_id = create_run(database)
    with database.transaction() as connection:
        connection.execute(
            """INSERT INTO training_items (
                id,analysis_run_id,lifecycle,verification_status,study_side,primary_type,
                source_snapshot_json,solution_json,training_note,search_text,created_at,updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "legacy-item", run_id, "active", "verified", "white", "cognitive_trap",
                '{"decision_fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}',
                '{}', "Legacy note", "legacy", "now", "now",
            ),
        )
        connection.execute(
            "INSERT INTO training_tags(id,name,created_at,updated_at) VALUES(?,?,?,?)",
            ("legacy-tag", "Legacy tag", "now", "now"),
        )
        connection.execute(
            "INSERT INTO training_item_tags(item_id,tag_id,created_at) VALUES(?,?,?)",
            ("legacy-item", "legacy-tag", "now"),
        )

    repository = MistakeRepository(database)
    summary = repository.import_legacy_training_items()
    repeated = repository.import_legacy_training_items()
    result = repository.list_mistakes()
    assert summary["imported"] == 1
    assert repeated["existing"] == 1
    assert result["total"] == 1
    assert result["items"][0]["note"] == "Legacy note"
    assert result["items"][0]["tags"] == ["Legacy tag"]


def test_minimal_api_end_to_end(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    run_id = create_run(database)
    app = FastAPI()
    app.state.mistake_repository = MistakeRepository(database)
    app.include_router(router)
    client = TestClient(app)

    suggestions = client.get(
        f"/api/stored-games/{run_id}/mistake-suggestions", params={"study_side": "white"}
    )
    assert suggestions.status_code == 200 and len(suggestions.json()["items"]) == 3
    saved = client.post(
        "/api/saved-mistakes",
        json={"analysis_run_id": run_id, "study_side": "white", "plies": [0]},
    )
    assert saved.status_code == 200
    mistake_id = saved.json()["created"][0]["id"]
    assert client.put(
        f"/api/saved-mistakes/{mistake_id}/tags", json={"names": ["Calculation horizon"]}
    ).status_code == 200
    attempt = client.post(
        f"/api/saved-mistakes/{mistake_id}/attempts",
        json={"chosen_move": "d4", "outcome": "understood"},
    )
    assert attempt.status_code == 200 and attempt.json()["objective_acceptable"] is True
    assert client.get(f"/api/analysis-runs/{run_id}").json()["normalized_pgn"].startswith("[White")
    assert client.get("/api/saved-mistakes", params={"player_name": "master"}).json()["total"] == 1
    assert client.get("/api/review-sessions/legacy").status_code == 404
    assert client.get("/api/training-items").status_code == 404
    assert client.get("/api/player-profiles").status_code == 404
    assert client.delete(f"/api/saved-mistakes/{mistake_id}").status_code == 204
    assert client.get(f"/api/analysis-runs/{run_id}").status_code == 200


def test_cross_analysis_suggestions_only_return_additional_mistakes(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    run_12 = create_run(database, depth=12)
    repository = MistakeRepository(database)
    saved = repository.save_selected(run_12, "white", [0])
    mistake_id = saved["created"][0]["id"]
    repository.update_mistake(mistake_id, note="Keep my original reasoning")

    run_18 = create_run(database, depth=18)
    assert [item["ply"] for item in repository.suggestions(run_18, "white")] == [2, 4]
    repeated = repository.save_selected(run_18, "white", [0])
    assert repeated["created"] == [] and repeated["existing"][0]["id"] == mistake_id
    detail = repository.get_mistake(mistake_id)
    assert detail["analysis_run_id"] == run_12
    assert detail["note"] == "Keep my original reasoning"

    repository.update_mistake(mistake_id, lifecycle="archived")
    assert 0 not in [item["ply"] for item in repository.suggestions(run_18, "white")]
    repository.delete_mistake(mistake_id)
    assert 0 in [item["ply"] for item in repository.suggestions(run_18, "white")]


def test_cross_game_identity_and_concurrent_saves_are_isolated(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    first_run = create_run(database, depth=12)
    repository = MistakeRepository(database)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda _index: repository.save_selected(first_run, "white", [0]),
                range(2),
            )
        )
    assert sum(len(result["created"]) for result in results) == 1
    assert sum(len(result["existing"]) for result in results) == 1

    other_pgn = '[White "A"]\n[Black "B"]\n\n1. e4 c5 2. Nf3 *'
    other_payload = run_payload()
    other_payload["result"] = {
        "moves": other_payload["result"]["moves"][:1],
        "minefields": [],
        "move_context": list(parse_single_game_pgn(other_pgn).move_context),
    }
    other_run = create_run(database, pgn=other_pgn, payload=other_payload)
    other_suggestions = repository.suggestions(other_run, "white")
    assert other_suggestions[0]["ply"] == 0
    assert other_suggestions[0]["mistake_fingerprint"] != repository.get_mistake(
        results[0]["created"][0]["id"] if results[0]["created"] else results[1]["created"][0]["id"]
    )["mistake_fingerprint"]


def test_saved_mistake_remains_when_newest_analysis_no_longer_flags_it(tmp_path):
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    run = create_run(database, depth=12)
    repository = MistakeRepository(database)
    mistake_id = repository.save_selected(run, "white", [0])["created"][0]["id"]

    newer_payload = run_payload()
    newer_payload["result"]["moves"][0] = {
        **newer_payload["result"]["moves"][0],
        "played_move_eval_drop": 0.0,
        "cti_lower_bound": 0.1,
        "mbi_classification": None,
    }
    newer_run = create_run(database, depth=19, payload=newer_payload)
    assert 0 not in [item["ply"] for item in repository.suggestions(newer_run, "white")]
    assert repository.get_mistake(mistake_id) is not None
