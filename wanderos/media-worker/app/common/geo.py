"""Geographic maths shared across domains.

`evidence/timeline.py` needs great-circle distance to split moments when a
traveller jumps location; `rights/passenger_rights.py` needs it because EC261
compensation bands are defined by great-circle distance between departure and
final destination. One formula, one home — the alternative is the duplicate
ffprobe helper problem again.
"""
from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in kilometres.

    EC261 Article 7 measures "great circle distance", so this is the legally
    correct metric for the compensation bands — not driving distance and not the
    actual routing the aircraft flew.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))
