"""Cross-app export — getting the trip OUT of this product and into the phone.

A travel tool that only works inside its own app has already lost. On the day,
people live in their calendar, their wallet, their maps app and their messages —
not in a trip planner. The most useful thing this system can do is put what it
knows where the traveller already looks.

Everything here uses **open formats that need no API key and no partnership**:

    .ics    RFC 5545. Every calendar on every platform reads it.
    .pkpass Apple Wallet's format — and Google Wallet now reads it too, so one
            file serves both.
    deep links  Universal URL schemes into maps, mail and messages.

**On .pkpass signing, stated plainly:** a pass must be signed with an Apple
developer certificate or Wallet silently refuses to install it. We build a
structurally valid, unsigned bundle and say so, rather than shipping something
that looks finished and fails on a phone. Same call as the C2PA credential:
getting the certificate is procurement, not engineering.

The calendar path has no such caveat. It works today, everywhere.
"""
from __future__ import annotations

import hashlib
import json
import urllib.parse
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from app.journey import twin as T

# RFC 5545 wants CRLF and folded lines at 75 octets. Calendars are forgiving
# about the folding and unforgiving about the line endings.
CRLF = "\r\n"
PRODID = "-//WanderOS//Travel Autopilot//EN"


@dataclass
class Event:
    summary: str
    start: datetime
    end: datetime | None = None
    location: str = ""
    description: str = ""
    alarm_minutes: int | None = None      # a reminder before it starts

    def uid(self, trip_id: str) -> str:
        seed = f"{trip_id}|{self.summary}|{self.start.isoformat()}"
        return f"{hashlib.sha256(seed.encode()).hexdigest()[:24]}@wanderos"


def _escape(text: str) -> str:
    """RFC 5545 escaping. An unescaped comma silently truncates a field."""
    return (str(text).replace("\\", "\\\\").replace(";", r"\;")
            .replace(",", r"\,").replace("\n", r"\n"))


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y%m%dT%H%M%S")


def _fold(line: str) -> str:
    """Long lines must be folded, or strict parsers reject the whole file."""
    if len(line) <= 75:
        return line
    head, rest = line[:75], line[75:]
    chunks = [rest[i:i + 74] for i in range(0, len(rest), 74)]
    return head + CRLF + CRLF.join(" " + c for c in chunks)


def to_ics(events: list[Event], *, trip_id: str, name: str = "Trip") -> str:
    """A calendar file every platform reads."""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:{PRODID}",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             f"X-WR-CALNAME:{_escape(name)}"]
    now = datetime.now(timezone.utc)

    for event in events:
        end = event.end or (event.start + timedelta(hours=1))
        lines += [
            "BEGIN:VEVENT",
            f"UID:{event.uid(trip_id)}",
            f"DTSTAMP:{_stamp(now)}Z",
            f"DTSTART:{_stamp(event.start)}",
            f"DTEND:{_stamp(end)}",
            _fold(f"SUMMARY:{_escape(event.summary)}"),
        ]
        if event.location:
            lines.append(_fold(f"LOCATION:{_escape(event.location)}"))
        if event.description:
            lines.append(_fold(f"DESCRIPTION:{_escape(event.description)}"))
        if event.alarm_minutes:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY",
                      f"TRIGGER:-PT{event.alarm_minutes}M",
                      _fold(f"DESCRIPTION:{_escape(event.summary)}"),
                      "END:VALARM"]
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return CRLF.join(lines) + CRLF


def events_from_twin(twin: T.Twin) -> list[Event]:
    """Turn what the twin knows into calendar entries.

    Only facts that exist become events. A trip with no flight gets no flight
    entry rather than a placeholder, because a calendar full of guesses is worse
    than a sparse one.
    """
    events: list[Event] = []
    destination = twin.get(T.DESTINATION, "your trip")

    start, end = twin.get(T.START), twin.get(T.END)
    if isinstance(start, date) and isinstance(end, date):
        events.append(Event(
            summary=f"Trip: {destination}",
            start=datetime.combine(start, datetime.min.time().replace(hour=9)),
            end=datetime.combine(end, datetime.min.time().replace(hour=20)),
            location=destination,
            description="Created by WanderOS"))

    flight = twin.get(T.FLIGHT) or {}
    if flight.get("scheduled_arrival"):
        try:
            arrival = datetime.fromisoformat(flight["scheduled_arrival"])
            events.append(Event(
                summary=(f"Flight {flight.get('flight_iata', '')} arrives "
                         f"{flight.get('arrival_airport', '')}").strip(),
                start=arrival, end=arrival + timedelta(minutes=30),
                location=flight.get("arrival_airport", ""),
                alarm_minutes=180))
        except ValueError:
            pass

    # A passport that fails the six-month rule is only useful as a deadline the
    # traveller actually sees, so it becomes a calendar entry with a reminder.
    readiness = twin.get("readiness") or {}
    for finding in readiness.get("findings", []):
        if finding.get("severity") == "blocking" and finding.get("deadline"):
            try:
                events.append(Event(
                    summary=f"Fix before travel: {finding.get('code', '')}",
                    start=datetime.combine(date.fromisoformat(finding["deadline"]),
                                           datetime.min.time().replace(hour=10)),
                    description=finding.get("detail", "")[:300],
                    alarm_minutes=60 * 24))
            except (ValueError, TypeError):
                continue

    return events


# --- Deep links ------------------------------------------------------------
#
# Universal schemes, so no integration or partnership is required. Each falls
# back to a web URL, because an app-only link is broken for anyone without the
# app installed.

def map_link(query: str, *, lat: float | None = None, lon: float | None = None) -> dict:
    encoded = urllib.parse.quote(query)
    coords = f"{lat},{lon}" if lat is not None and lon is not None else encoded
    return {
        "apple": f"https://maps.apple.com/?q={encoded}"
                 + (f"&ll={lat},{lon}" if lat is not None else ""),
        "google": f"https://www.google.com/maps/search/?api=1&query={coords}",
        "osm": (f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}"
                if lat is not None else f"https://www.openstreetmap.org/search?query={encoded}"),
        "geo": f"geo:{coords}?q={encoded}",
    }


def share_links(title: str, url: str) -> dict:
    """Send the trip to someone, in whatever they already use."""
    t, u = urllib.parse.quote(title), urllib.parse.quote(url)
    return {
        "whatsapp": f"https://wa.me/?text={t}%20{u}",
        "telegram": f"https://t.me/share/url?url={u}&text={t}",
        "sms": f"sms:?&body={t}%20{u}",
        "email": f"mailto:?subject={t}&body={u}",
        "x": f"https://twitter.com/intent/tweet?text={t}&url={u}",
    }


# --- Wallet pass -----------------------------------------------------------

def build_pass(twin: T.Twin, out: Path, *, serial: str = "") -> dict:
    """A .pkpass bundle — structurally valid, and unsigned.

    Wallet refuses an unsigned pass. We build the real structure so the
    remaining work is a certificate rather than code, and report `signed: False`
    instead of implying it will install.
    """
    destination = twin.get(T.DESTINATION, "Trip")
    start, end = twin.get(T.START), twin.get(T.END)
    serial = serial or hashlib.sha256(twin.trip_id.encode()).hexdigest()[:16]

    fields = []
    if isinstance(start, date):
        fields.append({"key": "start", "label": "DEPARTS", "value": str(start)})
    if isinstance(end, date):
        fields.append({"key": "end", "label": "RETURNS", "value": str(end)})

    weather = twin.get(T.WEATHER) or {}
    if weather.get("min_temp_c") is not None:
        fields.append({"key": "weather", "label": "WEATHER",
                       "value": f"{weather['min_temp_c']}–{weather['max_temp_c']}°C",
                       # The forecast/estimate distinction survives onto the pass.
                       "changeMessage": weather.get("kind", "")})

    payload = {
        "formatVersion": 1,
        "passTypeIdentifier": "pass.app.wanderos.trip",
        "serialNumber": serial,
        "teamIdentifier": "PLACEHOLDER",
        "organizationName": "WanderOS",
        "description": f"WanderOS trip to {destination}",
        "backgroundColor": "rgb(14,12,20)",
        "foregroundColor": "rgb(243,233,217)",
        "labelColor": "rgb(255,191,0)",
        "generic": {
            "primaryFields": [{"key": "destination", "label": "DESTINATION",
                               "value": destination}],
            "secondaryFields": fields[:2],
            "auxiliaryFields": fields[2:4],
            "backFields": [{"key": "provenance", "label": "How this was built",
                            "value": json.dumps(twin.provenance(), default=str)[:900]}],
        },
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bundle:
        raw = json.dumps(payload, indent=2).encode()
        bundle.writestr("pass.json", raw)
        # manifest.json is what the signature would cover.
        bundle.writestr("manifest.json", json.dumps(
            {"pass.json": hashlib.sha1(raw).hexdigest()}, indent=2))

    return {
        "path": str(out),
        "serial": serial,
        "signed": False,
        "installable": False,
        "reason": ("Unsigned. Wallet requires an Apple developer certificate and "
                   "will refuse to install this. The structure is correct, so the "
                   "remaining work is procurement rather than code."),
        "note": "Google Wallet now reads .pkpass too, so one signed file serves both.",
    }


def bundle(twin: T.Twin, out_dir: Path, *, public_url: str = "") -> dict:
    """Everything at once: calendar, links, wallet pass."""
    out_dir.mkdir(parents=True, exist_ok=True)
    events = events_from_twin(twin)

    ics_path = out_dir / "trip.ics"
    ics_path.write_text(to_ics(events, trip_id=twin.trip_id,
                               name=f"{twin.get(T.DESTINATION, 'Trip')}"),
                        encoding="utf-8")

    destination = twin.get(T.DESTINATION, "")
    return {
        "calendar": {"path": str(ics_path), "events": len(events),
                     "works_everywhere": True,
                     "note": "RFC 5545 — no key, no partnership, opens on any platform"},
        "maps": map_link(destination) if destination else None,
        "share": share_links(f"My trip to {destination}", public_url) if public_url else None,
        "wallet": build_pass(twin, out_dir / "trip.pkpass"),
        "principle": ("A travel tool that only works inside its own app has already "
                      "lost. On the day, people live in their calendar, wallet and "
                      "maps — not in a trip planner."),
    }
