"""Helpers for making imported PGN text compatible with python-chess."""

import re


_TAG_PAIR_RE = r"^\s*\[[^\]\r\n]*\]\s*(?:\r?\n)"
_MOVE_START_RE = r"\s*(?:\d+\s*\.|[O0]-[O0]|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8])"


def normalize_pgn_for_python_chess(pgn_text: str) -> str:
    """Collapse extra blank lines between a PGN tag section and movetext.

    python-chess treats a second blank line after the headers as the end of a
    header-only game. Some exporters emit two blank lines before the first move,
    which makes otherwise playable PGNs parse as zero-move games.
    """
    return re.sub(
        rf"((?:{_TAG_PAIR_RE})+)(?:[ \t]*\r?\n){{2,}}(?={_MOVE_START_RE})",
        r"\1\n",
        pgn_text,
        flags=re.MULTILINE,
    )
