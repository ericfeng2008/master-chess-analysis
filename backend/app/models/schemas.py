from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PgnUploadResponse(BaseModel):
    pgn: str
    num_games: int
    num_variations: int
    max_depth: int
    game_id: str | None = None
    fingerprint_version: int | None = None
    game_fingerprint: str | None = None
    preferred_analysis_run_id: str | None = None
    analysis_history: list[dict] = Field(default_factory=list)
    persistence_warning: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)
    metadata_sources: dict[str, str] = Field(default_factory=dict)
    metadata_missing: list[str] = Field(default_factory=list)
    metadata_updated_at: str | None = None
    source_headers: dict[str, str] = Field(default_factory=dict)
    imported_metadata: dict[str, str] = Field(default_factory=dict)
    metadata_overrides: dict[str, str] = Field(default_factory=dict)


class GameMetadataPatch(BaseModel):
    Event: str | None = None
    White: str | None = None
    Black: str | None = None


class AnalyzeRequest(BaseModel):
    pgn: str
    game_id: str | None = None
    acceptable_drop: float = Field(default=0.5, ge=0.0)
    minefield_threshold: float = Field(default=0.80, ge=0.0, le=1.0)
    engine_depth: int = Field(default=12, ge=10, le=20)
    blunder_threshold: float = Field(default=1.0, ge=0.5, le=3.0)
    mbi_trap_threshold: float = Field(default=0.40, ge=0.10, le=0.80)
    mbi_outlier_threshold: float = Field(default=0.05, ge=0.01, le=0.20)
    eig_threshold: float = Field(default=2.0, ge=0.5, le=5.0)
    bri_threshold: float = Field(default=0.05, ge=0.01, le=0.20)
    maia3_white_elo: int = Field(default=2200, ge=0, le=5000)
    maia3_black_elo: int = Field(default=2200, ge=0, le=5000)


class AnalysisMoveResult(BaseModel):
    move_number: int
    side: str
    move: str
    fen: str
    stockfish_eval: float
    eval_after: float
    cti: float | None
    cti_lower_bound: float | None = None
    cti_upper_bound: float | None = None
    cti_remaining_mass: float | None = None
    cti_is_approximate: bool = False
    good_moves: list[str]
    good_moves_with_eval: dict[str, float]
    is_minefield: bool
    mbi_classification: str | None = None
    mbi_maia_prob: float | None = None
    played_move_eval_drop: float | None = None
    eig_value: float | None = None
    is_eig_flagged: bool = False
    is_brilliant: bool = False
    bri_maia_prob: float | None = None
    epe_score: float | None = None
    best_line: list[str] = []
    mate_in: int | None = None


class AnalyzeResult(BaseModel):
    moves: list[AnalysisMoveResult]
    minefields: list[int]


class SaveMistakesRequest(BaseModel):
    analysis_run_id: str = Field(min_length=1)
    study_side: Literal["white", "black"]
    plies: list[int] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_unique_plies(self):
        if any(ply < 0 for ply in self.plies):
            raise ValueError("Plies must be non-negative")
        if len(set(self.plies)) != len(self.plies):
            raise ValueError("Plies must be unique")
        return self


class SavedMistakePatch(BaseModel):
    note: str | None = Field(default=None, max_length=8000)
    lifecycle: Literal["active", "archived"] | None = None


class SavedMistakeTagsPatch(BaseModel):
    names: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_names(self):
        if any(not name.strip() or len(name.strip()) > 80 for name in self.names):
            raise ValueError("Tags must contain 1 to 80 non-whitespace characters")
        return self


class MistakeAttemptCreate(BaseModel):
    chosen_move: str | None = Field(default=None, max_length=20)
    outcome: Literal["again", "understood"]


class ErrorResponse(BaseModel):
    detail: str


class EvaluatePositionRequest(BaseModel):
    fen: str
    depth: int = Field(default=12, ge=10, le=20)
    acceptable_drop: float = Field(default=0.5, ge=0.0)


class EvaluatePositionResponse(BaseModel):
    eval: float
    best_move: str
    good_moves: list[str]
    good_moves_with_eval: dict[str, float]
    cti: float | None = None
    mate_in: int | None = None
