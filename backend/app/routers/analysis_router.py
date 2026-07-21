import json
import threading
from dataclasses import asdict

import chess
from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.analysis.analyzer import analyze_game
from app.analysis.diagnostics import (
    AnalysisDiagnostics,
    activate_diagnostics,
    diagnostic_scope,
    diagnostic_stage,
)
from app.analysis.data_models import AnalysisCompleteEvent, AnalysisProgressEvent
from app.engines.maia3_client import Maia3Client
from app.engines.stockfish_client import StockfishClient
from app.models.schemas import AnalyzeRequest, EvaluatePositionRequest, EvaluatePositionResponse, PgnUploadResponse
from app.persistence import AnalysisRepository
from app.persistence.provenance import (
    METRIC_SCHEMA_VERSION,
    PgnValidationError,
    build_analysis_snapshot,
    game_fingerprint,
    parse_pgn_games,
    parse_single_game_pgn,
)

router = APIRouter()


def _maia_identity(maia: Maia3Client) -> dict:
    checkpoint = getattr(maia, "checkpoint_path", None)
    return {
        "model": getattr(maia, "model_name", "unknown"),
        "checkpoint": getattr(checkpoint, "name", str(checkpoint or "unknown")),
        "device": getattr(maia, "device", "unknown"),
        "use_history": bool(getattr(maia, "use_history", False)),
    }


def _engine_identity(stockfish: StockfishClient, depth: int) -> dict:
    identity = dict(stockfish.identity)
    identity["depth"] = depth
    return identity


def _complete_event(
    *,
    moves: list[dict],
    minefields: list[int],
    analysis_run_id: str | None,
    game_id: str | None,
    cache_hit: bool,
    analysis_history: list[dict],
    persistence_warning: str | None,
) -> str:
    data = json.dumps(
        {
            "type": "complete",
            "moves": moves,
            "minefields": minefields,
            "analysis_run_id": analysis_run_id,
            "game_id": game_id,
            "cache_hit": cache_hit,
            "analysis_history": analysis_history,
            "persistence_warning": persistence_warning,
        }
    )
    return f"data: {data}\n\n"


@router.post("/api/upload-pgn", response_model=PgnUploadResponse)
async def upload_pgn(file: UploadFile, request: Request):
    content = await file.read()
    if not content or not content.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        pgn_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400, detail="File is not valid text (expected UTF-8 PGN)"
        )

    try:
        parsed_games = parse_pgn_games(pgn_text)
    except PgnValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    parsed = parsed_games[0]
    num_unique_games = len({game_fingerprint(game) for game in parsed_games})
    num_games_added = 0
    num_games_existing = 0
    num_duplicate_games = len(parsed_games) - num_unique_games
    num_games_saved = 0

    game_id = None
    fingerprint_version = None
    game_digest = None
    preferred_run_id = None
    history: list[dict] = []
    metadata: dict[str, str] = {}
    metadata_sources: dict[str, str] = {}
    metadata_missing: list[str] = []
    metadata_updated_at: str | None = None
    source_headers: dict[str, str] = {}
    imported_metadata: dict[str, str] = {}
    metadata_overrides: dict[str, str] = {}
    persistence_warning: str | None = getattr(
        request.app.state, "persistence_warning", None
    )
    repository: AnalysisRepository | None = getattr(
        request.app.state, "analysis_repository", None
    )
    if repository is not None:
        try:
            batch = repository.upsert_games(parsed_games)
            game = batch["games"][0]
            import_result = repository.game_import_result(game)
            num_unique_games = int(batch["num_unique_games"])
            num_games_added = int(batch["num_games_added"])
            num_games_existing = int(batch["num_games_existing"])
            num_duplicate_games = int(batch["num_duplicate_games"])
            num_games_saved = int(batch["num_games_saved"])
            game_id = str(game["id"])
            fingerprint_version = int(game["fingerprint_version"])
            game_digest = str(game["game_fingerprint"])
            preferred_run_id = import_result["preferred_analysis_run_id"]
            history = import_result["analysis_history"]
            metadata = import_result["metadata"]
            metadata_sources = import_result["metadata_sources"]
            metadata_missing = import_result["metadata_missing"]
            metadata_updated_at = import_result["metadata_updated_at"]
            source_headers = import_result["source_headers"]
            imported_metadata = import_result["imported_metadata"]
            metadata_overrides = import_result["metadata_overrides"]
        except Exception as exc:
            persistence_warning = f"Game opened, but it could not be saved locally: {exc}"

    return PgnUploadResponse(
        pgn=parsed.normalized_pgn,
        num_games=len(parsed_games),
        num_unique_games=num_unique_games,
        num_games_added=num_games_added,
        num_games_existing=num_games_existing,
        num_duplicate_games=num_duplicate_games,
        num_games_saved=num_games_saved,
        num_variations=parsed.num_variations,
        max_depth=parsed.max_depth,
        game_id=game_id,
        fingerprint_version=fingerprint_version,
        game_fingerprint=game_digest,
        preferred_analysis_run_id=preferred_run_id,
        analysis_history=history,
        persistence_warning=persistence_warning,
        metadata=metadata,
        metadata_sources=metadata_sources,
        metadata_missing=metadata_missing,
        metadata_updated_at=metadata_updated_at,
        source_headers=source_headers,
        imported_metadata=imported_metadata,
        metadata_overrides=metadata_overrides,
    )


@router.post("/api/analyze")
async def analyze(request: AnalyzeRequest, req: Request):
    stockfish: StockfishClient = req.app.state.stockfish
    maia: Maia3Client = req.app.state.maia
    lock: threading.Lock = req.app.state.stockfish_lock
    repository: AnalysisRepository | None = getattr(req.app.state, "analysis_repository", None)
    startup_persistence_warning: str | None = getattr(
        req.app.state, "persistence_warning", None
    )

    try:
        parsed = parse_single_game_pgn(request.pgn)
    except PgnValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    engine_identity = _engine_identity(stockfish, request.engine_depth)
    maia_identity = _maia_identity(maia)
    logical_game: dict | None = None
    game_id: str | None = None
    compatibility_digest: str | None = None
    if repository is not None:
        try:
            logical_game = repository.resolve_game(request.game_id, parsed.normalized_pgn)
            game_id = str(logical_game["id"])
            compatibility_digest = repository.compatible_fingerprint(
                logical_game,
                request.model_dump(),
                engine_identity,
                maia_identity,
                METRIC_SCHEMA_VERSION,
            )
            cached = repository.find_compatible_analysis(game_id, compatibility_digest)
            if cached is not None:
                history = repository.analysis_history(game_id)

                def cached_stream():
                    diagnostics = AnalysisDiagnostics("cached_analysis")
                    try:
                        result = cached.get("result", {})
                        yield _complete_event(
                            moves=list(result.get("moves", [])),
                            minefields=list(result.get("minefields", [])),
                            analysis_run_id=str(cached["id"]),
                            game_id=game_id,
                            cache_hit=True,
                            analysis_history=history,
                            persistence_warning=startup_persistence_warning,
                        )
                    except BaseException as exc:
                        diagnostics.emit("failure", type(exc).__name__)
                        raise
                    else:
                        diagnostics.emit("complete")

                return StreamingResponse(cached_stream(), media_type="text/event-stream")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Stored game not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            startup_persistence_warning = (
                f"Analysis is available, but local cache lookup failed: {exc}"
            )
            repository = None

    def event_stream():
        # Set the requested analysis depth on the shared engine instance.
        # The lock serialises engine access across concurrent requests.
        diagnostics = AnalysisDiagnostics("full_analysis")
        with lock:
            original_depth = stockfish.depth
            stockfish.depth = request.engine_depth
            events = analyze_game(
                pgn_text=request.pgn,
                stockfish=stockfish,
                maia=maia,
                acceptable_drop=request.acceptable_drop,
                minefield_threshold=request.minefield_threshold,
                blunder_threshold=request.blunder_threshold,
                mbi_trap_threshold=request.mbi_trap_threshold,
                mbi_outlier_threshold=request.mbi_outlier_threshold,
                eig_threshold=request.eig_threshold,
                bri_threshold=request.bri_threshold,
                maia3_white_elo=request.maia3_white_elo,
                maia3_black_elo=request.maia3_black_elo,
            )
            try:
                while True:
                    try:
                        # Starlette may resume a sync body iterator in a fresh
                        # context for each chunk, so activate only around the
                        # work that advances the analysis generator.
                        with activate_diagnostics(diagnostics):
                            event = next(events)
                    except StopIteration:
                        break
                    if isinstance(event, AnalysisProgressEvent):
                        data = json.dumps({
                            "type": "progress",
                            "moves_analyzed": event.moves_analyzed,
                            "total_moves": event.total_moves,
                            "minefields_found": event.minefields_found,
                        })
                        yield f"data: {data}\n\n"
                    elif isinstance(event, AnalysisCompleteEvent):
                        with activate_diagnostics(diagnostics):
                            with diagnostic_stage("result_finalization"):
                                moves_data = [asdict(move) for move in event.moves]
                                analysis_run_id: str | None = None
                                persistence_warning = startup_persistence_warning
                                if repository is not None:
                                    try:
                                        snapshot = build_analysis_snapshot(
                                            pgn_text=parsed.normalized_pgn,
                                            request=request.model_dump(),
                                            engine=engine_identity,
                                            maia=maia_identity,
                                            moves=event.moves,
                                            minefields=event.minefields,
                                            game_id=game_id,
                                        )
                                        analysis_run_id = repository.create_analysis_run(snapshot)
                                    except Exception as exc:
                                        persistence_warning = (
                                            "Analysis completed, but the local Mistake Library cannot "
                                            f"save this game because persistence failed: {exc}"
                                        )
                                history = (
                                    repository.analysis_history(game_id)
                                    if repository is not None and game_id is not None
                                    else []
                                )
                                complete_event = _complete_event(
                                    moves=moves_data,
                                    minefields=event.minefields,
                                    analysis_run_id=analysis_run_id,
                                    game_id=game_id,
                                    cache_hit=False,
                                    analysis_history=history,
                                    persistence_warning=persistence_warning,
                                )
                        yield complete_event
            except BaseException as exc:
                diagnostics.emit("failure", type(exc).__name__)
                raise
            else:
                diagnostics.emit("complete")
            finally:
                stockfish.depth = original_depth

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/api/evaluate-position", response_model=EvaluatePositionResponse)
async def evaluate_position(request: EvaluatePositionRequest, req: Request):
    # Validate FEN
    try:
        board = chess.Board(request.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN string")

    if not board.is_valid():
        raise HTTPException(status_code=400, detail="Invalid board position")

    stockfish: StockfishClient = req.app.state.stockfish
    lock: threading.Lock = req.app.state.stockfish_lock
    request_kind = "lazy_variation_detail" if request.purpose == "variation_detail" else "exploration"
    with diagnostic_scope(request_kind):
        with diagnostic_stage(request_kind):
            with lock:
                result = stockfish.evaluate_position(
                    board, depth=request.depth, acceptable_drop=request.acceptable_drop
                )
    return EvaluatePositionResponse(
        eval=result["eval"],
        best_move=result["best_move"],
        good_moves=result["good_moves"],
        good_moves_with_eval=result["good_moves_with_eval"],
        cti=None,
        mate_in=result["mate_in"],
    )
