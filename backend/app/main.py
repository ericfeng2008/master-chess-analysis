import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.engines.maia_client import MaiaClient
from app.engines.stockfish_client import StockfishClient
from app.routers.analysis_router import router as analysis_router

# Global engine singletons, initialized during app lifespan.
# Access via app.state.stockfish / app.state.maia.
# A threading lock serialises Stockfish calls across concurrent requests
# (the UCI protocol is single-threaded).
stockfish_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create engine singletons
    app.state.stockfish = StockfishClient(
        settings.stockfish_path,
        depth=settings.default_engine_depth,
        threads=settings.stockfish_threads,
        hash_mb=settings.stockfish_hash_mb,
    )
    app.state.maia = await MaiaClient.create(
        settings.lc0_path,
        settings.maia_weights_path,
        backend=settings.lc0_backend,
    )
    app.state.stockfish_lock = stockfish_lock
    yield
    # Shutdown: close engines (maia first to stop accepting predict() calls)
    await app.state.maia.close()
    app.state.stockfish.close()


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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
