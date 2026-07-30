"""What this deployment can actually do, right now.

Every optional dependency in this codebase is wrapped in try/except so a missing
library degrades one feature instead of killing the worker. That resilience is
correct, and it is also how a real bug hid: `scenedetect` was declared in
requirements.txt and present in one interpreter but not in the one under test,
so shot detection quietly returned a single shot per clip instead of several,
and the test still passed.

Silent degradation is only safe when someone can see it. This reports the truth
about the running process — not what requirements.txt claims — so a startup log
and a health endpoint can both say plainly which features are live.
"""
from __future__ import annotations

import importlib
import shutil
import subprocess
from dataclasses import dataclass


@dataclass
class Capability:
    name: str
    available: bool
    detail: str = ""
    degrades_to: str = ""

    def as_dict(self) -> dict:
        return {"name": self.name, "available": self.available,
                "detail": self.detail, "degrades_to": self.degrades_to}


def _module(name: str) -> tuple[bool, str]:
    try:
        mod = importlib.import_module(name)
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    return True, getattr(mod, "__version__", "") or "installed"


def _binary(name: str, args: list[str]) -> tuple[bool, str]:
    if shutil.which(name) is None:
        return False, "not on PATH"
    try:
        out = subprocess.run([name, *args], capture_output=True, text=True,
                             timeout=15, check=True)
        return True, (out.stdout or out.stderr).splitlines()[0][:80]
    except Exception as exc:
        return False, f"{type(exc).__name__}"


# Each entry names the feature that dies, not just the import that fails — the
# point is to tell a human what the traveller loses.
_MODULES = [
    ("shot-detection", "scenedetect",
     "video clips split into shots", "one shot per clip"),
    ("exif-full", "exifread",
     "GPS sub-IFD and maker-note timestamps", "Pillow's weaker EXIF parser"),
    ("heic", "pillow_heif",
     "reads iPhone HEIC photos", "iPhone photos lose date and location"),
    ("gps-scrub", "piexif",
     "physically strips GPS before sharing", "PUBLISHING IS BLOCKED (fails closed)"),
    ("documents", "pypdf", "reads itinerary PDFs", "no document evidence"),
    ("storage", "boto3", "B2 and AWS access", "nothing works"),
]


def snapshot() -> dict:
    caps: list[Capability] = []

    for name, module, detail, degraded in _MODULES:
        ok, info = _module(module)
        caps.append(Capability(name=name, available=ok,
                               detail=f"{detail} ({module} {info})" if ok else f"{module}: {info}",
                               degrades_to="" if ok else degraded))

    for name, binary, args, detail, degraded in [
        ("compose", "ffmpeg", ["-version"], "assembles the film", "no film at all"),
        ("probe", "ffprobe", ["-version"], "reads media duration", "scene timing guessed"),
    ]:
        ok, info = _binary(binary, args)
        caps.append(Capability(name=name, available=ok,
                               detail=info if ok else f"{binary}: {info}",
                               degrades_to="" if ok else degraded))

    missing = [c for c in caps if not c.available]
    return {
        "healthy": not missing,
        "capabilities": [c.as_dict() for c in caps],
        "degraded": [c.name for c in missing],
        # Loud on purpose: a deployment missing gps-scrub must not publish.
        "blocking": [c.name for c in missing if "BLOCKED" in c.degrades_to],
    }


def log_startup_report(logger) -> dict:
    """Log one line per degraded capability at startup. A worker that boots
    clean logs nothing, so any line here is worth reading."""
    report = snapshot()
    for cap in report["capabilities"]:
        if not cap["available"]:
            logger.warning("capability unavailable: %s — %s (degrades to: %s)",
                           cap["name"], cap["detail"], cap["degrades_to"])
    if report["healthy"]:
        logger.info("all %d capabilities available", len(report["capabilities"]))
    return report
