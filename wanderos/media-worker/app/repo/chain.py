"""Cross-provider failover chain.

Genblaze's built-in ``fallback_models`` swaps the MODEL inside one provider. It
cannot fail over to a DIFFERENT provider, so a provider-wide outage (expired
credits, regional model retirement, a moderation block) kills the step.

ChainProvider closes that gap: one pipeline step, an ordered list of
(provider, model) links, each tried in turn. The step's model is rewritten per
link so the recorded lineage names the model that actually produced the asset.
Every failover is emitted as an event and returned in ``step.metadata`` so the
UI and the provenance record both show the real recovery path, not a clean lie.

This is what makes "multi-provider orchestration" true rather than aspirational:
the traveler's film survives any single vendor going dark.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from genblaze import Step
from genblaze_core.exceptions import ProviderError
from genblaze_core.providers.base import BaseProvider, SyncProvider

from app.runtime.events import emit_job_event


@dataclass(frozen=True)
class Link:
    """One rung of the failover ladder."""

    label: str          # human/provenance name, e.g. "aws-bedrock"
    provider: BaseProvider
    model: str


class ChainProvider(SyncProvider):
    """Tries each link in order; first success wins, all failures are recorded."""

    name = "chain"

    def __init__(self, links: list[Link], *, job_id: str = "", kind: str = "asset") -> None:
        super().__init__()
        if not links:
            raise ValueError("ChainProvider requires at least one link")
        self.links = links
        self.job_id = job_id
        self.kind = kind

    @property
    def labels(self) -> list[str]:
        return [f"{link.label}:{link.model}" for link in self.links]

    def generate(self, step: Step, config: Any = None) -> Step:
        failures: list[dict[str, str]] = []
        for position, link in enumerate(self.links):
            step.model = link.model  # lineage must name the model that really ran
            try:
                result = self._invoke(link.provider, step, config)
            except Exception as exc:
                detail = f"{type(exc).__name__}: {exc}"[:300]
                failures.append({"provider": link.label, "model": link.model, "error": detail})
                emit_job_event(self.job_id, "provider.failover", {
                    "kind": self.kind, "failed": link.label, "model": link.model,
                    "error": detail,
                    "next": self.links[position + 1].label if position + 1 < len(self.links) else None,
                })
                continue

            if failures:
                result.metadata = {**(result.metadata or {}), "failover": failures,
                                   "served_by": link.label}
                emit_job_event(self.job_id, "provider.recovered", {
                    "kind": self.kind, "served_by": link.label, "model": link.model,
                    "after_failures": len(failures),
                })
            return result

        raise ProviderError(
            f"all {len(self.links)} providers failed for {self.kind}: "
            + " | ".join(f"{f['provider']}({f['model']}): {f['error'][:90]}" for f in failures)
        )

    @staticmethod
    def _invoke(provider: BaseProvider, step: Step, config: Any) -> Step:
        """Run one link. SyncProviders expose generate(); async ones use the
        submit/poll/fetch lifecycle, so drive whichever the link implements."""
        if isinstance(provider, SyncProvider):
            return provider.generate(step, config)
        import time

        prediction = provider.submit(step, config)
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if provider.poll(prediction, config):
                return provider.fetch_output(prediction, step)
            time.sleep(getattr(provider, "poll_interval", 5) or 5)
        raise ProviderError(f"{getattr(provider, 'name', 'provider')} timed out after 600s")
