from __future__ import annotations

from typing import Any

import chess

from app.persistence.provenance import mistake_fingerprint

from .models import MistakeReason, MistakeSuggestion


def derive_mistake_suggestions(
    analysis_run: dict[str, Any], study_side: str
) -> list[dict[str, Any]]:
    if study_side not in {"white", "black"}:
        raise ValueError("study_side must be white or black")

    request = analysis_run.get("request", {})
    result = analysis_run.get("result", {})
    contexts = result.get("move_context", [])
    acceptable_drop = float(request.get("acceptable_drop", 0.5))
    minefield_threshold = float(request.get("minefield_threshold", 0.8))
    white_elo = int(request.get("maia3_white_elo", 2200))
    black_elo = int(request.get("maia3_black_elo", 2200))
    suggestions: list[dict[str, Any]] = []

    for ply, move in enumerate(result.get("moves", [])):
        if move.get("side") != study_side:
            continue
        objective_loss = move.get("played_move_eval_drop")
        reasons: list[str] = []
        cti_lower = move.get("cti_lower_bound")
        if (
            objective_loss is not None
            and float(objective_loss) >= acceptable_drop
            and cti_lower is not None
            and float(cti_lower) >= minefield_threshold
        ):
            reasons.append(str(MistakeReason.HIGH_CTI_MISTAKE))
        if move.get("mbi_classification") == "cognitive_trap":
            reasons.append(str(MistakeReason.HUMAN_NATURAL_BLUNDER))
            if objective_loss is None:
                objective_loss = float(request.get("blunder_threshold", 1.0))
        if not reasons:
            continue

        context = contexts[ply] if ply < len(contexts) else {}
        decision_fen = str(context.get("decision_fen") or move.get("fen", ""))
        played_move_uci = context.get("played_move_uci")
        if not played_move_uci:
            try:
                board = chess.Board(decision_fen)
                played_move_uci = board.parse_san(str(move.get("move", ""))).uci()
            except ValueError as exc:
                raise ValueError(
                    f"Cannot reconstruct played move identity at ply {ply}"
                ) from exc
        game_digest = str(
            analysis_run.get("game_fingerprint")
            or analysis_run.get("pgn_fingerprint")
            or analysis_run.get("id")
        )
        stable_fingerprint = mistake_fingerprint(
            game_digest,
            ply,
            study_side,
            decision_fen,
            str(played_move_uci),
        )

        evidence = {
            "good_moves": list(move.get("good_moves", [])),
            "good_moves_with_eval": dict(move.get("good_moves_with_eval", {})),
            "best_line": list(move.get("best_line", [])),
            "stockfish_eval": move.get("stockfish_eval"),
            "eval_after": move.get("eval_after"),
            "mate_in": move.get("mate_in"),
            "acceptable_drop": acceptable_drop,
            "minefield_threshold": minefield_threshold,
            "blunder_threshold": request.get("blunder_threshold"),
            "mbi_trap_threshold": request.get("mbi_trap_threshold"),
            "maia3_white_elo": white_elo,
            "maia3_black_elo": black_elo,
            "analysis_depth": request.get("engine_depth"),
            "engine": analysis_run.get("engine", {}),
            "maia": analysis_run.get("maia", {}),
            "metric_schema_version": analysis_run.get("metric_schema_version"),
        }
        suggestion = MistakeSuggestion(
            analysis_run_id=str(analysis_run["id"]),
            game_id=analysis_run.get("game_id"),
            mistake_fingerprint=stable_fingerprint,
            ply=ply,
            move_number=int(move.get("move_number", ply // 2 + 1)),
            side=study_side,
            decision_fen=decision_fen,
            played_move=str(move.get("move", "")),
            played_move_uci=str(played_move_uci),
            best_move=move.get("best_move"),
            objective_loss=max(0.0, float(objective_loss or 0.0)),
            cti=move.get("cti"),
            cti_lower_bound=cti_lower,
            cti_upper_bound=move.get("cti_upper_bound"),
            cti_is_approximate=bool(move.get("cti_is_approximate", False)),
            mbi_classification=move.get("mbi_classification"),
            mbi_maia_prob=move.get("mbi_maia_prob"),
            system_reasons=tuple(reasons),
            evidence=evidence,
        )
        suggestions.append(suggestion.to_dict())
    return suggestions
