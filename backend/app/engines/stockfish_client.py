import os

import chess
import chess.engine

from app.analysis.evaluation import (
    MATE_SCORE_CENTIPAWNS,
    MATE_SCORE_PAWNS,
    terminal_eval_white,
)


def extract_mate(score: chess.engine.PovScore) -> int | None:
    """Return mate distance from side-to-move perspective, or None if no forced mate."""
    relative = score.relative
    if relative.is_mate():
        return relative.mate()
    return None


class StockfishClient:
    def __init__(self, path: str, depth: int = 20, threads: int = 0, hash_mb: int = 256):
        self.path = path
        self.requested_threads = threads
        self.hash_mb = hash_mb
        self.engine = chess.engine.SimpleEngine.popen_uci(path)
        self.depth = depth
        # Auto-detect CPU count if threads=0
        if threads <= 0:
            threads = max(1, (os.cpu_count() or 2) - 1)
        self.threads = threads
        self.engine.configure({"Threads": threads, "Hash": hash_mb})

    @property
    def identity(self) -> dict:
        return {
            "name": self.engine.id.get("name", "Stockfish"),
            "path": self.path,
            "depth": self.depth,
            "threads": self.threads,
            "hash_mb": self.hash_mb,
        }

    def evaluate(self, board: chess.Board) -> float:
        """Return evaluation in pawns from side-to-move perspective."""
        info = self.engine.analyse(board, chess.engine.Limit(depth=self.depth))
        score = info["score"].relative
        return score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0

    def quick_evaluate(self, board: chess.Board, depth: int = 8) -> float:
        """Fast low-depth evaluation from side-to-move perspective."""
        info = self.engine.analyse(board, chess.engine.Limit(depth=depth))
        score = info["score"].relative
        return score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0

    def quick_evaluate_with_pv(self, board: chess.Board, depth: int = 8) -> tuple[float, list[chess.Move]]:
        """Fast low-depth evaluation returning (eval, pv_line)."""
        info = self.engine.analyse(board, chess.engine.Limit(depth=depth))
        score = info["score"].relative
        pv_line = info.get("pv", [])
        return score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0, pv_line

    def quick_evaluate_with_mate(self, board: chess.Board, depth: int = 8) -> tuple[float, int | None]:
        """Fast low-depth evaluation returning (eval, mate_in)."""
        info = self.engine.analyse(board, chess.engine.Limit(depth=depth))
        score = info["score"].relative
        mate = score.mate() if score.is_mate() else None
        return score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0, mate

    def evaluate_best_move(
        self,
        board: chess.Board,
        depth: int | None = None,
    ) -> tuple[chess.Move, float, list[chess.Move], int | None] | None:
        """Return the unrestricted best root and its side-to-move evaluation."""
        if board.is_game_over() or board.legal_moves.count() == 0:
            return None
        analysis_depth = depth if depth is not None else self.depth
        info = self.engine.analyse(board, chess.engine.Limit(depth=analysis_depth))
        pv_line = info.get("pv", [])
        if not pv_line:
            return None
        score = info["score"].relative
        mate = score.mate() if score.is_mate() else None
        evaluation = score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0
        return pv_line[0], evaluation, pv_line, mate

    def evaluate_root_moves(
        self,
        board: chess.Board,
        root_moves: list[chess.Move] | tuple[chess.Move, ...],
        depth: int | None = None,
    ) -> dict[chess.Move, tuple[float, list[chess.Move], int | None]]:
        """Evaluate an explicit set of legal roots from the current perspective."""
        roots = list(dict.fromkeys(root_moves))
        if not roots:
            return {}
        illegal = [move for move in roots if move not in board.legal_moves]
        if illegal:
            raise ValueError(f"Illegal root move for position: {illegal[0].uci()}")

        analysis_depth = depth if depth is not None else self.depth
        infos = self.engine.analyse(
            board,
            chess.engine.Limit(depth=analysis_depth),
            multipv=len(roots),
            root_moves=roots,
        )
        if isinstance(infos, dict):
            infos = [infos]

        results: dict[chess.Move, tuple[float, list[chess.Move], int | None]] = {}
        for info in infos:
            pv_line = info.get("pv", [])
            if not pv_line:
                continue
            move = pv_line[0]
            score = info["score"].relative
            mate = score.mate() if score.is_mate() else None
            evaluation = score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0
            results[move] = (evaluation, pv_line, mate)
        return results

    def analyse_candidates(
        self,
        board: chess.Board,
        depth: int,
        multipv: int = 4,
        root_moves: list[chess.Move] | None = None,
    ) -> list[dict]:
        """Return bounded root evidence including WDL and search provenance."""
        if board.is_game_over() or board.legal_moves.count() == 0:
            return []
        roots = None
        if root_moves is not None:
            roots = list(dict.fromkeys(root_moves))
            illegal = [move for move in roots if move not in board.legal_moves]
            if illegal:
                raise ValueError(f"Illegal root move for position: {illegal[0].uci()}")
            multipv = min(multipv, len(roots))
        else:
            multipv = min(multipv, board.legal_moves.count())
        infos = self.engine.analyse(
            board,
            chess.engine.Limit(depth=depth),
            multipv=max(1, multipv),
            root_moves=roots,
            info=chess.engine.INFO_ALL,
        )
        if isinstance(infos, dict):
            infos = [infos]
        candidates: list[dict] = []
        for info in infos:
            pv = info.get("pv", [])
            if not pv:
                continue
            relative = info["score"].relative
            raw_wdl = relative.wdl(model="sf", ply=max(1, board.ply()))
            pv_board = board.copy()
            pv_san: list[str] = []
            for move in pv:
                if move not in pv_board.legal_moves:
                    break
                pv_san.append(pv_board.san(move))
                pv_board.push(move)
            candidates.append(
                {
                    "move": board.san(pv[0]),
                    "uci": pv[0].uci(),
                    "eval": relative.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0,
                    "mate": relative.mate() if relative.is_mate() else None,
                    "wdl": {
                        "win": raw_wdl.wins / raw_wdl.total(),
                        "draw": raw_wdl.draws / raw_wdl.total(),
                        "loss": raw_wdl.losses / raw_wdl.total(),
                    },
                    "expected_score": (raw_wdl.wins + raw_wdl.draws / 2) / raw_wdl.total(),
                    "pv": pv_san,
                    "depth": int(info.get("depth", depth)),
                    "seldepth": int(info.get("seldepth", 0)),
                    "nodes": int(info.get("nodes", 0)),
                }
            )
        return candidates

    def evaluate_all_moves(
        self,
        board: chess.Board,
        acceptable_drop: float = 0.0,
        depth: int | None = None,
        probe_eval: float | None = None,
    ) -> tuple[dict[chess.Move, tuple[float, list[chess.Move], int | None]], float | None]:
        """Return evaluation, PV line, and mate info of legal moves from side-to-move perspective.

        Each entry maps a move to (eval_in_pawns, pv_line, mate_in) where:
          eval_in_pawns: Stockfish eval after the move, from current side-to-move perspective
          pv_line: full principal variation returned by Stockfish
          mate_in: mate distance from side-to-move perspective (None if no forced mate)

        Returns (results_dict, probe_best_eval) where probe_best_eval is the
        best eval from Phase 1 (or the provided probe_eval), useful for callers
        that need an eval estimate without an extra engine call.

        When acceptable_drop > 0, uses a two-phase density-based approach:
          Phase 1: Quick probe (MultiPV=5, depth=10) to see how evals cluster.
          Phase 2: Full-depth search with MultiPV sized to the number of moves
                   within the acceptable window (with safety-margin), capped at 5.

        Pass acceptable_drop=0 for full evaluation of every legal move.
        """
        analysis_depth = depth if depth is not None else self.depth
        num_moves = board.legal_moves.count()
        if num_moves == 0:
            return {}, None

        best_probe_eval: float | None = None

        if acceptable_drop > 0:
            if probe_eval is not None:
                # Caller already has an eval estimate — skip Phase 1 entirely.
                # Use a conservative MultiPV: we don't know the density, so use
                # max(3, ...) to avoid under-sampling while still saving the probe call.
                multipv = max(1, min(max(3, num_moves), 5, num_moves))
                best_probe_eval = probe_eval
            else:
                # Phase 1: cheap probe to measure eval density among top moves
                probe_pv = min(5, num_moves)
                probe_depth = min(10, analysis_depth)
                probe_infos = self.engine.analyse(
                    board, chess.engine.Limit(depth=probe_depth), multipv=probe_pv
                )
                probe_evals: list[float] = []
                for info in probe_infos:
                    if "pv" in info and info["pv"]:
                        probe_evals.append(
                            info["score"].relative.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0
                        )
                if not probe_evals:
                    return {}, None
                # Count how many probe moves fall within acceptable_drop + safety margin
                best_probe_eval = probe_evals[0]  # MultiPV results are sorted best-first
                safety_window = acceptable_drop + 0.3
                dense_count = sum(1 for ev in probe_evals if best_probe_eval - ev <= safety_window)
                multipv = max(1, min(dense_count, 5, num_moves))
            # Phase 2: full-depth search with right-sized MultiPV.
            infos = self.engine.analyse(
                board, chess.engine.Limit(depth=analysis_depth), multipv=multipv
            )
        else:
            infos = self.engine.analyse(
                board, chess.engine.Limit(depth=analysis_depth), multipv=num_moves
            )

        results: dict[chess.Move, tuple[float, list[chess.Move], int | None]] = {}
        for info in infos:
            if "pv" in info and info["pv"]:
                move = info["pv"][0]
                score = info["score"].relative
                pv_line = info["pv"]
                mate = score.mate() if score.is_mate() else None
                results[move] = (
                    score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0,
                    pv_line,
                    mate,
                )
        return results, best_probe_eval

    def evaluate_move(
        self,
        board: chess.Board,
        move: chess.Move,
        depth: int | None = None,
    ) -> tuple[float, list[chess.Move], int | None]:
        """Evaluate one legal move from the current side-to-move perspective."""
        if move not in board.legal_moves:
            raise ValueError(f"Illegal move for position: {move.uci()}")

        analysis_depth = depth if depth is not None else self.depth
        board_after = board.copy()
        board_after.push(move)

        terminal_white = terminal_eval_white(board_after)
        if terminal_white is not None:
            eval_from_current_stm = terminal_white if board.turn == chess.WHITE else -terminal_white
            mate = 1 if abs(terminal_white) == MATE_SCORE_PAWNS else None
            return eval_from_current_stm, [move], mate

        info = self.engine.analyse(board_after, chess.engine.Limit(depth=analysis_depth))
        score = info["score"].relative
        mate = score.mate() if score.is_mate() else None
        # Engine score is from the opponent's perspective after the move.
        # Negate it to express the move value from the original side to move.
        eval_from_current_stm = -score.score(mate_score=MATE_SCORE_CENTIPAWNS) / 100.0
        pv_line = [move, *info.get("pv", [])]
        return eval_from_current_stm, pv_line, -mate if mate is not None else None

    def evaluate_position(
        self,
        board: chess.Board,
        depth: int = 12,
        acceptable_drop: float = 0.5,
    ) -> dict:
        """Evaluate a single position for on-demand exploration.

        Returns a dict with:
          eval: float (White's perspective)
          best_move: str (SAN)
          good_moves: list[str] (SAN, within acceptable_drop of best)
          good_moves_with_eval: dict[str, float] (SAN -> eval-diff-from-best)
          mate_in: int | None (signed, White's perspective)
        """
        all_moves, _ = self.evaluate_all_moves(board, acceptable_drop=acceptable_drop, depth=depth)
        if not all_moves:
            return {
                "eval": 0.0,
                "best_move": "",
                "good_moves": [],
                "good_moves_with_eval": {},
                "mate_in": None,
            }

        # Sort by eval descending (side-to-move perspective)
        sorted_moves = sorted(all_moves.items(), key=lambda x: x[1][0], reverse=True)
        best_move_obj, (best_eval, _best_pv, best_mate) = sorted_moves[0]

        # Convert eval to White's perspective
        if board.turn == chess.BLACK:
            white_eval = -best_eval
            white_mate = -best_mate if best_mate is not None else None
        else:
            white_eval = best_eval
            white_mate = best_mate

        best_move_san = board.san(best_move_obj)

        # Filter good moves (within acceptable drop of best, in side-to-move perspective)
        good_moves_san = []
        good_moves_with_eval = {}
        for move_obj, (ev, _pv, _mate) in sorted_moves:
            drop = best_eval - ev
            if drop <= acceptable_drop:
                san = board.san(move_obj)
                good_moves_san.append(san)
                # Eval diff from best, in side-to-move perspective
                good_moves_with_eval[san] = round(-drop, 2)

        return {
            "eval": round(white_eval, 2),
            "best_move": best_move_san,
            "good_moves": good_moves_san,
            "good_moves_with_eval": good_moves_with_eval,
            "mate_in": white_mate,
        }

    def close(self):
        try:
            self.engine.quit()
        except chess.engine.EngineTerminatedError:
            pass
