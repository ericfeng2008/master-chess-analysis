import asyncio
import threading
from argparse import Namespace
from collections import deque
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import chess

from app.config import DEFAULT_MAIA3_ELO


class Maia3Client:
    """Maia3 human-move predictor using direct model inference."""

    def __init__(
        self,
        checkpoint_path: str,
        model_name: str = "maia3-79m",
        device: str = "cpu",
        use_history: bool = True,
        default_elo: int = DEFAULT_MAIA3_ELO,
    ):
        self.checkpoint_path = Path(checkpoint_path)
        self.model_name = model_name
        self.device = device
        self.use_history = use_history
        self.default_elo = default_elo

        self._model: Any | None = None
        self._cfg: Namespace | None = None
        self._torch: Any | None = None
        self._tokenize_board = None
        self._get_historical_tokens = None
        self._get_legal_moves_mask = None
        self._mirror_move = None
        self._all_moves_dict: dict[str, int] = {}
        self._idx_to_move: dict[int, str] = {}
        self._lock = threading.RLock()
        self._closed = False

    @classmethod
    async def create(
        cls,
        checkpoint_path: str,
        model_name: str = "maia3-79m",
        device: str = "cpu",
        use_history: bool = True,
        default_elo: int = DEFAULT_MAIA3_ELO,
    ) -> "Maia3Client":
        instance = cls(
            checkpoint_path=checkpoint_path,
            model_name=model_name,
            device=device,
            use_history=use_history,
            default_elo=default_elo,
        )
        await asyncio.to_thread(instance._start)
        return instance

    def _start(self) -> None:
        if not self.checkpoint_path.exists():
            raise RuntimeError(
                "Maia3 checkpoint not found at "
                f"{self.checkpoint_path}. Download maia3-79m.pt from "
                "https://huggingface.co/UofTCSSLab/Maia3-79M and place it at "
                "backend/model/maia3-79m.pt."
            )

        try:
            import torch
            from maia3.dataset import (
                get_historical_tokens,
                get_legal_moves_mask,
                tokenize_board,
            )
            from maia3.model_registry import apply_model_config, resolve_model_spec
            from maia3.uci import load_model
            from maia3.utils import get_all_possible_moves, mirror_move
        except ImportError as exc:
            raise RuntimeError(
                "Maia3 dependencies are not installed. Install backend dependencies "
                "from backend/Pipfile before starting the backend."
            ) from exc

        cfg = Namespace(
            checkpoint_path=str(self.checkpoint_path),
            device=self.device,
            trust_checkpoint=False,
            use_amp=False,
        )
        spec = resolve_model_spec(self.model_name)
        apply_model_config(cfg, spec)
        cfg.model_spec = spec

        model = load_model(cfg)

        all_moves = get_all_possible_moves()
        self._model = model
        self._cfg = cfg
        self._torch = torch
        self._tokenize_board = tokenize_board
        self._get_historical_tokens = get_historical_tokens
        self._get_legal_moves_mask = get_legal_moves_mask
        self._mirror_move = mirror_move
        self._all_moves_dict = {move: idx for idx, move in enumerate(all_moves)}
        self._idx_to_move = {idx: move for move, idx in self._all_moves_dict.items()}

    def predict(
        self,
        board: chess.Board,
        elo: int | None = None,
        self_elo: int | None = None,
        opponent_elo: int | None = None,
        history_fens: Sequence[str] | None = None,
    ) -> dict[chess.Move, float]:
        """Return a normalized probability distribution over legal moves."""
        if self._closed or board.is_game_over():
            return {}
        with self._lock:
            if self._model is None or self._cfg is None:
                return {}
            default_elo = self.default_elo if elo is None else int(elo)
            side_to_move_elo = default_elo if self_elo is None else int(self_elo)
            other_side_elo = default_elo if opponent_elo is None else int(opponent_elo)
            return self._predict_locked(
                board.copy(stack=False),
                side_to_move_elo,
                other_side_elo,
                history_fens,
            )

    def _predict_locked(
        self,
        board: chess.Board,
        self_elo: int,
        opponent_elo: int,
        history_fens: Sequence[str] | None,
    ) -> dict[chess.Move, float]:
        torch = self._torch
        legal_mask = self._get_legal_moves_mask(board, self._all_moves_dict)
        if not bool(legal_mask.any()):
            return {}

        history = self._build_history(board, history_fens)
        tokens = self._get_historical_tokens(
            history,
            self._cfg,
            base=0.0,
            inc=0.0,
            clk_left_before=0.0,
            clk_ponder=0.0,
        )
        tokens = tokens.unsqueeze(0).to(self.device)
        self_elos = torch.tensor([self_elo], dtype=torch.long, device=self.device)
        oppo_elos = torch.tensor([opponent_elo], dtype=torch.long, device=self.device)

        with torch.no_grad():
            logits_move, _logits_value, _ = self._model(tokens, self_elos, oppo_elos)
            logits = logits_move[0].float()
            mask = legal_mask.to(self.device)
            logits = logits.masked_fill(~mask, float("-inf"))
            probs = torch.softmax(logits, dim=-1)

        move_probs: dict[chess.Move, float] = {}
        legal_indices = torch.nonzero(mask, as_tuple=False).flatten().tolist()
        for idx in legal_indices:
            move = self._move_from_index(int(idx), board)
            if move is None:
                continue
            prob = float(probs[int(idx)].item())
            if prob > 0.0:
                move_probs[move] = prob

        total = sum(move_probs.values())
        if total > 0.0:
            return {move: prob / total for move, prob in move_probs.items()}
        return {}

    def _build_history(
        self,
        board: chess.Board,
        history_fens: Sequence[str] | None,
    ):
        history = deque(maxlen=self._cfg.history)

        if self.use_history and history_fens:
            for fen in history_fens[-self._cfg.history:]:
                try:
                    history.append(self._tokenize_board(chess.Board(fen)))
                except ValueError:
                    continue

        if not self.use_history:
            history.clear()

        if not history:
            history.append(self._tokenize_board(board))
        elif not history_fens or history_fens[-1] != board.fen():
            history.append(self._tokenize_board(board))

        return history

    def _move_from_index(self, idx: int, board: chess.Board) -> chess.Move | None:
        move_uci = self._idx_to_move.get(idx)
        if move_uci is None:
            return None
        if board.turn == chess.BLACK:
            move_uci = self._mirror_move(move_uci)
        try:
            move = chess.Move.from_uci(move_uci)
        except ValueError:
            return None
        return move if move in board.legal_moves else None

    async def close(self) -> None:
        self._closed = True
        with self._lock:
            self._model = None
