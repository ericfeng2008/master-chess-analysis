from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any


class MistakeReason(StrEnum):
    HIGH_CTI_MISTAKE = "high_cti_mistake"
    HUMAN_NATURAL_BLUNDER = "human_natural_blunder"


class MistakeOutcome(StrEnum):
    AGAIN = "again"
    UNDERSTOOD = "understood"


@dataclass(frozen=True)
class MistakeSuggestion:
    analysis_run_id: str
    game_id: str | None
    mistake_fingerprint: str
    ply: int
    move_number: int
    side: str
    decision_fen: str
    played_move: str
    played_move_uci: str
    best_move: str | None
    objective_loss: float
    cti: float | None
    cti_lower_bound: float | None
    cti_upper_bound: float | None
    cti_is_approximate: bool
    mbi_classification: str | None
    mbi_maia_prob: float | None
    system_reasons: tuple[str, ...]
    evidence: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["system_reasons"] = list(self.system_reasons)
        return value


@dataclass(frozen=True)
class StoredGameSummary:
    id: str
    headers: dict[str, str]
    created_at: str
    updated_at: str
    mistake_count: int
    move_count: int
    analysis_count: int = 0
    preferred_analysis_run_id: str | None = None
    metadata: dict[str, str] | None = None
    metadata_sources: dict[str, str] | None = None
    metadata_missing: list[str] | None = None
    last_opened_at: str | None = None
    result: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class MistakeAttempt:
    id: str
    mistake_id: str
    chosen_move: str | None
    revealed_without_move: bool
    objective_acceptable: bool
    outcome: str
    revealed_at: str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
