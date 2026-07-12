"""Shared evaluation normalization for terminal and mate positions."""

import chess


MATE_SCORE_PAWNS = 100.0
MATE_SCORE_CENTIPAWNS = int(MATE_SCORE_PAWNS * 100)


def terminal_eval_white(board: chess.Board) -> float | None:
    """Return a terminal evaluation from White's perspective, or ``None``.

    Decisive outcomes use the same finite mate-score magnitude used when
    normalizing Stockfish scores. Drawn outcomes are neutral.
    """
    outcome = board.outcome(claim_draw=False)
    if outcome is None:
        return None
    if outcome.winner is None:
        return 0.0
    return MATE_SCORE_PAWNS if outcome.winner == chess.WHITE else -MATE_SCORE_PAWNS

