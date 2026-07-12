import io
import json
import threading

import chess
import chess.pgn
from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.analysis.analyzer import analyze_game
from app.analysis.data_models import AnalysisCompleteEvent, AnalysisProgressEvent
from app.engines.maia3_client import Maia3Client
from app.engines.stockfish_client import StockfishClient
from app.models.schemas import AnalyzeRequest, EvaluatePositionRequest, EvaluatePositionResponse, PgnUploadResponse
from app.pgn_utils import normalize_pgn_for_python_chess

router = APIRouter()


def _count_variations(node: chess.pgn.GameNode) -> tuple[int, int]:
    """Count total variations and max depth in a game tree.

    Returns (num_variations, max_depth) where num_variations counts
    every branching variation and max_depth is the longest line in
    half-moves.
    """
    variations = 0
    max_depth = 0

    def walk(node: chess.pgn.GameNode, depth: int):
        nonlocal variations, max_depth
        max_depth = max(max_depth, depth)
        for i, variation in enumerate(node.variations):
            if i > 0:
                variations += 1
            walk(variation, depth + 1)

    walk(node, 0)
    return variations, max_depth


@router.post("/api/upload-pgn", response_model=PgnUploadResponse)
async def upload_pgn(file: UploadFile):
    content = await file.read()
    if not content or not content.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        pgn_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400, detail="File is not valid text (expected UTF-8 PGN)"
        )

    pgn_text = normalize_pgn_for_python_chess(pgn_text)
    pgn_io = io.StringIO(pgn_text)
    num_games = 0
    total_variations = 0
    overall_max_depth = 0

    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break
        num_games += 1
        variations, max_depth = _count_variations(game)
        total_variations += variations
        overall_max_depth = max(overall_max_depth, max_depth)

    if num_games == 0:
        raise HTTPException(
            status_code=400, detail="File contains no valid PGN games"
        )

    return PgnUploadResponse(
        pgn=pgn_text,
        num_games=num_games,
        num_variations=total_variations,
        max_depth=overall_max_depth,
    )


@router.post("/api/analyze")
async def analyze(request: AnalyzeRequest, req: Request):
    stockfish: StockfishClient = req.app.state.stockfish
    maia: Maia3Client = req.app.state.maia
    lock: threading.Lock = req.app.state.stockfish_lock

    def event_stream():
        # Set the requested analysis depth on the shared engine instance.
        # The lock serialises engine access across concurrent requests.
        with lock:
            original_depth = stockfish.depth
            stockfish.depth = request.engine_depth
            try:
                for event in analyze_game(
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
                ):
                    if isinstance(event, AnalysisProgressEvent):
                        data = json.dumps({
                            "type": "progress",
                            "moves_analyzed": event.moves_analyzed,
                            "total_moves": event.total_moves,
                            "minefields_found": event.minefields_found,
                        })
                        yield f"data: {data}\n\n"
                    elif isinstance(event, AnalysisCompleteEvent):
                        moves_data = []
                        for m in event.moves:
                            moves_data.append({
                                "move_number": m.move_number,
                                "side": m.side,
                                "move": m.move,
                                "fen": m.fen,
                                "stockfish_eval": m.stockfish_eval,
                                "eval_after": m.eval_after,
                                "cti": m.cti,
                                "cti_lower_bound": m.cti_lower_bound,
                                "cti_upper_bound": m.cti_upper_bound,
                                "cti_remaining_mass": m.cti_remaining_mass,
                                "cti_is_approximate": m.cti_is_approximate,
                                "best_move": m.best_move,
                                "good_moves": m.good_moves,
                                "good_moves_with_eval": m.good_moves_with_eval,
                                "is_minefield": m.is_minefield,
                                "mbi_classification": m.mbi_classification,
                                "mbi_maia_prob": m.mbi_maia_prob,
                                "eig_value": m.eig_value,
                                "is_eig_flagged": m.is_eig_flagged,
                                "is_brilliant": m.is_brilliant,
                                "bri_maia_prob": m.bri_maia_prob,
                                "epe_score": m.epe_score,
                                "best_line": m.best_line,
                                "best_line_evals": m.best_line_evals,
                                "mate_in": m.mate_in,
                            })
                        data = json.dumps({
                            "type": "complete",
                            "moves": moves_data,
                            "minefields": event.minefields,
                        })
                        yield f"data: {data}\n\n"
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
