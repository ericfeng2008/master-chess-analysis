from __future__ import annotations

import hashlib
import io
import json
import re
from dataclasses import asdict, dataclass
from typing import Any, Iterable

import chess
import chess.pgn

from app.analysis.data_models import AnalysisMoveData
from app.pgn_utils import normalize_pgn_for_python_chess

from .models import AnalysisRunSnapshot


METRIC_SCHEMA_VERSION = 3
GAME_FINGERPRINT_VERSION = 1
ANALYSIS_FINGERPRINT_VERSION = 1
MISTAKE_FINGERPRINT_VERSION = 1


class PgnValidationError(ValueError):
    """Raised when a PGN cannot be used by the single-game analysis workflow."""


@dataclass(frozen=True)
class ParsedPgn:
    normalized_pgn: str
    headers: dict[str, str]
    initial_fen: str
    mainline_uci: tuple[str, ...]
    move_context: tuple[dict[str, Any], ...]
    num_variations: int
    max_depth: int

    @property
    def move_count(self) -> int:
        return len(self.mainline_uci)


def _canonical_fen(board: chess.Board) -> str:
    return board.fen(en_passant="fen")


def _variation_summary(root: chess.pgn.GameNode) -> tuple[int, int]:
    variations = 0
    max_depth = 0

    def walk(node: chess.pgn.GameNode, depth: int) -> None:
        nonlocal variations, max_depth
        max_depth = max(max_depth, depth)
        for index, child in enumerate(node.variations):
            if index > 0:
                variations += 1
            walk(child, depth + 1)

    walk(root, 0)
    return variations, max_depth


def _parse_game(game: chess.pgn.Game, game_number: int) -> ParsedPgn:
    if game.errors:
        raise PgnValidationError(
            f"Game {game_number}: PGN contains an invalid move: {game.errors[0]}"
        )
    board = game.board()
    initial_fen = _canonical_fen(board)
    mainline_uci: list[str] = []
    contexts: list[dict[str, Any]] = []
    node: chess.pgn.GameNode = game
    while node.variations:
        child = node.variations[0]
        move = child.move
        if move not in board.legal_moves:
            raise PgnValidationError(
                f"Game {game_number}: PGN mainline contains an illegal move "
                f"at ply {len(mainline_uci)}"
            )
        clock = None
        match = re.search(r"\[%clk\s+([^\]]+)\]", child.comment or "")
        if match:
            clock = match.group(1).strip()
        contexts.append(
            {
                "clock_after": clock,
                "decision_fen": _canonical_fen(board),
                "played_move_uci": move.uci(),
                "side": "white" if board.turn == chess.WHITE else "black",
            }
        )
        mainline_uci.append(move.uci())
        board.push(move)
        node = child

    if not mainline_uci:
        raise PgnValidationError(
            f"Game {game_number}: PGN game must contain at least one mainline move"
        )

    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    normalized_pgn = game.accept(exporter).strip()
    variations, max_depth = _variation_summary(game)
    return ParsedPgn(
        normalized_pgn=normalized_pgn,
        headers=dict(game.headers),
        initial_fen=initial_fen,
        mainline_uci=tuple(mainline_uci),
        move_context=tuple(contexts),
        num_variations=variations,
        max_depth=max_depth,
    )


def parse_pgn_games(pgn_text: str) -> list[ParsedPgn]:
    """Parse every non-empty standard-chess game in source order."""

    source = normalize_pgn_for_python_chess(pgn_text).strip()
    if not source:
        raise PgnValidationError("Uploaded file is empty")

    stream = io.StringIO(source)
    parsed_games: list[ParsedPgn] = []
    while True:
        game_number = len(parsed_games) + 1
        try:
            game = chess.pgn.read_game(stream)
        except (ValueError, IndexError) as exc:
            raise PgnValidationError(
                f"Game {game_number}: PGN could not be parsed: {exc}"
            ) from exc
        if game is None:
            break
        parsed_games.append(_parse_game(game, game_number))

    if not parsed_games:
        raise PgnValidationError("File contains no valid PGN game")
    return parsed_games


def parse_single_game_pgn(pgn_text: str) -> ParsedPgn:
    """Parse exactly one non-empty standard-chess game and derive replay context."""

    parsed_games = parse_pgn_games(pgn_text)
    if len(parsed_games) != 1:
        raise PgnValidationError("This workflow accepts one game per PGN file")
    return parsed_games[0]


def normalized_mainline_pgn(pgn_text: str) -> str:
    """Compatibility helper returning the normalized single-game source PGN."""

    return parse_single_game_pgn(pgn_text).normalized_pgn


def game_fingerprint(parsed: ParsedPgn) -> str:
    payload = (
        f"game-fingerprint-v{GAME_FINGERPRINT_VERSION}\n"
        f"{parsed.initial_fen}\n"
        f"{' '.join(parsed.mainline_uci)}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def pgn_fingerprint(normalized_pgn: str) -> str:
    """Compatibility name for callers that still provide PGN text."""

    return game_fingerprint(parse_single_game_pgn(normalized_pgn))


def _stable_analysis_request(request: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in request.items()
        if key not in {"pgn", "game_id", "force_reanalysis"}
    }


def _stable_engine_identity(engine: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in engine.items() if key not in {"path"}}


def analysis_fingerprint(
    game_digest: str,
    request: dict[str, Any],
    engine: dict[str, Any],
    maia: dict[str, Any],
    metric_schema_version: int = METRIC_SCHEMA_VERSION,
) -> str:
    value = {
        "version": ANALYSIS_FINGERPRINT_VERSION,
        "game": game_digest,
        "request": _stable_analysis_request(request),
        "engine": _stable_engine_identity(engine),
        "maia": maia,
        "metric_schema_version": metric_schema_version,
    }
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def provenance_fingerprint(
    pgn_digest: str,
    request: dict[str, Any],
    engine: dict[str, Any],
    maia: dict[str, Any],
    metric_schema_version: int = METRIC_SCHEMA_VERSION,
) -> str:
    """Backward-compatible alias for the analysis compatibility fingerprint."""

    return analysis_fingerprint(
        pgn_digest, request, engine, maia, metric_schema_version
    )


def canonical_decision_fen(fen: str) -> str:
    try:
        return _canonical_fen(chess.Board(fen))
    except ValueError as exc:
        raise ValueError("Invalid decision FEN") from exc


def mistake_fingerprint(
    game_digest: str,
    ply: int,
    side: str,
    decision_fen: str,
    played_move_uci: str,
) -> str:
    if ply < 0:
        raise ValueError("Ply must be non-negative")
    if side not in {"white", "black"}:
        raise ValueError("Side must be white or black")
    canonical_fen = canonical_decision_fen(decision_fen)
    board = chess.Board(canonical_fen)
    try:
        move = chess.Move.from_uci(played_move_uci)
    except ValueError as exc:
        raise ValueError("Invalid played move UCI") from exc
    if move not in board.legal_moves:
        raise ValueError("Played move is not legal in the decision position")
    payload = (
        f"mistake-fingerprint-v{MISTAKE_FINGERPRINT_VERSION}\n"
        f"{game_digest}\n{ply}\n{side}\n{canonical_fen}\n{move.uci()}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_headers(normalized_pgn: str) -> dict[str, str]:
    return parse_single_game_pgn(normalized_pgn).headers


def serialize_moves(moves: Iterable[AnalysisMoveData]) -> list[dict[str, Any]]:
    return [asdict(move) for move in moves]


def extract_move_context(normalized_pgn: str) -> list[dict[str, Any]]:
    return list(parse_single_game_pgn(normalized_pgn).move_context)


def build_analysis_snapshot(
    pgn_text: str,
    request: dict[str, Any],
    engine: dict[str, Any],
    maia: dict[str, Any],
    moves: Iterable[AnalysisMoveData],
    minefields: list[int],
    *,
    game_id: str | None = None,
) -> AnalysisRunSnapshot:
    parsed = parse_single_game_pgn(pgn_text)
    game_digest = game_fingerprint(parsed)
    analysis_digest = analysis_fingerprint(game_digest, request, engine, maia)
    return AnalysisRunSnapshot(
        normalized_pgn=parsed.normalized_pgn,
        headers=parsed.headers,
        request=_stable_analysis_request(request),
        engine=_stable_engine_identity(engine),
        maia=maia,
        metric_schema_version=METRIC_SCHEMA_VERSION,
        result={
            "moves": serialize_moves(moves),
            "minefields": minefields,
            "move_context": list(parsed.move_context),
        },
        pgn_fingerprint=game_digest,
        provenance_fingerprint=analysis_digest,
        game_id=game_id,
        game_fingerprint=game_digest,
        analysis_fingerprint=analysis_digest,
    )
