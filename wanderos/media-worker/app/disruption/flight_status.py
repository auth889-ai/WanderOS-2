"""Live flight status — the one place that talks to a flight data provider.

Everything downstream (disruption recovery, baggage tracking, entitlement
assessment) works on a `FlightStatus`, never on a provider's JSON. That means a
traveller who types their flight details in by hand gets identical behaviour to
one whose flight was looked up automatically — which matters because the free
AviationStack tier allows 100 requests a month and will run out mid-demo.

A live lookup is therefore a convenience, never a dependency. `from_manual()`
exists so the entire crisis feature set is usable with no API key at all.
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime

from app.config.settings import settings

logger = logging.getLogger(__name__)

AVIATIONSTACK_URL = "https://api.aviationstack.com/v1/flights"

# Provider status strings -> ours. Anything unrecognised becomes "unknown"
# rather than being guessed at, because "scheduled" and "cancelled" are not
# things to be approximately right about.
STATUS_MAP = {
    "scheduled": "scheduled", "active": "in_air", "landed": "landed",
    "cancelled": "cancelled", "incident": "incident", "diverted": "diverted",
}


@dataclass
class FlightStatus:
    flight_iata: str
    departure_airport: str = ""
    arrival_airport: str = ""
    departure_country: str = ""
    arrival_country: str = ""
    carrier_country: str = ""
    scheduled_arrival: datetime | None = None
    actual_arrival: datetime | None = None
    scheduled_departure: datetime | None = None
    actual_departure: datetime | None = None
    status: str = "unknown"
    delay_minutes: int | None = None
    gate: str = ""
    terminal: str = ""
    baggage_belt: str = ""
    source: str = "manual"

    def delay_hours(self) -> float:
        if self.delay_minutes is not None:
            return round(self.delay_minutes / 60, 2)
        if self.scheduled_arrival and self.actual_arrival:
            return round(max(0.0, (self.actual_arrival - self.scheduled_arrival)
                             .total_seconds() / 3600), 2)
        return 0.0

    def is_disrupted(self, *, threshold_hours: float = 2.0) -> bool:
        return self.status in ("cancelled", "diverted", "incident") or \
            self.delay_hours() >= threshold_hours

    def as_dict(self) -> dict:
        return {**self.__dict__,
                "scheduled_arrival": self.scheduled_arrival.isoformat() if self.scheduled_arrival else None,
                "actual_arrival": self.actual_arrival.isoformat() if self.actual_arrival else None,
                "scheduled_departure": self.scheduled_departure.isoformat() if self.scheduled_departure else None,
                "actual_departure": self.actual_departure.isoformat() if self.actual_departure else None,
                "delay_hours": self.delay_hours(),
                "disrupted": self.is_disrupted()}


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def from_manual(**kwargs) -> FlightStatus:
    """Build a status from details the traveller typed in.

    The whole crisis feature set runs on this when no key is configured, so it
    is a first-class path, not a test fixture.
    """
    return FlightStatus(source="manual", **kwargs)


def lookup(flight_iata: str, *, flight_date: str | None = None) -> FlightStatus | None:
    """Fetch live status. Returns None when unavailable — never raises.

    A missing key, an exhausted quota and a provider outage are all the same
    thing to the caller: no live data, fall back to what the traveller told us.
    """
    if not settings.aviationstack_api_key:
        logger.info("no AVIATIONSTACK_API_KEY; flight status must be entered manually")
        return None

    params = {"access_key": settings.aviationstack_api_key,
              "flight_iata": flight_iata, "limit": 1}
    if flight_date:
        params["flight_date"] = flight_date

    try:
        url = f"{AVIATIONSTACK_URL}?{urllib.parse.urlencode(params)}"
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.load(response)
    except Exception as exc:
        logger.warning("flight lookup failed for %s: %s", flight_iata, exc)
        return None

    if "error" in payload:
        # Quota exhaustion arrives here, and it is expected on a free tier —
        # logged plainly so it is never mistaken for "the flight is fine".
        logger.warning("flight provider error for %s: %s", flight_iata, payload["error"])
        return None

    rows = payload.get("data") or []
    if not rows:
        return None
    row = rows[0]
    departure, arrival = row.get("departure") or {}, row.get("arrival") or {}

    return FlightStatus(
        flight_iata=(row.get("flight") or {}).get("iata") or flight_iata,
        departure_airport=departure.get("iata") or "",
        arrival_airport=arrival.get("iata") or "",
        scheduled_departure=_parse_dt(departure.get("scheduled")),
        actual_departure=_parse_dt(departure.get("actual")),
        scheduled_arrival=_parse_dt(arrival.get("scheduled")),
        actual_arrival=_parse_dt(arrival.get("actual")),
        status=STATUS_MAP.get(row.get("flight_status") or "", "unknown"),
        delay_minutes=arrival.get("delay"),
        gate=arrival.get("gate") or "",
        terminal=arrival.get("terminal") or "",
        baggage_belt=arrival.get("baggage") or "",
        source="aviationstack",
    )
