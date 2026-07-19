"""Compare probability-bounded CTI with all-legal-root Stockfish analysis.

This is an informational benchmark, not a wall-clock test gate. Run from the
backend directory with ``pipenv run python scripts/benchmark_cti.py``.
"""

import argparse
import asyncio
import json
from pathlib import Path
import sys
import time

import chess

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.metrics import compute_cti
from app.config import DEFAULT_MAIA3_ELO, MAIA3_CHECKPOINT_PATH, settings
from app.engines.maia3_client import Maia3Client
from app.engines.stockfish_client import StockfishClient


SAMPLE_LINE = (
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 "
    "c1e3 e7e5 d4b3 c8e6 f2f3 f8e7 d1d2 e8g8 e1c1"
).split()
SAMPLE_PLIES = {0, 8, 16, 19}


def sample_positions():
    board = chess.Board()
    history = [board.fen()]
    for ply in range(len(SAMPLE_LINE) + 1):
        if ply in SAMPLE_PLIES:
            yield ply, board.copy(), tuple(history)
        if ply < len(SAMPLE_LINE):
            board.push_uci(SAMPLE_LINE[ply])
            history.append(board.fen())


def new_stockfish(path: str, depth: int):
    return StockfishClient(path, depth=depth, threads=1, hash_mb=64)


async def run(args):
    maia = await Maia3Client.create(args.checkpoint)
    rows = []
    try:
        for ply, board, history in sample_positions():
            optimized_engine = new_stockfish(args.stockfish, args.depth)
            root_counts = []
            original = optimized_engine.evaluate_root_moves

            def counted(board_arg, roots, depth=None):
                root_counts.append(len(set(roots)))
                return original(board_arg, roots, depth)

            optimized_engine.evaluate_root_moves = counted
            started = time.perf_counter()
            optimized = compute_cti(
                board,
                optimized_engine,
                maia,
                full_depth=args.depth,
                maia3_white_elo=args.elo,
                maia3_black_elo=args.elo,
                history_fens=history,
                minefield_threshold=args.minefield_threshold,
            )
            optimized_seconds = time.perf_counter() - started
            optimized_root_calls = list(root_counts)

            tail_moves = [move for move in board.legal_moves if move not in optimized.all_evals]
            started = time.perf_counter()
            tail = original(board, tail_moves, args.depth)
            completion_seconds = time.perf_counter() - started
            completed_values = dict(optimized.all_evals)
            completed_values.update({move: data[0] for move, data in tail.items()})
            completed_good = [
                move
                for move, value in completed_values.items()
                if optimized.best_eval - value <= 0.5
            ]
            completed_cti = 1.0 - sum(
                optimized.maia_policy.get(move, 0.0) for move in completed_good
            )
            optimized_engine.close()

            full_engine = new_stockfish(args.stockfish, args.depth)
            started = time.perf_counter()
            full = full_engine.evaluate_root_moves(board, list(board.legal_moves), args.depth)
            full_seconds = time.perf_counter() - started
            full_engine.close()

            values = {move: data[0] for move, data in full.items()}
            best_eval = max(values.values())
            good_moves = [move for move, value in values.items() if best_eval - value <= 0.5]
            independent_cti = 1.0 - sum(
                optimized.maia_policy.get(move, 0.0) for move in good_moves
            )
            completed_minefield = completed_cti >= args.minefield_threshold
            independent_minefield = independent_cti >= args.minefield_threshold
            optimized_minefield = optimized.cti_lower_bound >= args.minefield_threshold

            rows.append({
                "ply": ply,
                "legal_roots": board.legal_moves.count(),
                "evaluated_root_calls": optimized_root_calls,
                "tail_roots": len(tail_moves),
                "optimized_seconds": round(optimized_seconds, 4),
                "tail_completion_seconds": round(completion_seconds, 4),
                "full_seconds": round(full_seconds, 4),
                "speedup": round(full_seconds / optimized_seconds, 2),
                "optimized_cti": round(optimized.cti, 6),
                "cti_lower_bound": round(optimized.cti_lower_bound, 6),
                "cti_upper_bound": round(optimized.cti_upper_bound, 6),
                "completed_tail_cti": round(completed_cti, 6),
                "completed_tail_inside_bounds": (
                    optimized.cti_lower_bound <= completed_cti <= optimized.cti_upper_bound
                ),
                "independent_full_cti": round(independent_cti, 6),
                "independent_stockfish_delta": round(independent_cti - completed_cti, 6),
                "completed_minefield_agrees": optimized_minefield == completed_minefield,
                "independent_minefield_agrees": optimized_minefield == independent_minefield,
            })
    finally:
        await maia.close()
    print(json.dumps(rows, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stockfish", default=settings.stockfish_path)
    parser.add_argument("--checkpoint", default=MAIA3_CHECKPOINT_PATH)
    parser.add_argument("--depth", type=int, default=12)
    parser.add_argument("--elo", type=int, default=DEFAULT_MAIA3_ELO)
    parser.add_argument("--minefield-threshold", type=float, default=0.8)
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
