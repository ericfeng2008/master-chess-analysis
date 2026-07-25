"""Background analysis jobs and broadcast queues for SSE clients."""

from __future__ import annotations

import queue
import threading
from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable


JobEvent = dict[str, Any]
DONE = object()


@dataclass
class AnalysisJob:
    key: str
    _subscribers: set[queue.Queue] = field(default_factory=set)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    latest: JobEvent | None = None
    done: bool = False

    def publish(self, event: JobEvent) -> None:
        with self._lock:
            self.latest = event
            if event.get("type") in {"complete", "error"}:
                self.done = True
            subscribers = tuple(self._subscribers)
            for subscriber in subscribers:
                subscriber.put(event)
                if self.done:
                    subscriber.put(DONE)

    def subscribe(self) -> tuple[queue.Queue, Callable[[], None]]:
        subscriber: queue.Queue = queue.Queue()
        with self._lock:
            self._subscribers.add(subscriber)
            if self.latest is not None:
                subscriber.put(self.latest)
            if self.done:
                subscriber.put(DONE)

        def unsubscribe() -> None:
            with self._lock:
                self._subscribers.discard(subscriber)

        return subscriber, unsubscribe


class AnalysisJobManager:
    """Owns worker threads so an SSE disconnect cannot cancel Stockfish."""

    def __init__(self, max_workers: int = 1):
        self._executor: Executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="analysis-worker"
        )
        self._jobs: dict[str, AnalysisJob] = {}
        self._lock = threading.Lock()

    def get_or_start(
        self, key: str, target_factory: Callable[[AnalysisJob], None]
    ) -> AnalysisJob:
        with self._lock:
            existing = self._jobs.get(key)
            if existing is not None:
                if not existing.done:
                    return existing
                # Completed work is durable (or deliberately in-memory when
                # persistence is unavailable), so do not retain large result
                # payloads in the manager. A subsequent request can use the
                # database cache or start a fresh attempt from its checkpoint.
                self._jobs.pop(key, None)
            job = AnalysisJob(key)
            self._jobs[key] = job

            def run() -> None:
                try:
                    target_factory(job)
                except BaseException as exc:  # publish errors to all subscribers
                    job.publish(
                        {
                            "type": "error",
                            "message": str(exc) or type(exc).__name__,
                            "error_type": type(exc).__name__,
                        }
                    )

            self._executor.submit(run)
            return job

    def shutdown(self) -> None:
        # Let an in-flight UCI command finish before the shared engine is
        # closed by the application lifespan.
        self._executor.shutdown(wait=True, cancel_futures=False)
