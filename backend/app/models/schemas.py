from pydantic import BaseModel, Field


class PgnUploadResponse(BaseModel):
    pgn: str
    num_games: int
    num_variations: int
    max_depth: int


class AnalyzeRequest(BaseModel):
    pgn: str
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
    good_moves: list[str]
    good_moves_with_eval: dict[str, float]
    is_minefield: bool
    mbi_classification: str | None = None
    mbi_maia_prob: float | None = None
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
