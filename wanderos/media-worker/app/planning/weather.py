"""Real weather and geocoding, via Open-Meteo (free, no API key, CC-BY 4.0).

Packing lists, itinerary risk and destination matching were all taking
temperatures as *inputs* — which meant the caller had to already know the
answer, and in practice meant a hardcoded guess. This fetches it.

**The distinction that makes this honest:** a forecast and a climate estimate
are not the same claim, and most travel tools blur them. Weather models have
useful skill for roughly two weeks. A trip in five months cannot be forecast at
all — so for those we return what the weather actually *did* on those dates in
previous years, labelled `climate_estimate`, never `forecast`.

Presenting a climate average as a forecast is the same category of error as
generating a memory and presenting it as a photograph: it is a plausible number
in the place where a real one should be. Every result here carries its `kind`
and the caller is expected to say which it is.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from statistics import mean

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Beyond this, a forecast carries no useful skill and we switch to history.
FORECAST_HORIZON_DAYS = 14
# Years of history averaged for a climate estimate. More would be better; three
# keeps the request small and is enough to not be dominated by one odd year.
CLIMATE_YEARS = 3
ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"


@dataclass
class Place:
    name: str
    country_code: str
    latitude: float
    longitude: float
    timezone: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class WeatherWindow:
    kind: str                      # forecast | climate_estimate | unavailable
    min_temp_c: float | None = None
    max_temp_c: float | None = None
    rain_expected: bool = False
    total_rain_mm: float = 0.0
    wet_days: int = 0
    days: int = 0
    basis: str = ""
    attribution: str = ATTRIBUTION
    daily: list[dict] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.min_temp_c is not None

    def as_dict(self) -> dict:
        return {**self.__dict__, "usable": self.usable}


def _get(url: str, params: dict, timeout: int = 30, attempts: int = 3) -> dict | None:
    """GET with a real User-Agent and a short retry.

    A bare urllib request sends "Python-urllib/3.x", which this host answers
    slowly enough to time out even though the same call over curl returns
    immediately. Identifying the client fixes it.
    """
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "WanderOS/1.0 (travel planning; +https://wanderos.app)",
                 "Accept": "application/json"},
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except Exception as exc:
            if attempt == attempts - 1:
                logger.warning("open-meteo request failed (%s): %s", url, exc)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


@lru_cache(maxsize=256)
def geocode(name: str) -> Place | None:
    """Resolve a place name to coordinates. Cached — place names do not move."""
    payload = _get(GEOCODE_URL, {"name": name, "count": 1})
    results = (payload or {}).get("results") or []
    if not results:
        return None
    top = results[0]
    return Place(name=top.get("name", name), country_code=top.get("country_code", ""),
                 latitude=top["latitude"], longitude=top["longitude"],
                 timezone=top.get("timezone", ""))


DAILY_FIELDS = "temperature_2m_max,temperature_2m_min,precipitation_sum"


def _summarise(daily: dict, *, kind: str, basis: str) -> WeatherWindow:
    lows = [v for v in (daily.get("temperature_2m_min") or []) if v is not None]
    highs = [v for v in (daily.get("temperature_2m_max") or []) if v is not None]
    rain = [v for v in (daily.get("precipitation_sum") or []) if v is not None]
    if not lows or not highs:
        return WeatherWindow(kind="unavailable", basis=basis)

    wet_days = sum(1 for v in rain if v >= 1.0)
    return WeatherWindow(
        kind=kind,
        # Min of the lows and max of the highs, not averages: you pack for the
        # coldest morning and the hottest afternoon, not the mean day.
        min_temp_c=round(min(lows), 1),
        max_temp_c=round(max(highs), 1),
        total_rain_mm=round(sum(rain), 1),
        wet_days=wet_days,
        # "Rain expected" means enough days to need a jacket, not a single
        # 0.2mm blip that would otherwise trigger it on almost every trip.
        rain_expected=wet_days >= max(1, len(rain) // 4),
        days=len(lows),
        basis=basis,
        daily=[{"date": d, "min": lo, "max": hi, "rain_mm": r}
               for d, lo, hi, r in zip(daily.get("time", []), lows, highs, rain)],
    )


def forecast(place: Place, start: date, end: date) -> WeatherWindow:
    payload = _get(FORECAST_URL, {
        "latitude": place.latitude, "longitude": place.longitude,
        "daily": DAILY_FIELDS, "timezone": "auto",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
    })
    if not payload or "daily" not in payload:
        return WeatherWindow(kind="unavailable", basis="forecast request failed")
    return _summarise(payload["daily"], kind="forecast",
                      basis=f"Open-Meteo forecast for {start} to {end}")


def climate_estimate(place: Place, start: date, end: date,
                     *, years: int = CLIMATE_YEARS) -> WeatherWindow:
    """What the weather actually did on these dates in recent years.

    Explicitly NOT a forecast. Returned when the trip is beyond forecast range,
    labelled so no caller can mistake it for one.
    """
    lows, highs, rains, sampled = [], [], [], []
    for offset in range(1, years + 1):
        try:
            past_start = start.replace(year=start.year - offset)
            past_end = end.replace(year=end.year - offset)
        except ValueError:  # 29 Feb in a non-leap year
            past_start = start.replace(year=start.year - offset, day=28)
            past_end = end.replace(year=end.year - offset, day=28)
        payload = _get(ARCHIVE_URL, {
            "latitude": place.latitude, "longitude": place.longitude,
            "daily": DAILY_FIELDS, "timezone": "auto",
            "start_date": past_start.isoformat(), "end_date": past_end.isoformat(),
        }, timeout=45)
        daily = (payload or {}).get("daily") or {}
        lows += [v for v in (daily.get("temperature_2m_min") or []) if v is not None]
        highs += [v for v in (daily.get("temperature_2m_max") or []) if v is not None]
        rains += [v for v in (daily.get("precipitation_sum") or []) if v is not None]
        if daily.get("time"):
            sampled.append(str(past_start.year))

    if not lows:
        return WeatherWindow(kind="unavailable", basis="no historical data available")

    wet_days = sum(1 for v in rains if v >= 1.0)
    span = (end - start).days + 1
    return WeatherWindow(
        kind="climate_estimate",
        # Averaged across years, so one freak year does not set the packing list.
        min_temp_c=round(mean(sorted(lows)[:max(1, len(lows) // 5)]), 1),
        max_temp_c=round(mean(sorted(highs)[-max(1, len(highs) // 5):]), 1),
        total_rain_mm=round(sum(rains) / max(1, len(sampled)), 1),
        wet_days=round(wet_days / max(1, len(sampled))),
        rain_expected=(wet_days / max(1, len(sampled))) >= max(1, span // 4),
        days=span,
        basis=f"typical weather on these dates in {', '.join(sampled) or 'recent years'} "
              f"— NOT a forecast",
    )


def for_trip(destination: str, start: date, end: date,
             *, today: date | None = None) -> tuple[Place | None, WeatherWindow]:
    """Resolve a destination and get the best available weather for the dates.

    Picks forecast or climate estimate automatically by how far out the trip is,
    so callers never have to know the horizon rule.
    """
    today = today or date.today()
    place = geocode(destination)
    if place is None:
        return None, WeatherWindow(kind="unavailable",
                                   basis=f"could not resolve '{destination}'")
    if (start - today).days <= FORECAST_HORIZON_DAYS:
        window = forecast(place, max(start, today), end)
        if window.usable:
            return place, window
        # Fall through rather than return nothing — a climate estimate labelled
        # as one beats no weather at all.
    return place, climate_estimate(place, start, end)
