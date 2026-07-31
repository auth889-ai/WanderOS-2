"""Year in Travel — a Wrapped where every number says how it is known.

The year-in-review card is the most reliably shared artifact in consumer apps,
and every travel version of it has the same quiet problem: the numbers are
unverifiable. "You visited 23 places, 14,203 km" — from what? GPS pings that
counted a layover as a country, a duplicate stop counted twice, a flight the app
recorded that never happened. The user has no way to check, and neither does
anyone they show it to.

That is the one thing this project can do that a competitor cannot, because the
machinery already exists: every stat here carries its **basis** —

    VERIFIED   derived from photo/EXIF evidence or a traveller correction
    CORRECTED  the traveller overruled what we inferred, and this is their number
    ESTIMATED  computed from incomplete data, and the gap is stated
    UNKNOWN    not enough evidence; shown as unknown rather than guessed

A Wrapped card that admits "4 of your 23 places had no photo evidence" is more
impressive than one that quietly rounds up, and it is the only version of this
that survives someone asking "is that actually true?".

The card is sealed like everything else, so a shared image can be checked
against the record that produced it.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

VERIFIED = "verified"
CORRECTED = "corrected"
ESTIMATED = "estimated"
UNKNOWN = "unknown"

BASIS_LABEL = {
    VERIFIED: "from your photos",
    CORRECTED: "you corrected this",
    ESTIMATED: "partly estimated",
    UNKNOWN: "not enough evidence",
}


@dataclass
class Stat:
    key: str
    label: str
    value: object
    basis: str = VERIFIED
    detail: str = ""

    def as_dict(self) -> dict:
        return {**self.__dict__, "basis_label": BASIS_LABEL.get(self.basis, self.basis)}


@dataclass
class TripSummary:
    """One trip's contribution. Deliberately small — this is a roll-up, not a
    second copy of the trip model."""
    trip_id: str
    title: str = ""
    countries: list[str] = field(default_factory=list)
    places: list[str] = field(default_factory=list)
    km: float = 0.0
    days: int = 0
    photos: int = 0
    photos_with_gps: int = 0
    photos_with_date: int = 0
    corrections: int = 0
    start: str = ""


def _basis_for_coverage(known: int, total: int) -> str:
    """How a number should describe itself, given how much of it is evidenced."""
    if total == 0:
        return UNKNOWN
    ratio = known / total
    if ratio >= 0.95:
        return VERIFIED
    return ESTIMATED


def build(trips: list[TripSummary], *, year: int) -> dict:
    """Roll trips into a year card, with each stat carrying its basis."""
    if not trips:
        return {"year": year, "stats": [], "empty": True,
                "message": "No trips recorded for this year."}

    total_photos = sum(t.photos for t in trips)
    dated = sum(t.photos_with_date for t in trips)
    located = sum(t.photos_with_gps for t in trips)
    corrections = sum(t.corrections for t in trips)

    countries = sorted({c for t in trips for c in t.countries if c})
    places = [p for t in trips for p in t.places if p]
    unique_places = sorted(set(places))

    stats: list[Stat] = [
        Stat("trips", "Trips", len(trips), VERIFIED,
             f"{len(trips)} trip{'s' if len(trips) != 1 else ''} recorded"),
        Stat("countries", "Countries", len(countries),
             _basis_for_coverage(located, total_photos),
             ", ".join(countries[:8]) + ("…" if len(countries) > 8 else "")),
        Stat("places", "Places", len(unique_places),
             CORRECTED if corrections else _basis_for_coverage(located, total_photos),
             (f"{corrections} correction{'s' if corrections != 1 else ''} you made are "
              "included" if corrections else "")),
        Stat("days", "Days away", sum(t.days for t in trips),
             _basis_for_coverage(dated, total_photos)),
        Stat("photos", "Photos kept", total_photos, VERIFIED),
    ]

    # Distance is the stat most often inflated, so it is the most careful.
    km = round(sum(t.km for t in trips))
    if located == 0:
        stats.append(Stat("distance_km", "Distance", None, UNKNOWN,
                          "no photo carried location data, so distance cannot be computed"))
    else:
        stats.append(Stat(
            "distance_km", "Distance", km,
            _basis_for_coverage(located, total_photos),
            f"{km:,} km, from {located} of {total_photos} photos that carried location"))

    # Superlatives — the shareable part. Each still names its evidence.
    longest = max(trips, key=lambda t: t.days, default=None)
    if longest and longest.days:
        stats.append(Stat("longest_trip", "Longest trip",
                          f"{longest.title or longest.trip_id} · {longest.days} days",
                          _basis_for_coverage(longest.photos_with_date, longest.photos)))

    if places:
        top_place, count = Counter(places).most_common(1)[0]
        if count > 1:
            stats.append(Stat("most_returned", "Most returned to",
                              f"{top_place} ({count} visits)", VERIFIED))

    first = min((t for t in trips if t.start), key=lambda t: t.start, default=None)
    if first:
        stats.append(Stat("first_trip", "Started the year", first.title or first.trip_id,
                          VERIFIED, first.start))

    # The honesty line. This is the differentiator, so it is a first-class stat
    # rather than a footnote.
    unevidenced = total_photos - located
    if unevidenced > 0 and total_photos:
        stats.append(Stat(
            "evidence_gap", "Not fully evidenced", f"{unevidenced} of {total_photos} photos",
            ESTIMATED,
            "these carried no location, so places and distance are partly estimated"))

    payload = {"year": year, "stats": [s.as_dict() for s in stats],
               "countries": countries, "corrections_included": corrections}
    canonical = json.dumps(payload, sort_keys=True, default=str).encode()
    payload["sha256"] = hashlib.sha256(canonical).hexdigest()
    payload["verifiable"] = True
    payload["note"] = ("Every figure states how it is known. A number marked "
                       "'partly estimated' is not a worse number — it is an honest one.")
    return payload


# --- Shareable card ---------------------------------------------------------

W, H = 1080, 1350           # portrait, the aspect every social platform accepts
BG = (14, 12, 20)
INK = (243, 233, 217)
MUTED = (148, 163, 184)
BASIS_COLOUR = {
    VERIFIED: (74, 222, 128),
    CORRECTED: (103, 232, 249),
    ESTIMATED: (255, 191, 0),
    UNKNOWN: (148, 163, 184),
}


def render_card(card: dict, out: Path, *, name: str = "") -> Path:
    """Render the year card as a shareable image.

    Each stat carries a coloured dot for its basis and a legend explains it, so
    the honesty survives being screenshotted — which is how this artifact
    actually travels.
    """
    from PIL import Image, ImageDraw

    from app.media.captions import font

    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    margin = 84
    y = 96

    draw.text((margin, y), str(card["year"]), font=font(112), fill=INK)
    y += 132
    draw.text((margin, y), (f"{name}'s year in travel" if name else "Your year in travel"),
              font=font(34), fill=MUTED)
    y += 90

    headline = [s for s in card["stats"]
                if s["key"] in ("trips", "countries", "places", "days")]
    for stat in headline:
        colour = BASIS_COLOUR.get(stat["basis"], MUTED)
        value = "—" if stat["value"] is None else str(stat["value"])
        draw.text((margin, y), value, font=font(76), fill=INK)
        width = draw.textlength(value, font=font(76))
        draw.ellipse([margin + width + 22, y + 34, margin + width + 38, y + 50], fill=colour)
        draw.text((margin, y + 88), stat["label"].upper(), font=font(24), fill=MUTED)
        y += 148

    distance = next((s for s in card["stats"] if s["key"] == "distance_km"), None)
    if distance:
        colour = BASIS_COLOUR.get(distance["basis"], MUTED)
        value = "unknown" if distance["value"] is None else f"{distance['value']:,} km"
        draw.text((margin, y), value, font=font(58), fill=INK)
        draw.ellipse([margin + draw.textlength(value, font=font(58)) + 20, y + 24,
                      margin + draw.textlength(value, font=font(58)) + 36, y + 40], fill=colour)
        y += 74
        if distance["detail"]:
            draw.text((margin, y), distance["detail"][:64], font=font(22), fill=MUTED)
        y += 60

    y = H - 300
    draw.line([(margin, y), (W - margin, y)], fill=(60, 58, 70), width=1)
    y += 30
    draw.text((margin, y), "HOW EACH NUMBER IS KNOWN", font=font(22), fill=MUTED)
    y += 42
    for basis in (VERIFIED, CORRECTED, ESTIMATED):
        if not any(s["basis"] == basis for s in card["stats"]):
            continue
        draw.ellipse([margin, y + 6, margin + 14, y + 20], fill=BASIS_COLOUR[basis])
        draw.text((margin + 28, y), BASIS_LABEL[basis], font=font(24), fill=INK)
        y += 38

    draw.text((margin, H - 76), f"wanderos · verify {card['sha256'][:16]}",
              font=font(20), fill=(103, 232, 249))
    image.save(out)
    return out


def verify_card(card: dict) -> dict:
    """Re-derive the hash so a shared card can be checked against its record."""
    claimed = card.get("sha256")
    payload = {k: card[k] for k in ("year", "stats", "countries", "corrections_included")
               if k in card}
    recomputed = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return {"verified": claimed == recomputed,
            "claimed": claimed, "recomputed": recomputed}
