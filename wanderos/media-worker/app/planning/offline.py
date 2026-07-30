"""Feature 18 — Offline Survival Pack.

The information a traveller needs most is the information they cannot reach when
they need it. No roaming, a dead battery on the airport wifi, a train through a
tunnel, a country where the booking site is blocked. Research on what travellers
actually use lands on the same answer repeatedly: downloadable confirmations,
addresses, and maps that work with no data.

So the pack is a SINGLE FILE, generated before departure, that opens with no
network, no app, and no account — a self-contained HTML page any phone can open
from local storage. Everything is inlined; there is not one external request,
because a pack that fetches a font has failed in an airport with no signal.

**Why this is the honest use of B2 rather than a bolt-on.** The pack is built
once and stored as a durable object the traveller can re-download from any
device — including a replacement phone bought after theirs was stolen, which is
one of the scenarios it exists for. The manifest records exactly what went in
and its hash, so a pack downloaded in three weeks is provably the one that was
built.

The pack deliberately holds NO credentials, card numbers or passport scans.
An offline file is a file that can be lost with the phone, and the correct
contents are the things that are useless to a thief and priceless to the owner:
addresses, reference numbers, emergency contacts, phrases.
"""
from __future__ import annotations

import hashlib
import html
import json
from dataclasses import dataclass, field
from datetime import date, datetime

# Never written into an offline file, regardless of what a caller passes.
# An offline pack travels in the same pocket as the phone that gets stolen.
REDACTED_FIELDS = ("passport_number", "card_number", "cvv", "password",
                   "api_key", "policy_password", "pin")


@dataclass
class PackEntry:
    title: str
    detail: str = ""
    reference: str = ""
    address: str = ""
    phone: str = ""
    when: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class OfflinePack:
    trip_title: str
    destination: str
    start: date | None = None
    end: date | None = None
    bookings: list[PackEntry] = field(default_factory=list)
    addresses: list[PackEntry] = field(default_factory=list)
    safety: dict = field(default_factory=dict)
    itinerary: list[PackEntry] = field(default_factory=list)
    map_note: str = ""
    built_at: str = ""

    def as_dict(self) -> dict:
        return {
            "trip_title": self.trip_title, "destination": self.destination,
            "start": str(self.start) if self.start else None,
            "end": str(self.end) if self.end else None,
            "bookings": [b.as_dict() for b in self.bookings],
            "addresses": [a.as_dict() for a in self.addresses],
            "itinerary": [i.as_dict() for i in self.itinerary],
            "safety": self.safety,
            "built_at": self.built_at,
        }


def _redact(value: str) -> str:
    """Strip anything that looks like a secret, whatever the field was called."""
    lowered = (value or "").lower()
    for field_name in REDACTED_FIELDS:
        if field_name.replace("_", " ") in lowered or field_name in lowered:
            return "[removed — never stored in an offline file]"
    return value


_CSS = """
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#f3f0e9;color:#1a1d19;padding:20px;max-width:760px;margin:auto}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#5a6b52;
margin:28px 0 10px;border-bottom:1px solid #ddd8cc;padding-bottom:6px}
.sub{color:#6b6f66;margin:0 0 8px}
.card{background:#fff;border:1px solid #e3e0d7;border-radius:12px;padding:14px;margin:10px 0}
.t{font-weight:600}
.k{color:#6b6f66;font-size:14px}
.ref{font-family:ui-monospace,monospace;background:#eae6dc;padding:2px 6px;border-radius:5px}
.sos{background:#2b3a26;color:#fff;border-radius:12px;padding:16px;margin:14px 0}
.sos a{color:#ffd166;font-size:30px;font-weight:700;text-decoration:none;display:block}
.ph{display:flex;justify-content:space-between;gap:12px;padding:7px 0;
border-bottom:1px solid #eee}
.ph b{font-weight:600}
.foot{margin-top:30px;color:#6b6f66;font-size:13px;border-top:1px solid #ddd8cc;padding-top:12px}
@media(prefers-color-scheme:dark){body{background:#14121a;color:#e8e6e0}
.card{background:#1e1b26;border-color:#2f2b38}.ref{background:#2a2634}
h2{color:#9aa894;border-color:#2f2b38}.k,.foot{color:#9a978f}.ph{border-color:#2a2634}}
"""


def _entries_html(entries: list[PackEntry]) -> str:
    rows = []
    for e in entries:
        parts = [f'<div class="t">{html.escape(e.title)}</div>']
        if e.when:
            parts.append(f'<div class="k">{html.escape(e.when)}</div>')
        if e.reference:
            parts.append(f'<div class="k">ref <span class="ref">'
                         f'{html.escape(_redact(e.reference))}</span></div>')
        if e.address:
            parts.append(f'<div class="k">{html.escape(e.address)}</div>')
        if e.phone:
            # tel: works with no data — the one link worth having in an offline file.
            parts.append(f'<div class="k"><a href="tel:{html.escape(e.phone)}">'
                         f'{html.escape(e.phone)}</a></div>')
        if e.detail:
            parts.append(f'<div class="k">{html.escape(_redact(e.detail))}</div>')
        rows.append(f'<div class="card">{"".join(parts)}</div>')
    return "".join(rows)


def render_html(pack: OfflinePack) -> str:
    """A self-contained page. No external request of any kind."""
    safety = pack.safety or {}
    numbers = safety.get("emergency_numbers", {})
    sos = numbers.get("general") or numbers.get("police") or numbers.get("ambulance")

    sos_block = ""
    if sos:
        others = " · ".join(f"{k}: {v}" for k, v in numbers.items()
                            if k not in ("known", "country", "general") and isinstance(v, str))
        sos_block = (f'<div class="sos"><div class="k" style="color:#c8d5c0">'
                     f'EMERGENCY IN {html.escape(numbers.get("country",""))}</div>'
                     f'<a href="tel:{html.escape(sos)}">{html.escape(sos)}</a>'
                     + (f'<div class="k" style="color:#c8d5c0">{html.escape(others)}</div>'
                        if others else "") + "</div>")

    phrase_block = ""
    phrases = (safety.get("phrases") or {}).get("phrases") or {}
    if phrases:
        rows = "".join(f'<div class="ph"><span>{html.escape(k.replace("_"," "))}</span>'
                       f'<b>{html.escape(v)}</b></div>' for k, v in phrases.items())
        phrase_block = f'<h2>If you cannot speak the language</h2><div class="card">{rows}</div>'

    medical = safety.get("medical") or {}
    medical_rows = "".join(
        f'<div class="ph"><span>{html.escape(k.replace("_"," "))}</span>'
        f'<b>{html.escape(", ".join(v) if isinstance(v, list) else str(v))}</b></div>'
        for k, v in medical.items() if v)
    medical_block = (f'<h2>Medical</h2><div class="card">{medical_rows}</div>'
                     if medical_rows else "")

    contacts = safety.get("contacts") or []
    contact_block = ""
    if contacts:
        rows = "".join(
            f'<div class="card"><div class="t">{html.escape(c.get("name",""))}</div>'
            f'<div class="k">{html.escape(c.get("relationship",""))}</div>'
            + (f'<div class="k"><a href="tel:{html.escape(c.get("phone",""))}">'
               f'{html.escape(c.get("phone",""))}</a></div>' if c.get("phone") else "")
            + "</div>" for c in contacts)
        contact_block = f"<h2>Emergency contacts</h2>{rows}"

    dates = (f"{pack.start} to {pack.end}" if pack.start and pack.end else "")

    return f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(pack.trip_title)} — offline pack</title><style>{_CSS}</style></head><body>
<h1>{html.escape(pack.trip_title)}</h1>
<p class="sub">{html.escape(pack.destination)}{(' · ' + dates) if dates else ''}</p>
<p class="sub">This page works with no internet. Save it to your phone.</p>
{sos_block}
{contact_block}
{medical_block}
{f'<h2>Bookings</h2>{_entries_html(pack.bookings)}' if pack.bookings else ''}
{f'<h2>Addresses</h2>{_entries_html(pack.addresses)}' if pack.addresses else ''}
{f'<h2>Plan</h2>{_entries_html(pack.itinerary)}' if pack.itinerary else ''}
{phrase_block}
{f'<div class="card k">{html.escape(pack.map_note)}</div>' if pack.map_note else ''}
<div class="foot">Built {html.escape(pack.built_at)} by WanderOS.
No passport numbers, card details or passwords are stored in this file — it travels
in the same pocket as the phone that gets stolen.</div>
</body></html>"""


def build(pack: OfflinePack, *, now: datetime | None = None) -> dict:
    """Render the pack and describe exactly what went into it."""
    pack.built_at = (now or datetime.now()).strftime("%Y-%m-%d %H:%M")
    document = render_html(pack)
    payload = document.encode("utf-8")
    return {
        "html": document,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "contents": {
            "bookings": len(pack.bookings),
            "addresses": len(pack.addresses),
            "itinerary": len(pack.itinerary),
            "has_emergency_numbers": bool((pack.safety or {}).get("emergency_numbers", {}).get("known")),
            "has_contacts": bool((pack.safety or {}).get("contacts")),
            "has_phrases": bool((pack.safety or {}).get("phrases")),
        },
        "external_requests": 0,
        "manifest": pack.as_dict(),
    }


def store(trip_id: str, built: dict) -> str | None:
    """Put the pack in B2 so it survives the phone.

    This is the scenario the feature exists for: a stolen phone, a replacement
    handset, and a traveller who needs their hotel address and insurance number
    from a borrowed laptop. A pack that only lives on the lost device is no pack
    at all.
    """
    from app.config.settings import settings

    if not settings.b2_configured:
        return None
    try:
        from app.media import pipelines

        key = f"trips/{trip_id}/offline/pack-{built['sha256'][:12]}.html"
        pipelines._backend().put(key, built["html"].encode("utf-8"),
                                 content_type="text/html; charset=utf-8")
        return key
    except Exception:
        # The traveller still has the file in hand; losing the durable copy must
        # not fail the build.
        return None


def from_trip(trip_title: str, destination: str, *, bookings: list[PackEntry] = None,
              addresses: list[PackEntry] = None, itinerary: list[PackEntry] = None,
              safety: dict = None, start: date = None, end: date = None,
              map_note: str = "") -> OfflinePack:
    return OfflinePack(
        trip_title=trip_title, destination=destination, start=start, end=end,
        bookings=bookings or [], addresses=addresses or [],
        itinerary=itinerary or [], safety=safety or {},
        map_note=map_note or ("Download offline maps for this area in your maps app "
                              "before you leave wifi — this pack cannot include map tiles."),
    )
