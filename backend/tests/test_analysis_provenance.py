from dataclasses import replace

from app.persistence.provenance import (
    ANALYSIS_FINGERPRINT_VERSION,
    GAME_FINGERPRINT_VERSION,
    PgnValidationError,
    analysis_fingerprint,
    build_analysis_snapshot,
    game_fingerprint,
    mistake_fingerprint,
    normalized_mainline_pgn,
    parse_pgn_games,
    parse_single_game_pgn,
    pgn_fingerprint,
    provenance_fingerprint,
)
import pytest


PGN_A = """[Event \"A\"]\n[White \"Same\"]\n[Black \"Same\"]\n[Result \"*\"]\n\n1. e4 e5 *"""
PGN_B = """[Event \"A\"]\n[White \"Same\"]\n[Black \"Same\"]\n[Result \"*\"]\n\n1. d4 d5 *"""


def test_normalized_pgn_fingerprint_is_stable_and_mainline_sensitive():
    normalized = normalized_mainline_pgn(PGN_A)
    assert pgn_fingerprint(normalized) == pgn_fingerprint(normalized_mainline_pgn(PGN_A))
    assert pgn_fingerprint(normalized) != pgn_fingerprint(normalized_mainline_pgn(PGN_B))


def test_provenance_changes_with_settings_or_model():
    digest = pgn_fingerprint(normalized_mainline_pgn(PGN_A))
    base = provenance_fingerprint(digest, {"depth": 12}, {"name": "sf"}, {"model": "m3"})
    assert base != provenance_fingerprint(
        digest, {"depth": 18}, {"name": "sf"}, {"model": "m3"}
    )
    assert base != provenance_fingerprint(
        digest, {"depth": 12}, {"name": "sf"}, {"model": "m4"}
    )


def test_snapshot_round_trip_fields_without_moves():
    snapshot = build_analysis_snapshot(
        PGN_A,
        request={"engine_depth": 12},
        engine={"name": "Stockfish"},
        maia={"model": "maia3-79m"},
        moves=[],
        minefields=[],
    )
    assert snapshot.headers["White"] == "Same"
    assert snapshot.result["moves"] == []
    assert snapshot.result["minefields"] == []
    assert len(snapshot.result["move_context"]) == 2
    assert snapshot.result["move_context"][0]["played_move_uci"] == "e2e4"
    assert snapshot.game_fingerprint == snapshot.pgn_fingerprint
    assert snapshot.analysis_fingerprint == snapshot.provenance_fingerprint
    assert snapshot.metric_schema_version >= 1


def test_parser_returns_one_canonical_replay_model():
    parsed = parse_single_game_pgn(
        '[Event "Clock"]\n\n1. e4 {[%clk 0:10:00]} e5 2. Nf3 *'
    )
    assert parsed.headers["Event"] == "Clock"
    assert parsed.initial_fen.startswith("rnbqkbnr/pppppppp")
    assert parsed.mainline_uci == ("e2e4", "e7e5", "g1f3")
    assert parsed.move_context[0]["clock_after"] == "0:10:00"
    assert parsed.move_context[1]["side"] == "black"
    assert parsed.max_depth == 3


def test_game_fingerprint_ignores_presentation_metadata_and_variations():
    plain = parse_single_game_pgn(
        '[Event "One"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *'
    )
    decorated = parse_single_game_pgn(
        '[Event "Elsewhere"]\n[White "Renamed"]\n[Result "1-0"]\n\n'
        '1. e4 $1 {comment [%clk 0:09:59]} e5 (1... c5) 2. Nf3 1-0'
    )
    assert GAME_FINGERPRINT_VERSION == 1
    assert game_fingerprint(plain) == game_fingerprint(decorated)


@pytest.mark.parametrize(
    "other",
    [
        '[Event "A"]\n\n1. d4 d5 *',
        '[Event "A"]\n\n1. e4 e5 2. Nf3 Nc6 *',
        '[Event "A"]\n\n1. e4 c5 2. Nf3 *',
        '[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/6k1 w - - 0 1"]\n\n1. Kf3 *',
    ],
)
def test_game_fingerprint_changes_with_chess_content(other: str):
    base = parse_single_game_pgn('[Event "A"]\n\n1. e4 e5 2. Nf3 *')
    assert game_fingerprint(base) != game_fingerprint(parse_single_game_pgn(other))


def test_identical_headers_do_not_override_different_moves():
    assert game_fingerprint(parse_single_game_pgn(PGN_A)) != game_fingerprint(
        parse_single_game_pgn(PGN_B)
    )


def test_parser_rejects_empty_mainline_and_multiple_games():
    with pytest.raises(PgnValidationError, match="at least one"):
        parse_single_game_pgn('[Event "Empty"]\n\n*')
    with pytest.raises(PgnValidationError, match="one game"):
        parse_single_game_pgn(PGN_A + "\n\n" + PGN_B)


def test_multi_game_parser_preserves_order_and_per_game_context():
    custom = (
        '[Event "Custom"]\n[SetUp "1"]\n'
        '[FEN "8/8/8/8/8/8/4K3/6k1 w - - 0 1"]\n\n1. Kf3 *'
    )
    games = parse_pgn_games(
        PGN_A + '\n\n' +
        '[Event "Decorated"]\n\n1. d4 {main} d5 (1... Nf6) 2. c4 *' +
        '\n\n' + custom
    )

    assert [game.headers["Event"] for game in games] == ["A", "Decorated", "Custom"]
    assert games[0].mainline_uci == ("e2e4", "e7e5")
    assert games[1].num_variations == 1 and games[1].max_depth == 3
    assert games[2].initial_fen.startswith("8/8/8/8")


def test_multi_game_parser_keeps_duplicate_entries_for_batch_accounting():
    games = parse_pgn_games(PGN_A + "\n\n" + PGN_A + "\n\n" + PGN_B)
    assert len(games) == 3
    assert game_fingerprint(games[0]) == game_fingerprint(games[1])
    assert game_fingerprint(games[0]) != game_fingerprint(games[2])


def test_multi_game_parser_identifies_an_invalid_later_game():
    with pytest.raises(PgnValidationError, match=r"Game 2:.*at least one"):
        parse_pgn_games(PGN_A + '\n\n[Event "Empty"]\n\n*')


def test_strict_snapshot_and_fingerprint_callers_reject_multiple_games():
    multiple = PGN_A + "\n\n" + PGN_B
    with pytest.raises(PgnValidationError, match="one game"):
        build_analysis_snapshot(
            multiple,
            request={"engine_depth": 12},
            engine={"name": "Stockfish"},
            maia={"model": "maia3-79m"},
            moves=[],
            minefields=[],
        )
    with pytest.raises(PgnValidationError, match="one game"):
        pgn_fingerprint(multiple)


def test_analysis_fingerprint_ignores_incidental_fields_but_covers_inputs():
    digest = game_fingerprint(parse_single_game_pgn(PGN_A))
    request = {"pgn": PGN_A, "game_id": "one", "engine_depth": 12, "acceptable_drop": 0.5}
    engine = {"name": "Stockfish 17", "path": "/one/stockfish", "threads": 2}
    maia = {"model": "maia3-79m", "checkpoint": "model.pt", "use_history": True}
    base = analysis_fingerprint(digest, request, engine, maia)
    assert ANALYSIS_FINGERPRINT_VERSION == 1
    assert base == analysis_fingerprint(
        digest,
        {**request, "pgn": "presentation changed", "game_id": "two"},
        {**engine, "path": "/moved/stockfish"},
        maia,
    )
    assert base != analysis_fingerprint(digest, {**request, "engine_depth": 18}, engine, maia)
    assert base != analysis_fingerprint(digest, request, engine, {**maia, "checkpoint": "new.pt"})
    assert base != analysis_fingerprint(digest, request, engine, maia, metric_schema_version=99)


def test_mistake_fingerprint_is_cross_run_stable_and_game_scoped():
    parsed = parse_single_game_pgn(PGN_A)
    digest = game_fingerprint(parsed)
    context = parsed.move_context[0]
    first = mistake_fingerprint(
        digest, 0, "white", context["decision_fen"], context["played_move_uci"]
    )
    assert first == mistake_fingerprint(
        digest, 0, "white", context["decision_fen"], context["played_move_uci"]
    )
    assert first != mistake_fingerprint(
        "another-game", 0, "white", context["decision_fen"], context["played_move_uci"]
    )
    second = parsed.move_context[1]
    assert first != mistake_fingerprint(
        digest, 1, "black", second["decision_fen"], second["played_move_uci"]
    )
