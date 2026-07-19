from __future__ import annotations

import json
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any


def json_dumps(value: Any) -> str:
    if is_dataclass(value):
        value = asdict(value)
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def json_loads(value: str | None, default: Any = None) -> Any:
    if value is None:
        return default
    return json.loads(value)


@dataclass(frozen=True)
class AnalysisRunSnapshot:
    normalized_pgn: str
    headers: dict[str, str]
    request: dict[str, Any]
    engine: dict[str, Any]
    maia: dict[str, Any]
    metric_schema_version: int
    result: dict[str, Any]
    pgn_fingerprint: str
    provenance_fingerprint: str
    game_id: str | None = None
    game_fingerprint: str | None = None
    analysis_fingerprint: str | None = None
