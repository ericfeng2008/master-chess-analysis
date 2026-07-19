from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


SCHEMA_VERSION = 6


class DatabaseUnavailableError(RuntimeError):
    """Raised when the local review database cannot be initialized or opened."""


MIGRATION_1 = """
CREATE TABLE analysis_runs (
    id TEXT PRIMARY KEY,
    pgn_fingerprint TEXT NOT NULL,
    provenance_fingerprint TEXT NOT NULL,
    normalized_pgn TEXT NOT NULL,
    headers_json TEXT NOT NULL,
    request_json TEXT NOT NULL,
    engine_json TEXT NOT NULL,
    maia_json TEXT NOT NULL,
    metric_schema_version INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(pgn_fingerprint, provenance_fingerprint)
);

CREATE INDEX analysis_runs_game_idx ON analysis_runs(pgn_fingerprint);

CREATE TABLE review_sessions (
    id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
    study_side TEXT NOT NULL CHECK(study_side IN ('white', 'black')),
    selection_config_json TEXT NOT NULL,
    verifier_config_json TEXT NOT NULL,
    state TEXT NOT NULL,
    current_moment_id TEXT,
    current_phase TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX review_sessions_run_side_idx
ON review_sessions(analysis_run_id, study_side, updated_at DESC);

CREATE TABLE critical_moments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    start_ply INTEGER NOT NULL,
    decision_ply INTEGER NOT NULL,
    consequence_ply INTEGER NOT NULL,
    primary_type TEXT NOT NULL,
    reasons_json TEXT NOT NULL,
    priority_json TEXT NOT NULL,
    context_json TEXT NOT NULL,
    verification_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(session_id, ordinal)
);

CREATE INDEX critical_moments_session_idx
ON critical_moments(session_id, ordinal);

CREATE TABLE review_responses (
    id TEXT PRIMARY KEY,
    moment_id TEXT NOT NULL UNIQUE REFERENCES critical_moments(id) ON DELETE CASCADE,
    response_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

MIGRATION_2 = """
CREATE TABLE training_items (
    id TEXT PRIMARY KEY,
    source_moment_id TEXT UNIQUE REFERENCES critical_moments(id) ON DELETE SET NULL,
    source_session_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
    analysis_run_id TEXT REFERENCES analysis_runs(id) ON DELETE SET NULL,
    lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active', 'archived')),
    verification_status TEXT NOT NULL CHECK(verification_status IN ('verified', 'tablebase', 'verification_required', 'verifying', 'engine_noise')),
    study_side TEXT NOT NULL CHECK(study_side IN ('white', 'black')),
    primary_type TEXT NOT NULL,
    diagnosis TEXT,
    source_snapshot_json TEXT NOT NULL,
    solution_json TEXT NOT NULL,
    solution_revision INTEGER NOT NULL DEFAULT 1,
    solution_schema_version INTEGER NOT NULL DEFAULT 1,
    training_note TEXT NOT NULL DEFAULT '',
    search_text TEXT NOT NULL DEFAULT '',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    last_selected_grade TEXT,
    last_effective_grade TEXT,
    archived_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX training_items_lifecycle_verification_idx
ON training_items(lifecycle, verification_status, created_at);
CREATE INDEX training_items_type_side_idx ON training_items(primary_type, study_side);
CREATE INDEX training_items_attempt_idx ON training_items(last_attempt_at DESC, created_at DESC);

CREATE TABLE training_schedules (
    item_id TEXT PRIMARY KEY REFERENCES training_items(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('new', 'learning', 'review', 'relearning', 'suspended')),
    suspended_from_state TEXT,
    due_at TEXT NOT NULL,
    snoozed_until TEXT,
    interval_days INTEGER NOT NULL DEFAULT 0,
    pre_lapse_interval_days INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    learning_step INTEGER NOT NULL DEFAULT 0,
    is_leech INTEGER NOT NULL DEFAULT 0,
    algorithm_version INTEGER NOT NULL DEFAULT 1,
    last_reviewed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX training_schedules_due_idx ON training_schedules(state, due_at);
CREATE INDEX training_schedules_leech_idx ON training_schedules(is_leech, state);

CREATE TABLE training_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE training_item_tags (
    item_id TEXT NOT NULL REFERENCES training_items(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES training_tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(item_id, tag_id)
);
CREATE INDEX training_item_tags_tag_idx ON training_item_tags(tag_id, item_id);

CREATE TABLE practice_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK(mode IN ('daily', 'selected', 'single')),
    state TEXT NOT NULL CHECK(state IN ('ready', 'in_progress', 'completed', 'cancelled', 'failed')),
    preview_only INTEGER NOT NULL DEFAULT 0,
    configuration_json TEXT NOT NULL,
    current_entry_id TEXT,
    completed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX practice_sessions_state_idx ON practice_sessions(state, updated_at DESC);

CREATE TABLE practice_queue_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES training_items(id) ON DELETE SET NULL,
    ordinal INTEGER NOT NULL,
    solution_revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending', 'in_progress', 'completed', 'skipped', 'invalidated')),
    skip_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(session_id, ordinal),
    UNIQUE(session_id, item_id)
);
CREATE INDEX practice_queue_session_idx ON practice_queue_entries(session_id, ordinal);
CREATE INDEX practice_queue_item_idx ON practice_queue_entries(item_id, state);

CREATE TABLE training_attempts (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES training_items(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
    queue_entry_id TEXT NOT NULL UNIQUE REFERENCES practice_queue_entries(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('think', 'revealed', 'completed', 'abandoned', 'invalidated')),
    response_json TEXT NOT NULL DEFAULT '{}',
    hints_json TEXT NOT NULL DEFAULT '[]',
    solution_revision INTEGER,
    solution_snapshot_json TEXT,
    objective_result_json TEXT,
    selected_grade TEXT,
    effective_grade TEXT,
    reflection TEXT,
    started_at TEXT NOT NULL,
    submitted_at TEXT,
    revealed_at TEXT,
    completed_at TEXT,
    revealed_without_submission INTEGER NOT NULL DEFAULT 0,
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT UNIQUE,
    assessment_result_json TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX training_attempts_item_idx ON training_attempts(item_id, created_at DESC);
CREATE INDEX training_attempts_session_idx ON training_attempts(session_id, created_at);
"""

MIGRATION_3 = """
ALTER TABLE review_sessions ADD COLUMN profile_id TEXT REFERENCES player_profiles(id) ON DELETE SET NULL;
ALTER TABLE review_sessions ADD COLUMN personalization_mode TEXT NOT NULL DEFAULT 'off'
    CHECK(personalization_mode IN ('off','balanced','focused'));
ALTER TABLE review_sessions ADD COLUMN personalization_status_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE training_items ADD COLUMN profile_id TEXT REFERENCES player_profiles(id) ON DELETE SET NULL;

CREATE TABLE player_profiles (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    personalization_mode TEXT NOT NULL DEFAULT 'off'
        CHECK(personalization_mode IN ('off','balanced','focused')),
    collection_enabled INTEGER NOT NULL DEFAULT 1,
    half_life_days INTEGER NOT NULL DEFAULT 180 CHECK(half_life_days BETWEEN 90 AND 365),
    active_evidence_version INTEGER,
    active_fingerprint_version INTEGER,
    settings_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE player_aliases (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE INDEX player_aliases_profile_idx ON player_aliases(profile_id, normalized_name);

CREATE TABLE profile_source_links (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('review_session','training_item')),
    source_id TEXT NOT NULL,
    study_side TEXT NOT NULL CHECK(study_side IN ('white','black')),
    confirmed INTEGER NOT NULL DEFAULT 1,
    linked_at TEXT NOT NULL,
    UNIQUE(source_kind, source_id)
);
CREATE INDEX profile_source_links_profile_idx ON profile_source_links(profile_id, source_kind, linked_at);

CREATE TABLE profile_evidence (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('review_response','practice_attempt','objective_position')),
    source_id TEXT NOT NULL,
    source_revision INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    feature_key TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL CHECK(direction IN ('challenge','counter')),
    strength REAL NOT NULL CHECK(strength BETWEEN 0 AND 1),
    assistance TEXT NOT NULL DEFAULT 'none' CHECK(assistance IN ('none','hint','early_reveal','hint_and_early')),
    objective_classification TEXT,
    selected_grade TEXT,
    effective_grade TEXT,
    confidence INTEGER,
    elapsed_bucket TEXT,
    usefulness INTEGER,
    disposition TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    model_version INTEGER NOT NULL,
    projection_version INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(profile_id, source_kind, source_id, source_revision, dimension, feature_key, model_version, projection_version)
);
CREATE INDEX profile_evidence_pattern_idx ON profile_evidence(profile_id, dimension, feature_key, projection_version, active, occurred_at DESC);
CREATE INDEX profile_evidence_source_idx ON profile_evidence(source_kind, source_id, source_revision);
CREATE INDEX profile_evidence_game_idx ON profile_evidence(profile_id, game_id, dimension);

CREATE TABLE profile_evidence_overrides (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES profile_evidence(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('exclude','restore','relabel')),
    from_dimension TEXT,
    to_dimension TEXT,
    reason TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(evidence_id, version)
);
CREATE INDEX profile_evidence_overrides_evidence_idx ON profile_evidence_overrides(evidence_id, version DESC);

CREATE TABLE profile_pattern_aggregates (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    feature_key TEXT NOT NULL DEFAULT '',
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('insufficient','emerging','established','improving','demonstrated_strength','mixed')),
    challenge_weight REAL NOT NULL,
    counter_weight REAL NOT NULL,
    estimate REAL NOT NULL,
    lower_bound REAL NOT NULL,
    upper_bound REAL NOT NULL,
    independent_games INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    recent_estimate REAL,
    prior_estimate REAL,
    last_seen_at TEXT,
    ranking_enabled INTEGER NOT NULL DEFAULT 1,
    model_version INTEGER NOT NULL,
    projection_version INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    UNIQUE(profile_id, dimension, feature_key, model_version, projection_version)
);
CREATE INDEX profile_pattern_active_idx ON profile_pattern_aggregates(profile_id, active, ranking_enabled, lifecycle, estimate DESC);

CREATE TABLE critical_position_fingerprints (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('critical_moment','training_item')),
    source_id TEXT NOT NULL,
    source_revision INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    features_json TEXT NOT NULL,
    extractor_version INTEGER NOT NULL,
    projection_version INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(profile_id, source_kind, source_id, source_revision, extractor_version, projection_version)
);
CREATE INDEX critical_fingerprints_profile_idx ON critical_position_fingerprints(profile_id, active, extractor_version, verification_status, game_id);

CREATE TABLE review_ranking_audits (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES review_sessions(id) ON DELETE CASCADE,
    profile_id TEXT REFERENCES player_profiles(id) ON DELETE SET NULL,
    personalization_mode TEXT NOT NULL,
    evidence_cutoff TEXT NOT NULL,
    model_versions_json TEXT NOT NULL,
    audit_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX review_ranking_audits_profile_idx ON review_ranking_audits(profile_id, created_at DESC);

CREATE TABLE profile_rebuild_runs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('planning','running','completed','cancelled','failed')),
    target_evidence_version INTEGER NOT NULL,
    target_fingerprint_version INTEGER NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX profile_rebuild_runs_profile_idx ON profile_rebuild_runs(profile_id, state, updated_at DESC);

CREATE INDEX review_sessions_profile_idx ON review_sessions(profile_id, updated_at DESC);
CREATE INDEX training_items_profile_idx ON training_items(profile_id, lifecycle, created_at DESC);
"""

MIGRATION_4 = """
CREATE TABLE saved_mistakes (
    id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
    legacy_training_item_id TEXT UNIQUE,
    ply INTEGER NOT NULL CHECK(ply >= 0),
    move_number INTEGER NOT NULL CHECK(move_number >= 1),
    side TEXT NOT NULL CHECK(side IN ('white','black')),
    decision_fen TEXT NOT NULL,
    played_move TEXT NOT NULL,
    best_move TEXT,
    objective_loss REAL NOT NULL CHECK(objective_loss >= 0),
    cti REAL,
    cti_lower_bound REAL,
    cti_upper_bound REAL,
    cti_is_approximate INTEGER NOT NULL DEFAULT 0,
    mbi_classification TEXT,
    mbi_maia_prob REAL,
    system_reasons_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','archived')),
    last_practice_state TEXT CHECK(last_practice_state IN ('again','understood')),
    practice_count INTEGER NOT NULL DEFAULT 0,
    last_practiced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(analysis_run_id, ply, side)
);
CREATE INDEX saved_mistakes_library_idx
ON saved_mistakes(lifecycle, updated_at DESC, analysis_run_id, ply);
CREATE INDEX saved_mistakes_reason_idx
ON saved_mistakes(side, mbi_classification, last_practice_state, updated_at DESC);

CREATE TABLE mistake_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE saved_mistake_tags (
    mistake_id TEXT NOT NULL REFERENCES saved_mistakes(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES mistake_tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(mistake_id, tag_id)
);
CREATE INDEX saved_mistake_tags_tag_idx ON saved_mistake_tags(tag_id, mistake_id);

CREATE TABLE mistake_attempts (
    id TEXT PRIMARY KEY,
    mistake_id TEXT NOT NULL REFERENCES saved_mistakes(id) ON DELETE CASCADE,
    legacy_training_attempt_id TEXT UNIQUE,
    chosen_move TEXT,
    revealed_without_move INTEGER NOT NULL DEFAULT 0,
    objective_acceptable INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL CHECK(outcome IN ('again','understood')),
    revealed_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX mistake_attempts_mistake_idx
ON mistake_attempts(mistake_id, created_at DESC);
"""

MIGRATION_5 = """
CREATE TABLE games (
    id TEXT PRIMARY KEY,
    fingerprint_version INTEGER NOT NULL,
    game_fingerprint TEXT NOT NULL UNIQUE,
    canonical_initial_fen TEXT NOT NULL,
    mainline_uci_json TEXT NOT NULL,
    normalized_pgn TEXT NOT NULL,
    headers_json TEXT NOT NULL,
    move_count INTEGER NOT NULL CHECK(move_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
);
CREATE INDEX games_last_opened_idx ON games(last_opened_at DESC);

ALTER TABLE analysis_runs ADD COLUMN game_id TEXT REFERENCES games(id) ON DELETE RESTRICT;
ALTER TABLE analysis_runs ADD COLUMN analysis_fingerprint TEXT;
ALTER TABLE analysis_runs ADD COLUMN cacheable INTEGER NOT NULL DEFAULT 0;
CREATE INDEX analysis_runs_logical_game_idx
ON analysis_runs(game_id, created_at DESC);
CREATE INDEX analysis_runs_cache_idx
ON analysis_runs(game_id, analysis_fingerprint, cacheable, created_at DESC);

ALTER TABLE saved_mistakes ADD COLUMN played_move_uci TEXT;
ALTER TABLE saved_mistakes ADD COLUMN mistake_fingerprint TEXT;
ALTER TABLE saved_mistakes ADD COLUMN migration_metadata_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX saved_mistakes_fingerprint_lookup_idx
ON saved_mistakes(mistake_fingerprint);

CREATE TABLE mistake_id_aliases (
    retired_id TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL REFERENCES saved_mistakes(id) ON DELETE CASCADE,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE migration_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_version INTEGER NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX migration_issues_entity_idx
ON migration_issues(schema_version, entity_kind, entity_id);
"""

MIGRATION_6 = """
ALTER TABLE games ADD COLUMN imported_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE games ADD COLUMN metadata_overrides_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE games ADD COLUMN metadata_updated_at TEXT;
"""

MIGRATIONS = {
    1: MIGRATION_1,
    2: MIGRATION_2,
    3: MIGRATION_3,
    4: MIGRATION_4,
    5: MIGRATION_5,
    6: MIGRATION_6,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_migration_issue(
    connection: sqlite3.Connection,
    entity_kind: str,
    entity_id: str,
    message: str,
    schema_version: int = 5,
) -> None:
    connection.execute(
        """INSERT INTO migration_issues
           (schema_version,entity_kind,entity_id,message,created_at)
           VALUES (?,?,?,?,?)""",
        (schema_version, entity_kind, entity_id, message, _utc_now()),
    )


def _backfill_analysis_games(connection: sqlite3.Connection) -> None:
    from .models import json_dumps, json_loads
    from .provenance import (
        GAME_FINGERPRINT_VERSION,
        analysis_fingerprint,
        game_fingerprint,
        parse_single_game_pgn,
    )

    rows = connection.execute(
        "SELECT * FROM analysis_runs ORDER BY created_at, id"
    ).fetchall()
    for row in rows:
        try:
            parsed = parse_single_game_pgn(row["normalized_pgn"])
            digest = game_fingerprint(parsed)
        except Exception as exc:
            _record_migration_issue(
                connection,
                "analysis_run",
                str(row["id"]),
                f"PGN is not cacheable: {exc}",
            )
            continue

        game = connection.execute(
            "SELECT * FROM games WHERE game_fingerprint=?", (digest,)
        ).fetchone()
        if game is None:
            game_id = str(uuid.uuid4())
            connection.execute(
                """INSERT INTO games
                   (id,fingerprint_version,game_fingerprint,canonical_initial_fen,
                    mainline_uci_json,normalized_pgn,headers_json,move_count,
                    created_at,updated_at,last_opened_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    game_id,
                    GAME_FINGERPRINT_VERSION,
                    digest,
                    parsed.initial_fen,
                    json_dumps(list(parsed.mainline_uci)),
                    parsed.normalized_pgn,
                    json_dumps(parsed.headers),
                    parsed.move_count,
                    row["created_at"],
                    row["updated_at"],
                    row["updated_at"],
                ),
            )
        else:
            game_id = str(game["id"])
            if str(row["updated_at"]) >= str(game["updated_at"]):
                connection.execute(
                    """UPDATE games SET normalized_pgn=?,headers_json=?,move_count=?,
                       updated_at=?,last_opened_at=? WHERE id=?""",
                    (
                        parsed.normalized_pgn,
                        json_dumps(parsed.headers),
                        parsed.move_count,
                        row["updated_at"],
                        row["updated_at"],
                        game_id,
                    ),
                )

        try:
            digest_analysis = analysis_fingerprint(
                digest,
                json_loads(row["request_json"], {}),
                json_loads(row["engine_json"], {}),
                json_loads(row["maia_json"], {}),
                int(row["metric_schema_version"]),
            )
        except Exception as exc:
            connection.execute(
                "UPDATE analysis_runs SET game_id=?,cacheable=0 WHERE id=?",
                (game_id, row["id"]),
            )
            _record_migration_issue(
                connection,
                "analysis_run",
                str(row["id"]),
                f"Analysis provenance is not cacheable: {exc}",
            )
            continue

        connection.execute(
            """UPDATE analysis_runs
               SET game_id=?,analysis_fingerprint=?,cacheable=1 WHERE id=?""",
            (game_id, digest_analysis, row["id"]),
        )


def _backfill_mistake_fingerprints(connection: sqlite3.Connection) -> None:
    import chess

    from .provenance import (
        canonical_decision_fen,
        mistake_fingerprint,
        parse_single_game_pgn,
    )

    rows = connection.execute(
        """SELECT m.*,a.normalized_pgn,g.game_fingerprint
           FROM saved_mistakes m
           JOIN analysis_runs a ON a.id=m.analysis_run_id
           LEFT JOIN games g ON g.id=a.game_id
           ORDER BY m.created_at,m.id"""
    ).fetchall()
    for row in rows:
        try:
            if row["game_fingerprint"] is None:
                raise ValueError("source analysis has no cacheable logical game")
            parsed = parse_single_game_pgn(row["normalized_pgn"])
            ply = int(row["ply"])
            if ply < 0 or ply >= len(parsed.move_context):
                raise ValueError("ply is outside the stored game mainline")
            context = parsed.move_context[ply]
            if row["side"] != context["side"]:
                raise ValueError("stored side does not match the game mainline")
            if canonical_decision_fen(row["decision_fen"]) != context["decision_fen"]:
                raise ValueError("stored decision position does not match the game mainline")
            board = chess.Board(context["decision_fen"])
            move = chess.Move.from_uci(context["played_move_uci"])
            stored_move = str(row["played_move"])
            if stored_move not in {move.uci(), board.san(move)}:
                raise ValueError("stored played move does not match the game mainline")
            digest = mistake_fingerprint(
                str(row["game_fingerprint"]),
                ply,
                str(row["side"]),
                context["decision_fen"],
                context["played_move_uci"],
            )
            connection.execute(
                """UPDATE saved_mistakes
                   SET played_move_uci=?,mistake_fingerprint=?,migration_metadata_json='{}'
                   WHERE id=?""",
                (context["played_move_uci"], digest, row["id"]),
            )
        except Exception as exc:
            metadata = json.dumps(
                {"migration_status": "unsafe", "reason": str(exc)},
                separators=(",", ":"),
                sort_keys=True,
            )
            connection.execute(
                "UPDATE saved_mistakes SET migration_metadata_json=? WHERE id=?",
                (metadata, row["id"]),
            )
            _record_migration_issue(
                connection,
                "saved_mistake",
                str(row["id"]),
                f"Stable identity was not backfilled: {exc}",
            )


def _merge_duplicate_mistakes(connection: sqlite3.Connection) -> None:
    duplicates = connection.execute(
        """SELECT mistake_fingerprint
           FROM saved_mistakes
           WHERE mistake_fingerprint IS NOT NULL
           GROUP BY mistake_fingerprint HAVING count(*) > 1"""
    ).fetchall()
    for duplicate in duplicates:
        fingerprint = duplicate["mistake_fingerprint"]
        rows = connection.execute(
            """SELECT * FROM saved_mistakes WHERE mistake_fingerprint=?
               ORDER BY created_at,id""",
            (fingerprint,),
        ).fetchall()
        canonical = rows[0]
        canonical_id = str(canonical["id"])
        notes = [str(canonical["note"]).strip()] if str(canonical["note"]).strip() else []
        metadata = json.loads(canonical["migration_metadata_json"] or "{}")
        merged = list(metadata.get("merged_legacy_duplicates", []))
        lifecycle = str(canonical["lifecycle"])
        practice_count = int(canonical["practice_count"])
        last_state = canonical["last_practice_state"]
        last_practiced = canonical["last_practiced_at"]
        updated_at = str(canonical["updated_at"])
        legacy_training_item_id = canonical["legacy_training_item_id"]

        for retired in rows[1:]:
            retired_id = str(retired["id"])
            retired_note = str(retired["note"]).strip()
            if retired_note and retired_note not in notes:
                notes.append(retired_note)
            merged.append(
                {
                    "retired_id": retired_id,
                    "analysis_run_id": retired["analysis_run_id"],
                    "legacy_training_item_id": retired["legacy_training_item_id"],
                    "note": retired["note"],
                    "evidence": json.loads(retired["evidence_json"] or "{}"),
                    "lifecycle": retired["lifecycle"],
                    "created_at": retired["created_at"],
                    "updated_at": retired["updated_at"],
                }
            )
            connection.execute(
                """INSERT OR IGNORE INTO saved_mistake_tags(mistake_id,tag_id,created_at)
                   SELECT ?,tag_id,created_at FROM saved_mistake_tags WHERE mistake_id=?""",
                (canonical_id, retired_id),
            )
            connection.execute(
                "UPDATE mistake_attempts SET mistake_id=? WHERE mistake_id=?",
                (canonical_id, retired_id),
            )
            connection.execute(
                """INSERT INTO mistake_id_aliases
                   (retired_id,canonical_id,metadata_json,created_at)
                   VALUES (?,?,?,?)""",
                (
                    retired_id,
                    canonical_id,
                    json.dumps(
                        {"mistake_fingerprint": fingerprint},
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    _utc_now(),
                ),
            )
            if retired["lifecycle"] == "active":
                lifecycle = "active"
            practice_count += int(retired["practice_count"])
            if retired["last_practiced_at"] and (
                last_practiced is None
                or str(retired["last_practiced_at"]) > str(last_practiced)
            ):
                last_practiced = retired["last_practiced_at"]
                last_state = retired["last_practice_state"]
            updated_at = max(updated_at, str(retired["updated_at"]))
            if legacy_training_item_id is None and retired["legacy_training_item_id"]:
                legacy_training_item_id = retired["legacy_training_item_id"]
            connection.execute("DELETE FROM saved_mistakes WHERE id=?", (retired_id,))

        attempt_summary = connection.execute(
            """SELECT count(*) AS count FROM mistake_attempts WHERE mistake_id=?""",
            (canonical_id,),
        ).fetchone()
        practice_count = max(practice_count, int(attempt_summary["count"]))
        latest_attempt = connection.execute(
            """SELECT outcome,created_at FROM mistake_attempts
               WHERE mistake_id=? ORDER BY created_at DESC LIMIT 1""",
            (canonical_id,),
        ).fetchone()
        if latest_attempt and (
            last_practiced is None
            or str(latest_attempt["created_at"]) > str(last_practiced)
        ):
            last_practiced = latest_attempt["created_at"]
            last_state = latest_attempt["outcome"]
        metadata["merged_legacy_duplicates"] = merged
        connection.execute(
            """UPDATE saved_mistakes SET note=?,lifecycle=?,practice_count=?,
               last_practice_state=?,last_practiced_at=?,legacy_training_item_id=?,
               migration_metadata_json=?,updated_at=? WHERE id=?""",
            (
                "\n\n".join(notes),
                lifecycle,
                practice_count,
                last_state,
                last_practiced,
                legacy_training_item_id,
                json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                updated_at,
                canonical_id,
            ),
        )


def _backfill_schema_5(connection: sqlite3.Connection) -> None:
    _backfill_analysis_games(connection)
    _backfill_mistake_fingerprints(connection)
    _merge_duplicate_mistakes(connection)
    connection.execute(
        """CREATE UNIQUE INDEX saved_mistakes_unique_fingerprint_idx
           ON saved_mistakes(mistake_fingerprint)
           WHERE mistake_fingerprint IS NOT NULL"""
    )


def _backfill_schema_6(connection: sqlite3.Connection) -> None:
    from .metadata import core_metadata_from_headers
    from .models import json_dumps, json_loads

    rows = connection.execute("SELECT id,headers_json,updated_at FROM games").fetchall()
    for row in rows:
        try:
            headers = json_loads(row["headers_json"], {})
            if not isinstance(headers, dict):
                raise ValueError("headers are not an object")
            imported = core_metadata_from_headers(headers)
        except Exception as exc:
            imported = {}
            _record_migration_issue(
                connection,
                "game",
                str(row["id"]),
                f"Metadata could not be backfilled: {exc}",
                schema_version=6,
            )
        connection.execute(
            """UPDATE games SET imported_metadata_json=?,metadata_overrides_json='{}',
               metadata_updated_at=? WHERE id=?""",
            (json_dumps(imported), row["updated_at"], row["id"]),
        )


class Database:
    """Small connection factory with transactional schema migration support."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.available = False
        self.unavailable_reason: str | None = None
        self.last_backup_path: Path | None = None

    def _backup_before_migration(
        self, connection: sqlite3.Connection, current_version: int
    ) -> None:
        if current_version <= 0 or current_version >= SCHEMA_VERSION:
            return
        backup_path = self.path.with_name(
            f"{self.path.name}.pre-v{current_version}-to-v{SCHEMA_VERSION}.bak"
        )
        if not backup_path.exists():
            backup = sqlite3.connect(backup_path)
            try:
                connection.backup(backup)
            finally:
                backup.close()
        self.last_backup_path = backup_path

    def _backfill_schema_5(self, connection: sqlite3.Connection) -> None:
        _backfill_schema_5(connection)

    def _backfill_schema_6(self, connection: sqlite3.Connection) -> None:
        _backfill_schema_6(connection)

    def initialize(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.connect() as connection:
                current = int(connection.execute("PRAGMA user_version").fetchone()[0])
                if current > SCHEMA_VERSION:
                    raise DatabaseUnavailableError(
                        f"Analysis database schema {current} is newer than supported {SCHEMA_VERSION}"
                    )
                self._backup_before_migration(connection, current)
                for version in range(current + 1, SCHEMA_VERSION + 1):
                    try:
                        if version in {5, 6}:
                            connection.executescript(
                                "BEGIN IMMEDIATE;\n" + MIGRATIONS[version]
                            )
                            if version == 5:
                                self._backfill_schema_5(connection)
                            else:
                                self._backfill_schema_6(connection)
                            connection.execute(f"PRAGMA user_version = {version}")
                            connection.commit()
                        else:
                            connection.executescript(
                                "BEGIN IMMEDIATE;\n"
                                + MIGRATIONS[version]
                                + f"\nPRAGMA user_version = {version};\nCOMMIT;"
                            )
                    except Exception:
                        if connection.in_transaction:
                            connection.rollback()
                        raise
            self.available = True
            self.unavailable_reason = None
        except Exception as exc:
            self.available = False
            self.unavailable_reason = str(exc)
            if isinstance(exc, DatabaseUnavailableError):
                raise
            raise DatabaseUnavailableError(
                f"Local analysis persistence is unavailable at {self.path}: {exc}"
            ) from exc

    def connect(self) -> sqlite3.Connection:
        try:
            connection = sqlite3.connect(
                self.path,
                timeout=10,
                isolation_level=None,
                check_same_thread=False,
            )
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA busy_timeout = 10000")
            return connection
        except sqlite3.Error as exc:
            raise DatabaseUnavailableError(
                f"Local analysis persistence is unavailable at {self.path}: {exc}"
            ) from exc

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def close(self) -> None:
        """Connections are operation-scoped; this keeps lifespan cleanup explicit."""

        self.available = False
