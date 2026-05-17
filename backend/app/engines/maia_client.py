import asyncio
import re

import chess
import chess.engine


class MaiaClient:
    """Maia human-move-prediction engine using lc0 with Maia weights.

    Wraps lc0 as a UCI engine and extracts raw neural-network policy
    probabilities via VerboseMoveStats.
    """

    def __init__(self, lc0_path: str, weights_path: str, backend: str = "eigen"):
        """Create a MaiaClient (not yet started).

        Use await MaiaClient.create(...) to get a fully initialised instance.
        """
        self._lc0_path = lc0_path
        self._weights_path = weights_path
        self._backend = backend
        self._transport = None
        self._engine: chess.engine.UciProtocol | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._shutting_down = False

    @classmethod
    async def create(cls, lc0_path: str, weights_path: str, backend: str = "eigen") -> "MaiaClient":
        """Async factory: create and start the Maia engine.

        Args:
            lc0_path: Path to the lc0 binary.
            weights_path: Path to the Maia weights file.
            backend: lc0 backend (eigen for CPU, metal for GPU).

        Raises:
            RuntimeError: If lc0 fails to start.
        """
        instance = cls(lc0_path, weights_path, backend)
        instance._loop = asyncio.get_running_loop()
        await instance._start()
        return instance

    async def _start(self):
        self._transport, self._engine = await chess.engine.popen_uci(self._lc0_path)
        await self._engine.configure({
            "Backend": self._backend,
            "WeightsFile": self._weights_path,
            "VerboseMoveStats": True,
        })

    def predict(self, board: chess.Board) -> dict[chess.Move, float]:
        """Return probability distribution over legal moves.

        Uses lc0's VerboseMoveStats to extract per-move policy
        percentages from the neural-network.

        This is called from sync code in worker threads; it schedules
        the coroutine on the main event loop via run_coroutine_threadsafe.
        """
        if self._shutting_down:
            return {}
        future = asyncio.run_coroutine_threadsafe(self._predict_async(board), self._loop)
        try:
            return future.result(timeout=30)
        except (TimeoutError, asyncio.CancelledError):
            return {}

    async def _predict_async(self, board: chess.Board) -> dict[chess.Move, float]:
        move_probs: dict[chess.Move, float] = {}
        pattern = re.compile(r"^(\S+)\s+\(.*P:\s*([\d.]+)%\)")

        analysis = await self._engine.analysis(board, chess.engine.Limit(nodes=1))
        strings: list[str] = []
        with analysis:
            async for info in analysis:
                string = info.get("string")
                if string:
                    strings.append(string)

        for s in strings:
            if not s:
                continue
            m = pattern.match(s.strip())
            if not m:
                continue
            uci_str = m.group(1)
            policy_pct = float(m.group(2))
            try:
                move = chess.Move.from_uci(uci_str)
                move_probs[move] = policy_pct / 100.0
            except ValueError:
                continue

        # Normalize
        total = sum(move_probs.values())
        if total > 0:
            move_probs = {m: p / total for m, p in move_probs.items()}
        return move_probs

    async def close(self):
        """Shut down the lc0 engine process."""
        self._shutting_down = True
        if self._engine is not None:
            try:
                await self._engine.quit()
            except (asyncio.TimeoutError, chess.engine.EngineTerminatedError):
                pass
        if self._transport is not None:
            self._transport.close()
