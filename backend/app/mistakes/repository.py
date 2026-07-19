from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

import chess

from app.persistence import AnalysisRepository, Database
from app.persistence.models import json_dumps, json_loads

from .models import MistakeAttempt, MistakeOutcome, StoredGameSummary
from .selection import derive_mistake_suggestions


DEFAULT_TAGS = (
    "Candidate generation",
    "Calculation horizon",
    "Opponent resource",
    "Resulting-position evaluation",
    "Strategic plan",
    "Opening memory",
    "Defensive resource",
    "Time management",
    "Execution",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_tag(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


class MistakeRepository:
    def __init__(self, database: Database):
        self.database = database
        self.seed_default_tags()

    def seed_default_tags(self) -> None:
        now = utc_now()
        with self.database.transaction() as connection:
            for name in DEFAULT_TAGS:
                connection.execute(
                    """INSERT OR IGNORE INTO mistake_tags
                       (id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?)""",
                    (str(uuid.uuid4()), name, normalize_tag(name), now, now),
                )

    def get_game(self, analysis_run_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """SELECT a.*,g.game_fingerprint
                   FROM analysis_runs a LEFT JOIN games g ON g.id=a.game_id
                   WHERE a.id=?""",
                (analysis_run_id,),
            ).fetchone()
        if row is None:
            return None
        return self._game(row)

    def get_logical_game(
        self, game_id: str, analysis_run_id: str | None = None
    ) -> dict[str, Any] | None:
        analyses = AnalysisRepository(self.database)
        return analyses.logical_game_detail(game_id, analysis_run_id)

    def list_games(self, query: str = "", page: int = 1, page_size: int = 25, analysis_state: str = "all", sort: str = "recent") -> dict[str, Any]:
        page = max(1, page)
        page_size = min(100, max(1, page_size))
        with self.database.connect() as connection:
            rows = connection.execute(
                f"""SELECT g.*,count(DISTINCT a.id) AS analysis_count,
                           count(DISTINCT m.id) AS mistake_count,
                           (SELECT newest.id FROM analysis_runs newest
                            WHERE newest.game_id=g.id
                            ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1)
                           AS preferred_analysis_run_id
                    FROM games g
                    LEFT JOIN analysis_runs a ON a.game_id=g.id
                    LEFT JOIN saved_mistakes m ON m.analysis_run_id=a.id
                    GROUP BY g.id""",
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            game = AnalysisRepository._game(row)
            if analysis_state == "analyzed" and not int(row["analysis_count"]):
                continue
            if analysis_state == "not_analyzed" and int(row["analysis_count"]):
                continue
            haystack = " ".join(game["metadata"].values()).casefold()
            if query.strip() and query.strip().casefold() not in haystack:
                continue
            items.append(StoredGameSummary(
                id=row["id"], headers=game["headers"], created_at=row["created_at"], updated_at=row["updated_at"],
                mistake_count=int(row["mistake_count"]), move_count=int(row["move_count"]),
                analysis_count=int(row["analysis_count"]), preferred_analysis_run_id=row["preferred_analysis_run_id"],
                metadata=game["metadata"], metadata_sources=game["metadata_sources"], metadata_missing=game["metadata_missing"],
                last_opened_at=row["last_opened_at"], result=game["headers"].get("Result"),
            ).to_dict())
        if sort == "players":
            items.sort(key=lambda item: (item["metadata"].get("White", "").casefold(), item["metadata"].get("Black", "").casefold(), item["id"]))
        elif sort == "added":
            items.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
        else:
            items.sort(key=lambda item: (item["last_opened_at"], item["updated_at"], item["id"]), reverse=True)
        total = len(items)
        start = (page - 1) * page_size
        return {"items": items[start:start + page_size], "total": total, "page": page, "page_size": page_size}

    def suggestions(
        self, analysis_run_id: str, study_side: str, *, include_saved: bool = False
    ) -> list[dict[str, Any]]:
        game = self.get_game(analysis_run_id)
        if game is None:
            raise KeyError(analysis_run_id)
        suggestions = derive_mistake_suggestions(game, study_side)
        fingerprints = [item["mistake_fingerprint"] for item in suggestions]
        with self.database.connect() as connection:
            existing: set[str] = set()
            if fingerprints:
                placeholders = ",".join("?" for _ in fingerprints)
                existing = {
                    str(row[0])
                    for row in connection.execute(
                        f"""SELECT mistake_fingerprint FROM saved_mistakes
                            WHERE mistake_fingerprint IN ({placeholders})""",
                        fingerprints,
                    )
                }
        for item in suggestions:
            item["saved"] = item["mistake_fingerprint"] in existing
        return suggestions if include_saved else [item for item in suggestions if not item["saved"]]

    def save_selected(
        self, analysis_run_id: str, study_side: str, plies: list[int]
    ) -> dict[str, Any]:
        game = self.get_game(analysis_run_id)
        if game is None:
            raise KeyError(analysis_run_id)
        eligible = {
            item["ply"]: item for item in derive_mistake_suggestions(game, study_side)
        }
        requested = list(dict.fromkeys(int(ply) for ply in plies))
        invalid = [ply for ply in requested if ply not in eligible]
        if invalid:
            raise ValueError(f"Ply is not an eligible {study_side} mistake: {invalid[0]}")
        created: list[dict[str, Any]] = []
        existing: list[dict[str, Any]] = []
        now = utc_now()
        with self.database.transaction() as connection:
            for ply in requested:
                item = eligible[ply]
                row = connection.execute(
                    "SELECT id FROM saved_mistakes WHERE mistake_fingerprint=?",
                    (item["mistake_fingerprint"],),
                ).fetchone()
                if row:
                    existing.append({"id": row["id"], "ply": ply})
                    continue
                mistake_id = str(uuid.uuid4())
                connection.execute(
                    """INSERT INTO saved_mistakes
                       (id,analysis_run_id,ply,move_number,side,decision_fen,played_move,best_move,
                        objective_loss,cti,cti_lower_bound,cti_upper_bound,cti_is_approximate,
                        mbi_classification,mbi_maia_prob,system_reasons_json,evidence_json,
                        note,lifecycle,created_at,updated_at,played_move_uci,mistake_fingerprint)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'','active',?,?,?,?)""",
                    (
                        mistake_id, analysis_run_id, ply, item["move_number"], study_side,
                        item["decision_fen"], item["played_move"], item["best_move"],
                        item["objective_loss"], item["cti"], item["cti_lower_bound"],
                        item["cti_upper_bound"], int(item["cti_is_approximate"]),
                        item["mbi_classification"], item["mbi_maia_prob"],
                        json_dumps(item["system_reasons"]), json_dumps(item["evidence"]),
                        now, now, item["played_move_uci"], item["mistake_fingerprint"],
                    ),
                )
                created.append({"id": mistake_id, "ply": ply})
        return {"created": created, "existing": existing}

    def list_mistakes(
        self,
        *,
        query: str = "",
        player_name: str = "",
        side: str | None = None,
        reason: str | None = None,
        tag: str | None = None,
        lifecycle: str = "active",
        practice_state: str | None = None,
        analysis_run_id: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> dict[str, Any]:
        page = max(1, page)
        page_size = min(100, max(1, page_size))
        where = ["m.lifecycle=?"]
        params: list[Any] = [lifecycle]
        joins = ""
        if tag:
            joins += " JOIN saved_mistake_tags mt ON mt.mistake_id=m.id JOIN mistake_tags t ON t.id=mt.tag_id"
            where.append("t.normalized_name=?")
            params.append(normalize_tag(tag))
        if query.strip():
            where.append("lower(m.note || ' ' || coalesce(json_extract(g.metadata_overrides_json,'$.Event'),json_extract(g.imported_metadata_json,'$.Event'),json_extract(g.headers_json,'$.Event'),'') || ' ' || coalesce(json_extract(g.metadata_overrides_json,'$.White'),json_extract(g.imported_metadata_json,'$.White'),json_extract(g.headers_json,'$.White'),'') || ' ' || coalesce(json_extract(g.metadata_overrides_json,'$.Black'),json_extract(g.imported_metadata_json,'$.Black'),json_extract(g.headers_json,'$.Black'),'') || ' ' || m.played_move) LIKE ?")
            params.append(f"%{query.strip().lower()}%")
        if player_name.strip():
            where.append(
                "lower(coalesce(json_extract(g.metadata_overrides_json,'$.White'),json_extract(g.imported_metadata_json,'$.White'),json_extract(g.headers_json,'$.White'),json_extract(a.headers_json,'$.White'),'') || ' ' || "
                "coalesce(json_extract(g.metadata_overrides_json,'$.Black'),json_extract(g.imported_metadata_json,'$.Black'),json_extract(g.headers_json,'$.Black'),json_extract(a.headers_json,'$.Black'),'')) LIKE ?"
            )
            params.append(f"%{player_name.strip().lower()}%")
        if side:
            where.append("m.side=?")
            params.append(side)
        if reason:
            where.append("m.system_reasons_json LIKE ?")
            params.append(f'%"{reason}"%')
        if practice_state:
            where.append("m.last_practice_state=?")
            params.append(practice_state)
        if analysis_run_id:
            where.append("m.analysis_run_id=?")
            params.append(analysis_run_id)
        clause = " AND ".join(where)
        from_sql = f"FROM saved_mistakes m JOIN analysis_runs a ON a.id=m.analysis_run_id LEFT JOIN games g ON g.id=a.game_id {joins} WHERE {clause}"
        with self.database.connect() as connection:
            total = connection.execute(
                f"SELECT count(DISTINCT m.id) {from_sql}", params
            ).fetchone()[0]
            rows = connection.execute(
                f"""SELECT DISTINCT m.*,a.game_id,
                    coalesce(g.headers_json,a.headers_json) AS headers_json,
                    coalesce(g.created_at,a.created_at) AS game_created_at
                    {from_sql} ORDER BY m.updated_at DESC,m.ply LIMIT ? OFFSET ?""",
                [*params, page_size, (page - 1) * page_size],
            ).fetchall()
            items = [self._mistake(connection, row) for row in rows]
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def get_mistake(self, mistake_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """SELECT m.*,a.game_id,
                          coalesce(g.headers_json,a.headers_json) AS headers_json,
                          coalesce(g.created_at,a.created_at) AS game_created_at
                   FROM saved_mistakes m
                   JOIN analysis_runs a ON a.id=m.analysis_run_id
                   LEFT JOIN games g ON g.id=a.game_id
                   WHERE m.id=? OR m.id=(SELECT canonical_id FROM mistake_id_aliases WHERE retired_id=?)""",
                (mistake_id, mistake_id),
            ).fetchone()
            return self._mistake(connection, row, include_attempts=True) if row else None

    def update_mistake(
        self, mistake_id: str, *, note: str | None = None, lifecycle: str | None = None
    ) -> dict[str, Any] | None:
        if lifecycle is not None and lifecycle not in {"active", "archived"}:
            raise ValueError("lifecycle must be active or archived")
        with self.database.transaction() as connection:
            row = connection.execute("SELECT * FROM saved_mistakes WHERE id=?", (mistake_id,)).fetchone()
            if row is None:
                return None
            connection.execute(
                """UPDATE saved_mistakes SET note=?,lifecycle=?,updated_at=? WHERE id=?""",
                (
                    row["note"] if note is None else note,
                    row["lifecycle"] if lifecycle is None else lifecycle,
                    utc_now(), mistake_id,
                ),
            )
        return self.get_mistake(mistake_id)

    def delete_mistake(self, mistake_id: str) -> bool:
        with self.database.transaction() as connection:
            cursor = connection.execute("DELETE FROM saved_mistakes WHERE id=?", (mistake_id,))
        return cursor.rowcount > 0

    def list_tags(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """SELECT t.id,t.name,count(mt.mistake_id) AS item_count
                   FROM mistake_tags t LEFT JOIN saved_mistake_tags mt ON mt.tag_id=t.id
                   GROUP BY t.id ORDER BY lower(t.name)"""
            ).fetchall()
        return [{"id": row["id"], "name": row["name"], "item_count": row["item_count"]} for row in rows]

    def replace_tags(self, mistake_id: str, names: list[str]) -> dict[str, Any] | None:
        clean = list(dict.fromkeys(name.strip() for name in names if name.strip()))
        if len(clean) > 50 or any(len(name) > 80 for name in clean):
            raise ValueError("Tags must contain 1 to 80 characters; maximum 50")
        now = utc_now()
        with self.database.transaction() as connection:
            if connection.execute("SELECT 1 FROM saved_mistakes WHERE id=?", (mistake_id,)).fetchone() is None:
                return None
            connection.execute("DELETE FROM saved_mistake_tags WHERE mistake_id=?", (mistake_id,))
            for name in clean:
                normalized = normalize_tag(name)
                row = connection.execute(
                    "SELECT id FROM mistake_tags WHERE normalized_name=?", (normalized,)
                ).fetchone()
                tag_id = row["id"] if row else str(uuid.uuid4())
                if row is None:
                    connection.execute(
                        "INSERT INTO mistake_tags(id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?)",
                        (tag_id, name, normalized, now, now),
                    )
                connection.execute(
                    "INSERT INTO saved_mistake_tags(mistake_id,tag_id,created_at) VALUES(?,?,?)",
                    (mistake_id, tag_id, now),
                )
            default_names = tuple(normalize_tag(name) for name in DEFAULT_TAGS)
            placeholders = ",".join("?" for _ in default_names)
            connection.execute(
                f"""DELETE FROM mistake_tags
                    WHERE normalized_name NOT IN ({placeholders})
                      AND NOT EXISTS (
                        SELECT 1 FROM saved_mistake_tags mt WHERE mt.tag_id=mistake_tags.id
                      )""",
                default_names,
            )
            connection.execute("UPDATE saved_mistakes SET updated_at=? WHERE id=?", (now, mistake_id))
        return self.get_mistake(mistake_id)

    def add_attempt(
        self, mistake_id: str, chosen_move: str | None, outcome: str
    ) -> dict[str, Any] | None:
        if outcome not in {str(MistakeOutcome.AGAIN), str(MistakeOutcome.UNDERSTOOD)}:
            raise ValueError("outcome must be again or understood")
        item = self.get_mistake(mistake_id)
        if item is None:
            return None
        normalized_move = chosen_move.strip() if chosen_move else None
        acceptable = False
        if normalized_move:
            board = chess.Board(item["decision_fen"])
            try:
                move = board.parse_san(normalized_move)
            except ValueError as exc:
                raise ValueError("Submitted move must be legal SAN") from exc
            normalized_move = board.san(move)
            acceptable = normalized_move in item["evidence"].get("good_moves", [])
        now = utc_now()
        attempt = MistakeAttempt(
            id=str(uuid.uuid4()), mistake_id=mistake_id, chosen_move=normalized_move,
            revealed_without_move=normalized_move is None, objective_acceptable=acceptable,
            outcome=outcome, revealed_at=now, created_at=now,
        )
        with self.database.transaction() as connection:
            connection.execute(
                """INSERT INTO mistake_attempts
                   (id,mistake_id,chosen_move,revealed_without_move,objective_acceptable,outcome,revealed_at,created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (
                    attempt.id, mistake_id, normalized_move, int(attempt.revealed_without_move),
                    int(acceptable), outcome, now, now,
                ),
            )
            connection.execute(
                """UPDATE saved_mistakes SET last_practice_state=?,practice_count=practice_count+1,
                   last_practiced_at=?,updated_at=? WHERE id=?""",
                (outcome, now, now, mistake_id),
            )
        return attempt.to_dict()

    def list_attempts(self, mistake_id: str) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM mistake_attempts WHERE mistake_id=? ORDER BY created_at DESC",
                (mistake_id,),
            ).fetchall()
        return [self._attempt(row) for row in rows]

    def import_legacy_training_items(self) -> dict[str, int]:
        summary = {"imported": 0, "existing": 0, "skipped": 0, "attempts": 0}
        with self.database.connect() as connection:
            table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_items'"
            ).fetchone()
            if table is None:
                return summary
            rows = connection.execute(
                "SELECT * FROM training_items WHERE analysis_run_id IS NOT NULL ORDER BY created_at"
            ).fetchall()
        for legacy in rows:
            if self._import_legacy_item(legacy, summary):
                summary["imported"] += 1
        return summary

    def _import_legacy_item(self, legacy, summary: dict[str, int]) -> bool:
        with self.database.connect() as connection:
            existing = connection.execute(
                "SELECT id FROM saved_mistakes WHERE legacy_training_item_id=?", (legacy["id"],)
            ).fetchone()
        if existing:
            summary["existing"] += 1
            return False
        game = self.get_game(legacy["analysis_run_id"])
        snapshot = json_loads(legacy["source_snapshot_json"], {})
        if game is None:
            summary["skipped"] += 1
            return False
        fen = snapshot.get("decision_fen") or snapshot.get("context", {}).get("fen")
        side = legacy["study_side"]
        match = next(
            (
                (ply, move)
                for ply, move in enumerate(game.get("result", {}).get("moves", []))
                if move.get("fen") == fen and move.get("side") == side
            ),
            None,
        )
        if match is None:
            summary["skipped"] += 1
            return False
        ply, _move = match
        eligible = {item["ply"]: item for item in derive_mistake_suggestions(game, side)}
        if ply not in eligible:
            summary["skipped"] += 1
            return False
        saved = self.save_selected(game["id"], side, [ply])
        mistake_id = (saved["created"] or saved["existing"])[0]["id"]
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE saved_mistakes SET legacy_training_item_id=?,note=?,updated_at=? WHERE id=?",
                (legacy["id"], legacy["training_note"], utc_now(), mistake_id),
            )
            tags = [
                row["name"]
                for row in connection.execute(
                    """SELECT t.name FROM training_tags t JOIN training_item_tags it ON it.tag_id=t.id
                       WHERE it.item_id=?""",
                    (legacy["id"],),
                )
            ]
        if tags:
            self.replace_tags(mistake_id, tags)
        self._import_legacy_attempts(legacy["id"], mistake_id, summary)
        return True

    def _import_legacy_attempts(self, legacy_item_id: str, mistake_id: str, summary: dict[str, int]) -> None:
        with self.database.connect() as connection:
            rows = connection.execute(
                """SELECT * FROM training_attempts
                   WHERE item_id=? AND state='completed' AND effective_grade IS NOT NULL""",
                (legacy_item_id,),
            ).fetchall()
        with self.database.transaction() as connection:
            for row in rows:
                if connection.execute(
                    "SELECT 1 FROM mistake_attempts WHERE legacy_training_attempt_id=?", (row["id"],)
                ).fetchone():
                    continue
                response = json_loads(row["response_json"], {})
                outcome = "again" if row["effective_grade"] in {"again", "hard"} else "understood"
                objective = json_loads(row["objective_result_json"], {})
                created = row["completed_at"] or row["updated_at"]
                connection.execute(
                    """INSERT INTO mistake_attempts
                       (id,mistake_id,legacy_training_attempt_id,chosen_move,revealed_without_move,
                        objective_acceptable,outcome,revealed_at,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        str(uuid.uuid4()), mistake_id, row["id"], response.get("chosen_move"),
                        int(not response.get("chosen_move")),
                        int(objective.get("classification") == "acceptable"), outcome,
                        row["revealed_at"] or created, created,
                    ),
                )
                summary["attempts"] += 1
            count = connection.execute(
                "SELECT count(*) FROM mistake_attempts WHERE mistake_id=?", (mistake_id,)
            ).fetchone()[0]
            latest = connection.execute(
                "SELECT outcome,created_at FROM mistake_attempts WHERE mistake_id=? ORDER BY created_at DESC LIMIT 1",
                (mistake_id,),
            ).fetchone()
            connection.execute(
                """UPDATE saved_mistakes SET practice_count=?,last_practice_state=?,last_practiced_at=?
                   WHERE id=?""",
                (count, latest["outcome"] if latest else None, latest["created_at"] if latest else None, mistake_id),
            )

    @staticmethod
    def _game(row) -> dict[str, Any]:
        return {
            "id": row["id"], "game_id": row["game_id"],
            "game_fingerprint": row["game_fingerprint"] or row["pgn_fingerprint"],
            "pgn_fingerprint": row["pgn_fingerprint"],
            "provenance_fingerprint": row["provenance_fingerprint"],
            "normalized_pgn": row["normalized_pgn"], "headers": json_loads(row["headers_json"], {}),
            "request": json_loads(row["request_json"], {}), "engine": json_loads(row["engine_json"], {}),
            "maia": json_loads(row["maia_json"], {}), "metric_schema_version": row["metric_schema_version"],
            "result": json_loads(row["result_json"], {}), "created_at": row["created_at"], "updated_at": row["updated_at"],
        }

    def _mistake(self, connection, row, include_attempts: bool = False) -> dict[str, Any]:
        headers = json_loads(row["headers_json"], {})
        if row["game_id"]:
            game_row = connection.execute("SELECT * FROM games WHERE id=?", (row["game_id"],)).fetchone()
            if game_row is not None:
                headers = AnalysisRepository._game(game_row)["headers"]
        tags = [
            value["name"]
            for value in connection.execute(
                """SELECT t.name FROM mistake_tags t JOIN saved_mistake_tags mt ON mt.tag_id=t.id
                   WHERE mt.mistake_id=? ORDER BY lower(t.name)""",
                (row["id"],),
            )
        ]
        result = {
            "id": row["id"], "analysis_run_id": row["analysis_run_id"],
            "game_id": row["game_id"], "mistake_fingerprint": row["mistake_fingerprint"],
            "ply": row["ply"],
            "move_number": row["move_number"], "side": row["side"], "decision_fen": row["decision_fen"],
            "played_move": row["played_move"], "played_move_uci": row["played_move_uci"],
            "best_move": row["best_move"],
            "objective_loss": row["objective_loss"], "cti": row["cti"],
            "cti_lower_bound": row["cti_lower_bound"], "cti_upper_bound": row["cti_upper_bound"],
            "cti_is_approximate": bool(row["cti_is_approximate"]),
            "mbi_classification": row["mbi_classification"], "mbi_maia_prob": row["mbi_maia_prob"],
            "system_reasons": json_loads(row["system_reasons_json"], []),
            "evidence": json_loads(row["evidence_json"], {}), "note": row["note"],
            "lifecycle": row["lifecycle"], "last_practice_state": row["last_practice_state"],
            "practice_count": row["practice_count"], "last_practiced_at": row["last_practiced_at"],
            "tags": tags, "headers": headers,
            "game_created_at": row["game_created_at"], "created_at": row["created_at"], "updated_at": row["updated_at"],
        }
        if include_attempts:
            result["attempts"] = [
                self._attempt(value)
                for value in connection.execute(
                    "SELECT * FROM mistake_attempts WHERE mistake_id=? ORDER BY created_at DESC", (row["id"],)
                )
            ]
        return result

    @staticmethod
    def _attempt(row) -> dict[str, Any]:
        return {
            "id": row["id"], "mistake_id": row["mistake_id"], "chosen_move": row["chosen_move"],
            "revealed_without_move": bool(row["revealed_without_move"]),
            "objective_acceptable": bool(row["objective_acceptable"]), "outcome": row["outcome"],
            "revealed_at": row["revealed_at"], "created_at": row["created_at"],
        }
