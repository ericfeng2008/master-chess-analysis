from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from .database import Database
from .models import AnalysisRunSnapshot, json_dumps, json_loads
from .metadata import (
    CORE_METADATA_KEYS,
    effective_metadata,
    merge_imported_metadata,
    normalize_override,
)
from .provenance import (
    GAME_FINGERPRINT_VERSION,
    ParsedPgn,
    analysis_fingerprint,
    game_fingerprint,
    parse_single_game_pgn,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AnalysisRepository:
    """Logical-game storage and immutable, provenance-aware analysis history."""

    def __init__(self, database: Database):
        self.database = database

    def upsert_game(self, pgn: str | ParsedPgn) -> dict[str, Any]:
        parsed = pgn if isinstance(pgn, ParsedPgn) else parse_single_game_pgn(pgn)
        digest = game_fingerprint(parsed)
        now = utc_now()
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM games WHERE game_fingerprint=?", (digest,)
            ).fetchone()
            if row is None:
                game_id = str(uuid.uuid4())
                connection.execute(
                    """INSERT INTO games
                       (id,fingerprint_version,game_fingerprint,canonical_initial_fen,
                        mainline_uci_json,normalized_pgn,headers_json,move_count,
                        created_at,updated_at,last_opened_at,imported_metadata_json,
                        metadata_overrides_json,metadata_updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        game_id,
                        GAME_FINGERPRINT_VERSION,
                        digest,
                        parsed.initial_fen,
                        json_dumps(list(parsed.mainline_uci)),
                        parsed.normalized_pgn,
                        json_dumps(parsed.headers),
                        parsed.move_count,
                        now,
                        now,
                        now,
                        json_dumps(merge_imported_metadata({}, parsed.headers)),
                        "{}",
                        now,
                    ),
                )
            else:
                game_id = str(row["id"])
                imported = merge_imported_metadata(
                    json_loads(row["imported_metadata_json"], {}), parsed.headers
                )
                connection.execute(
                    """UPDATE games SET fingerprint_version=?,canonical_initial_fen=?,
                       mainline_uci_json=?,normalized_pgn=?,headers_json=?,move_count=?,
                       updated_at=?,last_opened_at=?,imported_metadata_json=?,
                       metadata_updated_at=? WHERE id=?""",
                    (
                        GAME_FINGERPRINT_VERSION,
                        parsed.initial_fen,
                        json_dumps(list(parsed.mainline_uci)),
                        parsed.normalized_pgn,
                        json_dumps(parsed.headers),
                        parsed.move_count,
                        now,
                        now,
                        json_dumps(imported),
                        now,
                        game_id,
                    ),
                )
        result = self.get_game(game_id)
        if result is None:  # pragma: no cover - transaction invariant
            raise RuntimeError("Persisted game could not be read")
        return result

    def resolve_game(self, game_id: str | None, pgn: str) -> dict[str, Any]:
        parsed = parse_single_game_pgn(pgn)
        digest = game_fingerprint(parsed)
        if game_id is None:
            return self.upsert_game(parsed)
        game = self.get_game(game_id)
        if game is None:
            raise KeyError(game_id)
        if game["game_fingerprint"] != digest:
            raise ValueError("Submitted PGN does not match the supplied game ID")
        return game

    def get_game(self, game_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM games WHERE id=?", (game_id,)).fetchone()
        return self._game(row) if row else None

    def find_game_by_fingerprint(self, digest: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM games WHERE game_fingerprint=?", (digest,)
            ).fetchone()
        return self._game(row) if row else None

    def analysis_history(self, game_id: str) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """SELECT * FROM analysis_runs
                   WHERE game_id=? ORDER BY created_at DESC,id DESC""",
                (game_id,),
            ).fetchall()
        return [self._history_summary(row) for row in rows]

    def preferred_analysis_run(self, game_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM analysis_runs WHERE game_id=?
                   ORDER BY created_at DESC,id DESC LIMIT 1""",
                (game_id,),
            ).fetchone()
        return self._analysis_run(row) if row else None

    def game_import_result(self, game: dict[str, Any]) -> dict[str, Any]:
        history = self.analysis_history(str(game["id"]))
        return {
            **game,
            "analysis_history": history,
            "preferred_analysis_run_id": history[0]["id"] if history else None,
        }

    def logical_game_detail(self, game_id: str, analysis_run_id: str | None = None) -> dict[str, Any] | None:
        game = self.get_game(game_id)
        if game is None:
            return None
        run = self.get_analysis_run(analysis_run_id) if analysis_run_id else self.preferred_analysis_run(game_id)
        if run is not None and run.get("game_id") != game_id:
            return None
        history = self.analysis_history(game_id)
        return {
            **game,
            "analysis_history": history,
            "preferred_analysis_run_id": history[0]["id"] if history else None,
            "analysis": run,
        }

    def open_game(self, game_id: str) -> dict[str, Any] | None:
        now = utc_now()
        with self.database.transaction() as connection:
            changed = connection.execute(
                "UPDATE games SET last_opened_at=? WHERE id=?", (now, game_id)
            ).rowcount
        return self.logical_game_detail(game_id) if changed else None

    def update_metadata(self, game_id: str, patch: dict[str, object]) -> dict[str, Any] | None:
        unknown = set(patch) - set(CORE_METADATA_KEYS)
        if unknown:
            raise ValueError(f"Unknown metadata field: {sorted(unknown)[0]}")
        normalized = {key: normalize_override(value, key) for key, value in patch.items()}
        now = utc_now()
        with self.database.transaction() as connection:
            row = connection.execute("SELECT metadata_overrides_json FROM games WHERE id=?", (game_id,)).fetchone()
            if row is None:
                return None
            overrides = json_loads(row["metadata_overrides_json"], {})
            if not isinstance(overrides, dict):
                overrides = {}
            for key, value in normalized.items():
                if value is None:
                    overrides.pop(key, None)
                else:
                    overrides[key] = value
            connection.execute(
                """UPDATE games SET metadata_overrides_json=?,metadata_updated_at=?,updated_at=?
                   WHERE id=?""",
                (json_dumps(overrides), now, now, game_id),
            )
        return self.get_game(game_id)

    def compatible_fingerprint(
        self,
        game: dict[str, Any],
        request: dict[str, Any],
        engine: dict[str, Any],
        maia: dict[str, Any],
        metric_schema_version: int,
    ) -> str:
        return analysis_fingerprint(
            str(game["game_fingerprint"]),
            request,
            engine,
            maia,
            metric_schema_version,
        )

    def find_compatible_analysis(
        self, game_id: str, compatibility_digest: str
    ) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM analysis_runs
                   WHERE game_id=? AND analysis_fingerprint=? AND cacheable=1
                   ORDER BY created_at DESC,id DESC LIMIT 1""",
                (game_id, compatibility_digest),
            ).fetchone()
        return self._analysis_run(row) if row else None

    def create_analysis_run(self, snapshot: AnalysisRunSnapshot) -> str:
        game = self.resolve_game(snapshot.game_id, snapshot.normalized_pgn)
        game_id = str(game["id"])
        compatibility_digest = analysis_fingerprint(
            str(game["game_fingerprint"]),
            snapshot.request,
            snapshot.engine,
            snapshot.maia,
            snapshot.metric_schema_version,
        )
        existing = self.find_compatible_analysis(game_id, compatibility_digest)
        if existing:
            return str(existing["id"])

        run_id = str(uuid.uuid4())
        now = utc_now()
        with self.database.transaction() as connection:
            existing_row = connection.execute(
                """SELECT id FROM analysis_runs
                   WHERE game_id=? AND analysis_fingerprint=? AND cacheable=1
                   ORDER BY created_at DESC,id DESC LIMIT 1""",
                (game_id, compatibility_digest),
            ).fetchone()
            if existing_row:
                return str(existing_row["id"])
            try:
                connection.execute(
                    """INSERT INTO analysis_runs (
                        id,pgn_fingerprint,provenance_fingerprint,normalized_pgn,
                        headers_json,request_json,engine_json,maia_json,
                        metric_schema_version,result_json,created_at,updated_at,
                        game_id,analysis_fingerprint,cacheable
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
                    (
                        run_id,
                        game["game_fingerprint"],
                        compatibility_digest,
                        snapshot.normalized_pgn,
                        json_dumps(snapshot.headers),
                        json_dumps(snapshot.request),
                        json_dumps(snapshot.engine),
                        json_dumps(snapshot.maia),
                        snapshot.metric_schema_version,
                        json_dumps(snapshot.result),
                        now,
                        now,
                        game_id,
                        compatibility_digest,
                    ),
                )
            except Exception:
                existing_row = connection.execute(
                    """SELECT id FROM analysis_runs
                       WHERE game_id=? AND analysis_fingerprint=? AND cacheable=1
                       ORDER BY created_at DESC,id DESC LIMIT 1""",
                    (game_id, compatibility_digest),
                ).fetchone()
                if existing_row:
                    return str(existing_row["id"])
                raise
        return run_id

    def find_analysis_run(
        self, pgn_fingerprint: str, provenance_fingerprint: str
    ) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """SELECT * FROM analysis_runs
                   WHERE pgn_fingerprint=? AND provenance_fingerprint=?
                   ORDER BY created_at DESC LIMIT 1""",
                (pgn_fingerprint, provenance_fingerprint),
            ).fetchone()
        return self._analysis_run(row) if row else None

    def get_analysis_run(self, run_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM analysis_runs WHERE id=?", (run_id,)
            ).fetchone()
        return self._analysis_run(row) if row else None

    @staticmethod
    def _game(row) -> dict[str, Any]:
        source_headers = json_loads(row["headers_json"], {})
        imported = json_loads(row["imported_metadata_json"], {})
        overrides = json_loads(row["metadata_overrides_json"], {})
        metadata, metadata_sources, metadata_missing, headers = effective_metadata(
            source_headers if isinstance(source_headers, dict) else {},
            imported if isinstance(imported, dict) else {},
            overrides if isinstance(overrides, dict) else {},
        )
        return {
            "id": row["id"],
            "fingerprint_version": row["fingerprint_version"],
            "game_fingerprint": row["game_fingerprint"],
            "canonical_initial_fen": row["canonical_initial_fen"],
            "mainline_uci": json_loads(row["mainline_uci_json"], []),
            "normalized_pgn": row["normalized_pgn"],
            "headers": headers,
            "source_headers": source_headers,
            "imported_metadata": imported,
            "metadata_overrides": overrides,
            "metadata": metadata,
            "metadata_sources": metadata_sources,
            "metadata_missing": metadata_missing,
            "metadata_updated_at": row["metadata_updated_at"],
            "move_count": row["move_count"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_opened_at": row["last_opened_at"],
        }

    @staticmethod
    def _history_summary(row) -> dict[str, Any]:
        request = json_loads(row["request_json"], {})
        return {
            "id": row["id"],
            "game_id": row["game_id"],
            "analysis_fingerprint": row["analysis_fingerprint"],
            "created_at": row["created_at"],
            "engine_depth": request.get("engine_depth"),
            "request": request,
            "engine": json_loads(row["engine_json"], {}),
            "maia": json_loads(row["maia_json"], {}),
            "metric_schema_version": row["metric_schema_version"],
        }

    @staticmethod
    def _analysis_run(row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "game_id": row["game_id"],
            "pgn_fingerprint": row["pgn_fingerprint"],
            "provenance_fingerprint": row["provenance_fingerprint"],
            "analysis_fingerprint": row["analysis_fingerprint"],
            "cacheable": bool(row["cacheable"]),
            "normalized_pgn": row["normalized_pgn"],
            "headers": json_loads(row["headers_json"], {}),
            "request": json_loads(row["request_json"], {}),
            "engine": json_loads(row["engine_json"], {}),
            "maia": json_loads(row["maia_json"], {}),
            "metric_schema_version": row["metric_schema_version"],
            "result": json_loads(row["result_json"], {}),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
