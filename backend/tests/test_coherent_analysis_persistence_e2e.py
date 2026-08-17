from __future__ import annotations

import chess

from app.analysis.analyzer import analyze_game
from app.analysis.data_models import AnalysisMoveData, RootEvaluationSnapshot
from app.models.schemas import AnalysisMoveResult
from app.persistence import AnalysisRepository, Database
from app.persistence.provenance import METRIC_SCHEMA_VERSION, build_analysis_snapshot


PGN = (
    '[Event "Coherent persistence"]\n[SetUp "1"]\n'
    '[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 1 1"]\n'
    '[Result "*"]\n\n1. e4 e5 *'
)


class UniformMaia:
    model_name = "coherent-e2e-policy"
    use_history = False

    def predict(self, board, **_kwargs):
        moves = sorted(board.legal_moves, key=lambda move: move.uci())
        return {move: 1.0 / len(moves) for move in moves}


class CoherentStockfish:
    depth = 12

    def __init__(self):
        self.discovery_calls = 0
        self.root_calls: list[tuple[chess.Move, ...]] = []

    def quick_evaluate(self, board, depth=8):
        return 0.0

    def quick_evaluate_with_mate(self, board, depth=8):
        return 0.0, None

    def evaluate_best_move(self, board, depth=None):
        self.discovery_calls += 1
        discovered = sorted(board.legal_moves, key=lambda move: move.uci())[-1]
        return discovered, 86.38, [discovered], None

    def evaluate_root_moves(self, board, root_moves, depth=None):
        roots = tuple(dict.fromkeys(root_moves))
        self.root_calls.append(roots)
        return {
            move: (1.0 - rank * 0.01, [move], None)
            for rank, move in enumerate(roots)
        }

    def evaluate_root_snapshot(
        self, board, root_moves, depth=None, *, retry_incomplete=True
    ):
        roots = tuple(dict.fromkeys(root_moves))
        evaluations = self.evaluate_root_moves(board, roots, depth=depth)
        return RootEvaluationSnapshot(
            requested_roots=roots,
            evaluations=evaluations,
            ranks={move: rank for rank, move in enumerate(evaluations)},
            depth=depth or self.depth,
        )

    def evaluate_move(self, *_args, **_kwargs):
        raise AssertionError("coherent analysis must not use forced-root fallback")


def test_coherent_white_and_black_results_survive_persistence_and_restoration(tmp_path):
    stockfish = CoherentStockfish()
    complete = list(analyze_game(PGN, stockfish, UniformMaia()))[-1]

    assert len(complete.moves) == 2
    assert stockfish.discovery_calls == 3  # both decisions plus final timeline
    assert len(stockfish.root_calls) == 2
    black = complete.moves[1]
    assert black.side == "black" and black.comparison_status == "complete"
    assert black.matched_best_eval == 1.0
    assert black.played_move_eval_drop is not None
    assert all(-0.3 < delta <= 0.0 for delta in black.good_moves_with_eval.values())

    database = Database(tmp_path / "analysis.db")
    database.initialize()
    repository = AnalysisRepository(database)
    game = repository.upsert_game(PGN)
    snapshot = build_analysis_snapshot(
        PGN,
        request={"engine_depth": 12, "acceptable_drop": 0.3},
        engine={"name": "CoherentStockfish", "threads": 1},
        maia={"model": "coherent-e2e-policy"},
        moves=complete.moves,
        minefields=complete.minefields,
        game_id=game["id"],
    )
    run_id = repository.create_analysis_run(snapshot)

    logical = repository.logical_game_detail(game["id"])
    assert logical and logical["preferred_analysis_run_id"] == run_id
    assert logical["analysis"]["metric_schema_version"] == METRIC_SCHEMA_VERSION == 5
    assert logical["analysis"]["is_legacy"] is False
    restored_payload = logical["analysis"]["result"]["moves"]
    restored_black = AnalysisMoveData(**restored_payload[1])
    AnalysisMoveResult.model_validate(restored_payload[1])

    assert restored_black.cti == black.cti
    assert restored_black.best_move == black.best_move
    assert restored_black.good_moves_with_eval == black.good_moves_with_eval
    assert restored_black.matched_best_eval == black.matched_best_eval
    assert restored_black.matched_played_eval == black.matched_played_eval
    assert restored_black.played_move_eval_drop == black.played_move_eval_drop
    assert restored_black.comparison_method == "coherent_restricted_multipv_v1"
