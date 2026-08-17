from __future__ import annotations

from dataclasses import replace

import chess
import pytest

from app.analysis.analyzer import analyze_game
from app.analysis.data_models import RootEvaluationSnapshot


PGN = "1. e4 e5 2. Nf3 *"
CUSTOM_INITIAL_PGN = (
    '[SetUp "1"]\n'
    '[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 1 1"]\n\n'
    '1. e4 *'
)


class TrackingMaia:
    model_name = "tracking-maia"
    use_history = False

    def __init__(self):
        self.calls: list[str] = []

    def predict(self, board, **_kwargs):
        self.calls.append("white" if board.turn == chess.WHITE else "black")
        moves = sorted(board.legal_moves, key=lambda move: move.uci())
        if len(moves) == 1:
            return {moves[0]: 1.0}
        tail = 0.005 / (len(moves) - 1)
        return {
            move: 0.995 if index == 0 else tail
            for index, move in enumerate(moves)
        }


class TrackingStockfish:
    depth = 16

    def __init__(self):
        self.probes: list[tuple[str, int]] = []
        self.timeline: list[tuple[str, int]] = []
        self.snapshots: list[tuple[str, tuple[chess.Move, ...], int]] = []

    def quick_evaluate(self, board, depth=8):
        side = "white" if board.turn == chess.WHITE else "black"
        self.probes.append((side, depth))
        return 0.0

    def evaluate_best_move(self, board, depth=None):
        side = "white" if board.turn == chess.WHITE else "black"
        self.timeline.append((side, depth or self.depth))
        move = sorted(board.legal_moves, key=lambda candidate: candidate.uci())[0]
        return move, 7.0, [move], None

    def evaluate_root_snapshot(
        self, board, root_moves, depth=None, *, retry_incomplete=True
    ):
        roots = tuple(dict.fromkeys(root_moves))
        side = "white" if board.turn == chess.WHITE else "black"
        selected_depth = depth or self.depth
        self.snapshots.append((side, roots, selected_depth))
        evaluations = {
            move: (1.0 - index * 0.01, [move], None)
            for index, move in enumerate(roots)
        }
        return RootEvaluationSnapshot(
            requested_roots=roots,
            evaluations=evaluations,
            ranks={move: index for index, move in enumerate(roots)},
            depth=selected_depth,
        )


@pytest.mark.parametrize(
    ("scope", "expected_cti_sides"),
    [
        ("both", ["black", "white"]),
        ("white", ["white"]),
        ("black", ["black"]),
    ],
)
def test_scope_keeps_timeline_everywhere_and_limits_decision_work(
    scope, expected_cti_sides
):
    stockfish = TrackingStockfish()
    maia = TrackingMaia()

    complete = list(
        analyze_game(PGN, stockfish, maia, analysis_scope=scope)
    )[-1]

    assert len(complete.moves) == 3
    assert len(stockfish.timeline) == 4  # three pre-move positions plus final
    assert maia.calls == expected_cti_sides
    assert [side for side, _roots, _depth in stockfish.snapshots] == expected_cti_sides
    assert complete.moves[0].cti_skip_reason == "initial_position"
    assert complete.moves[0].comparison_status == "not_applicable"
    assert complete.moves[0].cti is None
    assert complete.moves[0].stockfish_eval == 7.0
    assert [move.eval_after for move in complete.moves[:-1]] == [
        move.stockfish_eval for move in complete.moves[1:]
    ]
    assert all(
        complete.moves[index].comparison_status == "complete"
        for index in complete.minefields
    )

    for move in complete.moves[1:]:
        selected = scope == "both" or move.side == scope
        if selected:
            assert move.comparison_status == "complete"
            assert move.cti_skip_reason is None
            assert move.cti is not None
            assert move.matched_best_eval == 1.0
            expected_timeline = 7.0 if move.side == "white" else -7.0
            assert move.stockfish_eval == expected_timeline
        else:
            assert move.comparison_status == "not_applicable"
            assert move.cti_skip_reason == "side_not_selected"
            assert move.cti is None
            assert move.best_move is None
            assert move.good_moves == []
            assert move.played_move_eval_drop is None
            assert move.is_minefield is False


def test_initial_position_reason_precedes_unselected_side():
    complete = list(
        analyze_game(
            "1. e4 *",
            TrackingStockfish(),
            TrackingMaia(),
            analysis_scope="black",
        )
    )[-1]

    assert complete.moves[0].cti_skip_reason == "initial_position"


def test_custom_first_position_is_not_treated_as_canonical_initial_fen():
    stockfish = TrackingStockfish()
    maia = TrackingMaia()

    complete = list(
        analyze_game(CUSTOM_INITIAL_PGN, stockfish, maia, analysis_scope="both")
    )[-1]

    assert complete.moves[0].cti_skip_reason is None
    assert complete.moves[0].comparison_status == "complete"
    assert maia.calls == ["white"]
    assert len(stockfish.snapshots) == 1


def test_resume_preserves_scoped_prefix_and_continues_matching_scope():
    original = list(
        analyze_game(PGN, TrackingStockfish(), TrackingMaia(), analysis_scope="white")
    )[-1]
    prefix = [replace(move) for move in original.moves[:2]]
    stockfish = TrackingStockfish()
    maia = TrackingMaia()

    resumed = list(
        analyze_game(
            PGN,
            stockfish,
            maia,
            analysis_scope="white",
            initial_moves=prefix,
            initial_minefields=[],
            start_index=2,
        )
    )[-1]

    assert resumed.moves[:2] == prefix
    assert resumed.moves[0].cti_skip_reason == "initial_position"
    assert resumed.moves[1].cti_skip_reason == "side_not_selected"
    assert resumed.moves[2].comparison_status == "complete"
    assert maia.calls == ["white"]
    assert len(stockfish.timeline) == 2  # remaining decision plus final


def test_analyzer_rejects_unknown_scope_for_direct_callers():
    with pytest.raises(ValueError, match="analysis_scope"):
        list(
            analyze_game(
                PGN,
                TrackingStockfish(),
                TrackingMaia(),
                analysis_scope="either",
            )
        )


@pytest.mark.parametrize(
    "pgn",
    [
        (
            '[SetUp "1"]\n'
            '[FEN "8/8/8/8/8/4K3/R7/7k w - - 0 1"]\n\n'
            '1. Ke4 *'
        ),
        (
            '[SetUp "1"]\n'
            '[FEN "8/PP4pp/8/8/8/8/8/KQk5 b - - 0 1"]\n\n'
            '1... Kd2 *'
        ),
    ],
)
def test_existing_small_material_and_forced_move_skips_keep_timeline(pgn):
    stockfish = TrackingStockfish()
    maia = TrackingMaia()

    complete = list(analyze_game(pgn, stockfish, maia, analysis_scope="both"))[-1]

    assert complete.moves[0].comparison_status == "not_applicable"
    assert complete.moves[0].cti is None
    assert complete.moves[0].stockfish_eval in {7.0, -7.0}
    assert maia.calls == []
    assert stockfish.snapshots == []
    assert len(stockfish.timeline) == 2  # decision and non-terminal final position


def test_terminal_final_position_uses_exact_result_without_extra_pv_search():
    stockfish = TrackingStockfish()
    complete = list(
        analyze_game(
            "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# *",
            stockfish,
            TrackingMaia(),
            analysis_scope="white",
        )
    )[-1]

    assert len(stockfish.timeline) == len(complete.moves)
    assert complete.moves[-1].eval_after > 90
    assert complete.moves[-1].mate_in == 0
