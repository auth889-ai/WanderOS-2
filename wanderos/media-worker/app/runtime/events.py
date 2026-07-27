"""SSETracer — publishes every pipeline step event to Redis pub/sub.

Channel: job:{job_id}:events. The Node worker relays these into the existing
wanderos SSE stream routes, so the Live Pipeline View renders real engine events.
Falls back to a local ring buffer when Redis is absent (tests/CI).

Hook signatures verified against genblaze.Tracer (v0.4.4).
"""
from __future__ import annotations

import json
import time
from collections import deque
from typing import Any

from genblaze import Tracer

try:
    import redis as _redis
except ImportError:  # pragma: no cover
    _redis = None

from app.config.settings import settings

_local_buffer: dict[str, deque] = {}


class SSETracer(Tracer):
    def __init__(self, job_id: str):
        self.job_id = job_id
        self._client = None
        if _redis is not None:
            try:
                self._client = _redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1)
                self._client.ping()
            except Exception:
                self._client = None

    def _emit(self, event: str, payload: dict[str, Any]) -> None:
        message = json.dumps({"event": event, "ts": time.time(), **payload}, default=str)
        if self._client is not None:
            try:
                self._client.publish(f"job:{self.job_id}:events", message)
                return
            except Exception:
                pass
        _local_buffer.setdefault(self.job_id, deque(maxlen=200)).append(message)

    # --- genblaze.Tracer interface ---

    def on_run_start(self, run_id, name, *, tenant_id=None, total_steps=None, metadata=None) -> None:
        self._emit("run.started", {"run_id": run_id, "name": name, "total_steps": total_steps})

    def on_run_end(self, run_id, result) -> None:
        status = str(getattr(getattr(result, "run", result), "status", ""))
        self._emit("run.completed", {"run_id": run_id, "status": status})

    def on_step_start(self, run_id, step, *, step_index, total_steps) -> None:
        self._emit(
            "step.started",
            {
                "run_id": run_id,
                "step_index": step_index,
                "total_steps": total_steps,
                "provider": str(getattr(step, "provider", "")),
                "model": getattr(step, "model", None),
            },
        )

    def on_step_end(self, run_id, step, *, duration_ms, step_index) -> None:
        self._emit(
            "step.completed",
            {
                "run_id": run_id,
                "step_index": step_index,
                "model": getattr(step, "model", None),
                "status": str(getattr(step, "status", "")),
                "duration_ms": duration_ms,
            },
        )

    def on_event(self, event) -> None:
        # StreamEvents carry retry/fallback detail — forward the interesting ones.
        etype = str(getattr(event, "type", "") or getattr(event, "event", ""))
        if any(k in etype for k in ("retry", "fallback", "fail", "error")):
            self._emit("step.event", {"type": etype, "detail": str(event)[:500]})


def drain_local_events(job_id: str) -> list[str]:
    """Test/polling helper — returns and clears buffered events for a job."""
    buf = _local_buffer.pop(job_id, None)
    return list(buf) if buf else []
