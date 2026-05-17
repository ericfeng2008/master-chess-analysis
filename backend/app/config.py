from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    stockfish_path: str = "/opt/homebrew/bin/stockfish"
    lc0_path: str = "/opt/homebrew/Cellar/lc0/0.32.1/bin/lc0"
    maia_weights_path: str = "./model/maia-2200.pb.gz"
    lc0_backend: str = "eigen"
    default_engine_depth: int = 12
    stockfish_threads: int = 0  # 0 = auto-detect (cpu_count - 1)
    stockfish_hash_mb: int = 256
    default_bait_threshold: float = 0.50
    default_punishment_threshold: float = 1.5
    default_acceptable_drop: float = 0.5
    default_minefield_threshold: float = 0.80

    model_config = {"env_prefix": "ANALYSIS_"}


settings = Settings()
