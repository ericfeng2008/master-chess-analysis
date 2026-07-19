from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.mistakes import MistakeRepository
from app.persistence import AnalysisRepository
from app.models.schemas import (
    GameMetadataPatch,
    MistakeAttemptCreate,
    SaveMistakesRequest,
    SavedMistakePatch,
    SavedMistakeTagsPatch,
)


router = APIRouter(prefix="/api")


def repository(request: Request) -> MistakeRepository:
    value = getattr(request.app.state, "mistake_repository", None)
    if value is None:
        raise HTTPException(status_code=503, detail="Local Mistake Library is unavailable")
    return value


@router.get("/stored-games")
def list_stored_games(
    request: Request,
    query: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    analysis_state: str = Query(default="all", pattern="^(all|analyzed|not_analyzed)$"),
    sort: str = Query(default="recent", pattern="^(recent|added|players)$"),
):
    return repository(request).list_games(query=query, page=page, page_size=page_size, analysis_state=analysis_state, sort=sort)


@router.post("/stored-games/{game_id}/open")
def open_stored_game(game_id: str, request: Request):
    result = AnalysisRepository(repository(request).database).open_game(game_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Stored game not found")
    return result


@router.patch("/stored-games/{game_id}/metadata")
def update_stored_game_metadata(game_id: str, body: GameMetadataPatch, request: Request):
    patch = {key: getattr(body, key) for key in body.model_fields_set}
    try:
        result = AnalysisRepository(repository(request).database).update_metadata(game_id, patch)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Stored game not found")
    return result


@router.get("/stored-games/{game_id}")
def get_stored_game(
    game_id: str, request: Request, analysis_run_id: str | None = None
):
    result = repository(request).get_logical_game(game_id, analysis_run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Stored game not found")
    return result


@router.get("/analysis-runs/{analysis_run_id}")
def get_analysis_run(analysis_run_id: str, request: Request):
    result = repository(request).get_game(analysis_run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Stored game not found")
    return result


@router.get("/analysis-runs/{analysis_run_id}/mistake-suggestions")
def get_mistake_suggestions(analysis_run_id: str, study_side: str, request: Request):
    try:
        items = repository(request).suggestions(analysis_run_id, study_side)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Stored game not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"items": items, "study_side": study_side}


@router.get("/stored-games/{analysis_run_id}/mistake-suggestions", include_in_schema=False)
def get_mistake_suggestions_legacy(
    analysis_run_id: str, study_side: str, request: Request
):
    return get_mistake_suggestions(analysis_run_id, study_side, request)


@router.post("/saved-mistakes")
def save_mistakes(body: SaveMistakesRequest, request: Request):
    try:
        return repository(request).save_selected(
            body.analysis_run_id, body.study_side, body.plies
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Stored game not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/saved-mistakes")
def list_mistakes(
    request: Request,
    query: str = "",
    player_name: str = Query(default="", max_length=200),
    side: str | None = None,
    reason: str | None = None,
    tag: str | None = None,
    lifecycle: str = "active",
    practice_state: str | None = None,
    analysis_run_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    try:
        return repository(request).list_mistakes(
            query=query, player_name=player_name, side=side, reason=reason, tag=tag, lifecycle=lifecycle,
            practice_state=practice_state, analysis_run_id=analysis_run_id,
            page=page, page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/saved-mistakes/{mistake_id}")
def get_mistake(mistake_id: str, request: Request):
    result = repository(request).get_mistake(mistake_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Saved mistake not found")
    return result


@router.patch("/saved-mistakes/{mistake_id}")
def update_mistake(mistake_id: str, body: SavedMistakePatch, request: Request):
    try:
        result = repository(request).update_mistake(
            mistake_id, note=body.note, lifecycle=body.lifecycle
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Saved mistake not found")
    return result


@router.delete("/saved-mistakes/{mistake_id}", status_code=204)
def delete_mistake(mistake_id: str, request: Request):
    if not repository(request).delete_mistake(mistake_id):
        raise HTTPException(status_code=404, detail="Saved mistake not found")
    return Response(status_code=204)


@router.get("/mistake-tags")
def list_tags(request: Request):
    return {"items": repository(request).list_tags()}


@router.put("/saved-mistakes/{mistake_id}/tags")
def replace_tags(mistake_id: str, body: SavedMistakeTagsPatch, request: Request):
    try:
        result = repository(request).replace_tags(mistake_id, body.names)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Saved mistake not found")
    return result


@router.get("/saved-mistakes/{mistake_id}/attempts")
def list_attempts(mistake_id: str, request: Request):
    if repository(request).get_mistake(mistake_id) is None:
        raise HTTPException(status_code=404, detail="Saved mistake not found")
    return {"items": repository(request).list_attempts(mistake_id)}


@router.post("/saved-mistakes/{mistake_id}/attempts")
def add_attempt(mistake_id: str, body: MistakeAttemptCreate, request: Request):
    try:
        result = repository(request).add_attempt(mistake_id, body.chosen_move, body.outcome)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Saved mistake not found")
    return result
