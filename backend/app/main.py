import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import (
    DEFAULT_MAIA3_ELO,
    MAIA3_CHECKPOINT_PATH,
    MAIA3_DEVICE,
    MAIA3_MODEL,
    MAIA3_USE_HISTORY,
    settings,
)
from app.engines.maia3_client import Maia3Client
from app.engines.stockfish_client import StockfishClient
from app.persistence import AnalysisRepository, Database, DatabaseUnavailableError
from app.routers.analysis_router import router as analysis_router
from app.mistakes import MistakeRepository
from app.routers.mistake_router import router as mistake_router

# Global engine singletons, initialized during app lifespan.
# Access via app.state.stockfish / app.state.maia.
# A threading lock serialises Stockfish calls across concurrent requests
# (the UCI protocol is single-threaded).
stockfish_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database = Database(settings.database_path)
    try:
        database.initialize()
        app.state.analysis_repository = AnalysisRepository(database)
        app.state.mistake_repository = MistakeRepository(database)
        app.state.mistake_import_summary = app.state.mistake_repository.import_legacy_training_items()
        app.state.persistence_warning = None
    except DatabaseUnavailableError as exc:
        # Ordinary analysis remains usable if local review storage is unavailable.
        app.state.analysis_repository = None
        app.state.mistake_repository = None
        app.state.mistake_import_summary = None
        app.state.persistence_warning = str(exc)
    app.state.database = database
    # Startup: create engine singletons
    app.state.stockfish = StockfishClient(
        settings.stockfish_path,
        depth=settings.default_engine_depth,
        threads=settings.stockfish_threads,
        hash_mb=settings.stockfish_hash_mb,
        search_cache_entries=settings.stockfish_search_cache_entries,
    )
    app.state.maia = await Maia3Client.create(
        checkpoint_path=MAIA3_CHECKPOINT_PATH,
        model_name=MAIA3_MODEL,
        device=MAIA3_DEVICE,
        use_history=MAIA3_USE_HISTORY,
        default_elo=DEFAULT_MAIA3_ELO,
    )
    app.state.stockfish_lock = stockfish_lock
    yield
    # Shutdown: close engines (maia first to stop accepting predict() calls)
    await app.state.maia.close()
    app.state.stockfish.close()
    app.state.database.close()


app = FastAPI(title="MasterPrep Analytics", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis_router)
app.include_router(mistake_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
