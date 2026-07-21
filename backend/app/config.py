from pathlib import Path

from pydantic_settings import BaseSettings


BACKEND_DIR = Path(__file__).resolve().parents[1]
MAIA3_MODEL = "maia3-79m"
MAIA3_CHECKPOINT_PATH = str(BACKEND_DIR / "model" / "maia3-79m.pt")
MAIA3_DEVICE = "cpu"
MAIA3_USE_HISTORY = True
DEFAULT_MAIA3_ELO = 2600
HISTORICAL_MAIA3_ELO = 2200


class Settings(BaseSettings):
    stockfish_path: str = "/opt/homebrew/bin/stockfish"
    default_engine_depth: int = 12
    stockfish_threads: int = 0  # 0 = auto-detect (cpu_count - 1)
    stockfish_hash_mb: int = 256
    stockfish_search_cache_entries: int = 2048
    data_dir: str = str(BACKEND_DIR / "data")

    @property
    def database_path(self) -> Path:
        return Path(self.data_dir).expanduser() / "master-chess-analysis.db"

    model_config = {"env_prefix": "ANALYSIS_"}


settings = Settings()
