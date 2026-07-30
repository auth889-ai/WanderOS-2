"""Shared fixtures.

Tests here are deliberately OFFLINE by default. A suite that needs B2, Bedrock
and OSRM to be reachable is a suite nobody runs, and the bugs this project keeps
hitting are logic bugs — a swallowed exception, a date measured from the wrong
end, a gate checking one provider instead of all of them. Those are all testable
without a network.

Run the handful of network tests explicitly:  pytest -m network
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def pytest_collection_modifyitems(config, items):
    if config.getoption("-m"):
        return
    skip = pytest.mark.skip(reason="needs network; run with -m network")
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)
