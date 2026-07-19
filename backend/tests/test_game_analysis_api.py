from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.analysis.data_models import AnalysisCompleteEvent
from app.mistakes import MistakeRepository
from app.models.schemas import AnalyzeRequest
from app.persistence import AnalysisRepository, Database
from app.persistence.provenance import build_analysis_snapshot
from app.routers import analysis_router as analysis_module
from app.routers.analysis_router import router as analysis_router
from app.routers.mistake_router import router as mistake_router


PGN = '[Event "API"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 *'
DECORATED = '[Event "Changed"]\n\n1. e4! {note} e5 (1... c5) 2. Nf3 1-0'
OTHER = '[Event "Other"]\n\n1. d4 d5 *'


class FakeStockfish:
    depth = 12

    @property
    def identity(self):
        return {
            "name": "Stockfish 17",
            "path": "/fake/stockfish",
            "depth": self.depth,
            "threads": 1,
            "hash_mb": 16,
        }


class FakeMaia:
    model_name = "maia3-79m"
    checkpoint_path = Path("model.pt")
    device = "cpu"
    use_history = True


class CountingLock:
    def __init__(self):
        self.entries = 0

    def __enter__(self):
        self.entries += 1
        return self

    def __exit__(self, *args):
        return False


def make_app(tmp_path, *, persistence: bool = True):
    app = FastAPI()
    database = Database(tmp_path / "analysis.db")
    database.initialize()
    repository = AnalysisRepository(database) if persistence else None
    app.state.analysis_repository = repository
    app.state.mistake_repository = MistakeRepository(database) if persistence else None
    app.state.persistence_warning = None if persistence else "Local database unavailable"
    app.state.stockfish = FakeStockfish()
    app.state.maia = FakeMaia()
    app.state.stockfish_lock = CountingLock()
    app.include_router(analysis_router)
    app.include_router(mistake_router)
    return app, repository


def upload(client: TestClient, pgn: str = PGN):
    return client.post(
        "/api/upload-pgn",
        files={"file": ("game.pgn", pgn.encode("utf-8"), "application/x-chess-pgn")},
    )


def complete_event(response) -> dict:
    chunks = [line for line in response.text.splitlines() if line.startswith("data: ")]
    import json

    return json.loads(chunks[-1][6:])


def test_upload_persists_reuses_and_accepts_multiple_games(tmp_path):
    app, repository = make_app(tmp_path)
    client = TestClient(app)
    multiple = upload(client, PGN + "\n\n" + OTHER + "\n\n" + DECORATED)
    assert multiple.status_code == 200
    imported = multiple.json()
    assert imported["pgn"].startswith('[Event "API"]')
    assert imported["metadata"]["Event"] == "API"
    assert imported["num_variations"] == 0 and imported["max_depth"] == 3
    assert imported["num_games"] == 3
    assert imported["num_unique_games"] == imported["num_games_saved"] == 2
    assert imported["num_games_added"] == 2
    assert imported["num_games_existing"] == 0
    assert imported["num_duplicate_games"] == 1
    assert imported["preferred_analysis_run_id"] is None
    assert app.state.stockfish_lock.entries == 0
    assert repository.analysis_history(imported["game_id"]) == []

    listing = client.get("/api/stored-games?analysis_state=not_analyzed").json()
    assert listing["total"] == 2
    assert {item["metadata"]["Event"] for item in listing["items"]} == {"API", "Other"}

    repeated = upload(client, PGN + "\n\n" + OTHER + "\n\n" + DECORATED).json()
    assert repeated["game_id"] == imported["game_id"]
    assert repeated["num_games_added"] == 0
    assert repeated["num_games_existing"] == 2
    assert repeated["num_duplicate_games"] == 1


def test_upload_rejects_an_invalid_later_game_without_partial_persistence(tmp_path):
    app, repository = make_app(tmp_path)
    client = TestClient(app)

    response = upload(client, PGN + '\n\n[Event "Empty"]\n\n*')

    assert response.status_code == 400
    assert "Game 2" in response.json()["detail"]
    assert repository.find_game_by_fingerprint("missing") is None
    assert client.get("/api/stored-games").json()["total"] == 0


def test_upload_restores_first_game_history_without_analyzing_trailing_games(tmp_path):
    app, repository = make_app(tmp_path)
    client = TestClient(app)
    first = upload(client).json()
    run_id = repository.create_analysis_run(build_analysis_snapshot(
        first["pgn"],
        request=AnalyzeRequest(pgn=first["pgn"], game_id=first["game_id"]).model_dump(),
        engine=app.state.stockfish.identity,
        maia={"model": "maia3-79m", "checkpoint": "model.pt", "device": "cpu", "use_history": True},
        moves=[], minefields=[], game_id=first["game_id"],
    ))

    response = upload(client, PGN + "\n\n" + OTHER).json()

    assert response["game_id"] == first["game_id"]
    assert response["preferred_analysis_run_id"] == run_id
    assert [item["id"] for item in response["analysis_history"]] == [run_id]
    assert response["num_games_added"] == 1 and response["num_games_existing"] == 1
    assert app.state.stockfish_lock.entries == 0
    listing = client.get("/api/stored-games?analysis_state=not_analyzed").json()
    assert listing["total"] == 1 and listing["items"][0]["metadata"]["Event"] == "Other"


def test_multi_game_upload_degrades_to_first_game_in_memory_without_persistence(tmp_path):
    app, _repository = make_app(tmp_path, persistence=False)
    client = TestClient(app)

    response = upload(client, PGN + "\n\n" + OTHER).json()

    assert response["pgn"].startswith('[Event "API"]')
    assert response["num_games"] == response["num_unique_games"] == 2
    assert response["num_games_saved"] == 0
    assert response["num_games_added"] == response["num_games_existing"] == 0
    assert response["game_id"] is None
    assert response["persistence_warning"] == "Local database unavailable"
    assert app.state.stockfish_lock.entries == 0


def test_exact_cache_hit_skips_engine_and_changed_settings_create_history(tmp_path, monkeypatch):
    app, repository = make_app(tmp_path)
    client = TestClient(app)
    uploaded = upload(client).json()
    game_id = uploaded["game_id"]
    request = AnalyzeRequest(pgn=uploaded["pgn"], game_id=game_id)
    seeded = build_analysis_snapshot(
        uploaded["pgn"],
        request=request.model_dump(),
        engine=app.state.stockfish.identity,
        maia={
            "model": "maia3-79m",
            "checkpoint": "model.pt",
            "device": "cpu",
            "use_history": True,
        },
        moves=[],
        minefields=[],
        game_id=game_id,
    )
    run_id = repository.create_analysis_run(seeded)

    cached_response = client.post("/api/analyze", json=request.model_dump())
    cached = complete_event(cached_response)
    assert cached_response.status_code == 200
    assert cached["cache_hit"] is True and cached["analysis_run_id"] == run_id
    assert app.state.stockfish_lock.entries == 0

    calls = []

    def fake_analyze_game(**kwargs):
        calls.append(kwargs)
        yield AnalysisCompleteEvent(moves=[], minefields=[])

    monkeypatch.setattr(analysis_module, "analyze_game", fake_analyze_game)
    changed = request.model_copy(update={"engine_depth": 13})
    calculated = complete_event(client.post("/api/analyze", json=changed.model_dump()))
    assert calculated["cache_hit"] is False
    assert calculated["analysis_run_id"] != run_id
    assert len(calculated["analysis_history"]) == 2
    assert len(calls) == 1 and app.state.stockfish_lock.entries == 1

    cached_again = complete_event(client.post("/api/analyze", json=changed.model_dump()))
    assert cached_again["cache_hit"] is True
    assert len(calls) == 1 and app.state.stockfish_lock.entries == 1


def test_analysis_rejects_mismatched_game_id(tmp_path):
    app, _repository = make_app(tmp_path)
    client = TestClient(app)
    game_id = upload(client).json()["game_id"]
    response = client.post(
        "/api/analyze", json=AnalyzeRequest(pgn=OTHER, game_id=game_id).model_dump()
    )
    assert response.status_code == 409
    assert "does not match" in response.json()["detail"]


def test_analysis_endpoint_remains_strictly_single_game(tmp_path):
    app, _repository = make_app(tmp_path)
    client = TestClient(app)

    response = client.post(
        "/api/analyze",
        json=AnalyzeRequest(pgn=PGN + "\n\n" + OTHER).model_dump(),
    )

    assert response.status_code == 400
    assert "one game" in response.json()["detail"]
    assert app.state.stockfish_lock.entries == 0


def test_stored_game_endpoints_address_game_and_specific_run(tmp_path):
    app, repository = make_app(tmp_path)
    client = TestClient(app)
    imported = upload(client).json()
    game_id = imported["game_id"]
    run_id = repository.create_analysis_run(build_analysis_snapshot(
        imported["pgn"],
        request=AnalyzeRequest(pgn=imported["pgn"], game_id=game_id).model_dump(),
        engine=app.state.stockfish.identity,
        maia={"model": "maia3-79m", "checkpoint": "model.pt", "device": "cpu", "use_history": True},
        moves=[], minefields=[], game_id=game_id,
    ))
    logical = client.get(f"/api/stored-games/{game_id}").json()
    run = client.get(f"/api/analysis-runs/{run_id}").json()
    assert logical["id"] == game_id
    assert logical["analysis"]["id"] == run_id
    assert run["game_id"] == game_id


def test_persistence_failure_is_visible_but_upload_and_analysis_continue(tmp_path, monkeypatch):
    app, _repository = make_app(tmp_path, persistence=False)
    client = TestClient(app)
    imported = upload(client)
    assert imported.status_code == 200
    assert imported.json()["game_id"] is None
    assert imported.json()["persistence_warning"] == "Local database unavailable"

    monkeypatch.setattr(
        analysis_module,
        "analyze_game",
        lambda **_kwargs: iter([AnalysisCompleteEvent(moves=[], minefields=[])]),
    )
    completed = complete_event(
        client.post("/api/analyze", json=AnalyzeRequest(pgn=PGN).model_dump())
    )
    assert completed["analysis_run_id"] is None
    assert completed["persistence_warning"] == "Local database unavailable"


def test_metadata_precedence_listing_and_open_are_logical_game_operations(tmp_path):
    app, _repository = make_app(tmp_path)
    client = TestClient(app)
    imported = upload(client).json()
    game_id = imported["game_id"]
    assert imported["metadata"] == {"Event": "API", "White": "A", "Black": "B"}

    patched = client.patch(
        f"/api/stored-games/{game_id}/metadata", json={"Event": "Manual event"}
    )
    assert patched.status_code == 200
    assert patched.json()["metadata_sources"]["Event"] == "manual"

    repeated = upload(client, DECORATED).json()
    assert repeated["game_id"] == game_id
    assert repeated["metadata"]["Event"] == "Manual event"
    assert repeated["imported_metadata"]["Event"] == "Changed"

    cleared = client.patch(f"/api/stored-games/{game_id}/metadata", json={"Event": None})
    assert cleared.status_code == 200
    assert cleared.json()["metadata"]["Event"] == "Changed"

    unicode = client.patch(f"/api/stored-games/{game_id}/metadata", json={"White": "  Élodie 李  "})
    assert unicode.status_code == 200
    assert unicode.json()["metadata"]["White"] == "Élodie 李"
    trimmed_limit = client.patch(
        f"/api/stored-games/{game_id}/metadata", json={"Black": f" {'B' * 200} "}
    )
    assert trimmed_limit.status_code == 200
    assert trimmed_limit.json()["metadata"]["Black"] == "B" * 200
    too_long = client.patch(f"/api/stored-games/{game_id}/metadata", json={"White": "x" * 201})
    assert too_long.status_code == 422
    assert client.get(f"/api/stored-games/{game_id}").json()["metadata"]["White"] == "Élodie 李"

    listing = client.get("/api/stored-games", params={"query": "changed", "analysis_state": "not_analyzed"})
    assert listing.status_code == 200
    assert listing.json()["total"] == 1
    opened = client.post(f"/api/stored-games/{game_id}/open")
    assert opened.status_code == 200
    assert opened.json()["analysis"] is None
    assert opened.json()["last_opened_at"]


def test_metadata_edit_preserves_exact_cached_analysis(tmp_path):
    app, repository = make_app(tmp_path)
    client = TestClient(app)
    imported = upload(client).json()
    request = AnalyzeRequest(pgn=imported["pgn"], game_id=imported["game_id"])
    run_id = repository.create_analysis_run(build_analysis_snapshot(
        imported["pgn"], request=request.model_dump(), engine=app.state.stockfish.identity,
        maia={"model": "maia3-79m", "checkpoint": "model.pt", "device": "cpu", "use_history": True},
        moves=[], minefields=[], game_id=imported["game_id"],
    ))
    assert client.patch(f"/api/stored-games/{imported['game_id']}/metadata", json={"White": "Åsa"}).status_code == 200
    cached = complete_event(client.post("/api/analyze", json=request.model_dump()))
    assert cached["cache_hit"] is True
    assert cached["analysis_run_id"] == run_id
    assert app.state.stockfish_lock.entries == 0
