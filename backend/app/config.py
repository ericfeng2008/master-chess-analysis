from pathlib import Path

from pydantic_settings import BaseSettings


BACKEND_DIR = Path(__file__).resolve().parents[1]
MAIA3_MODEL = "maia3-79m"
MAIA3_CHECKPOINT_PATH = str(BACKEND_DIR / "model" / "maia3-79m.pt")
MAIA3_DEVICE = "cpu"
MAIA3_USE_HISTORY = True
DEFAULT_MAIA3_ELO = 2200


class Settings(BaseSettings):
    stockfish_path: str = "/opt/homebrew/bin/stockfish"
    default_engine_depth: int = 12
    stockfish_threads: int = 0  # 0 = auto-detect (cpu_count - 1)
    stockfish_hash_mb: int = 256
    default_bait_threshold: float = 0.50
    default_punishment_threshold: float = 1.5
    default_acceptable_drop: float = 0.5
    default_minefield_threshold: float = 0.80

    model_config = {"env_prefix": "ANALYSIS_"}


settings = Settings()
