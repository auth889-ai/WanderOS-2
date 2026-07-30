"""Route map + travel stats — the brag surface, built from GPS we already have.

The timeline engine already extracts lat/lon per photo and throws it away after
day-clustering. This turns it into the two things people actually share: a map of
where they went, and the numbers they are proud of.

Two things make ours different from every other trip map:

1. **Every point is evidence-linked.** Each stop names the photos that put it
   there. The single loudest structural complaint about Polarsteps is that GPS
   errors are *uncorrectable* — "mystery flights", wrong routes, no way to fix
   them. If a point is wrong here, the traveller can see exactly which photo
   caused it and remove it.

2. **Precision is a consent decision.** Public output gets the general area, not
   coordinates, unless explicitly allowed (see evidence/sensitivity.py).

Rendered two ways from the same geometry: a PNG (Pillow) that composes into the
film with ffmpeg, and an SVG for crisp scaling in the web UI. Neither needs a
tile server, a map API key, or any network call at render time.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

# Stops closer than this are the same place — a hotel and its car park should not
# read as two destinations.
SAME_PLACE_KM = 2.0
# Below this, a "journey" is really just walking around; counting it as travel
# would inflate the distance number and make the stat dishonest.
MIN_LEG_KM = 0.5


@dataclass
class Stop:
    lat: float
    lon: float
    photos: list[str] = field(default_factory=list)
    first_seen: str | None = None
    label: str | None = None
    revisits: int = 0  # times the traveller came back here

    @property
    def evidence_count(self) -> int:
        return len(self.photos)


@dataclass
class Journey:
    stops: list[Stop] = field(default_factory=list)
    route: list[int] = field(default_factory=list)  # stop indices, in visit order
    legs_km: list[float] = field(default_factory=list)
    days: int = 0
    photos_with_gps: int = 0
    photos_total: int = 0

    @property
    def total_km(self) -> float:
        return round(sum(self.legs_km), 1)

    @property
    def furthest_leg_km(self) -> float:
        return round(max(self.legs_km), 1) if self.legs_km else 0.0

    def stats(self) -> dict:
        return {
            "places_visited": len(self.stops),
            "distance_km": self.total_km,
            "distance_miles": round(self.total_km * 0.621371, 1),
            "furthest_single_leg_km": self.furthest_leg_km,
            "days": self.days,
            "photos_total": self.photos_total,
            "photos_located": self.photos_with_gps,
            # Honest about coverage — a route drawn from 3 of 200 photos should
            # not be presented with the same confidence as one from 180.
            "location_coverage_pct": (
                round(100 * self.photos_with_gps / self.photos_total)
                if self.photos_total else 0
            ),
        }


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine great-circle distance."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def build_journey(timeline: dict) -> Journey:
    """Cluster located photos into stops, in the order they were visited."""
    journey = Journey(days=len(timeline.get("days", [])))
    located: list[tuple[float, float, str, str | None]] = []

    for day in timeline.get("days", []):
        for moment in day.get("moments", []):
            for photo in moment.get("photos", []):
                if isinstance(photo, dict):
                    key = photo.get("key")
                    lat, lon, when = photo.get("lat"), photo.get("lon"), photo.get("datetime")
                else:
                    key, lat, lon, when = photo, None, None, None
                journey.photos_total += 1
                if lat is not None and lon is not None:
                    located.append((float(lat), float(lon), key, when))

    journey.photos_with_gps = len(located)

    # Walk in visit order. A place you RETURN to is the same place, not a new
    # one — matching against every known stop (not just the previous) keeps
    # "places visited" honest when a trip starts and ends at the same airport.
    # `route` preserves the order actually travelled, including the return leg.
    for lat, lon, key, when in located:
        existing = next(
            (i for i, s in enumerate(journey.stops)
             if _km(s.lat, s.lon, lat, lon) <= SAME_PLACE_KM),
            None,
        )
        if existing is None:
            journey.stops.append(Stop(lat=lat, lon=lon, photos=[key], first_seen=when))
            existing = len(journey.stops) - 1
        else:
            journey.stops[existing].photos.append(key)
            journey.stops[existing].revisits += 1
        if not journey.route or journey.route[-1] != existing:
            journey.route.append(existing)

    for a_i, b_i in zip(journey.route, journey.route[1:]):
        a, b = journey.stops[a_i], journey.stops[b_i]
        leg = _km(a.lat, a.lon, b.lat, b.lon)
        if leg >= MIN_LEG_KM:
            journey.legs_km.append(leg)

    return journey


def render_route_svg(journey: Journey, *, width: int = 1280, height: int = 720,
                     title: str = "") -> str:
    """Self-contained SVG of the route — no tiles, no API key, no network.

    An equirectangular projection is fine at trip scale and keeps this
    dependency-free; a tile map would add a key, a rate limit and a failure mode
    for something that renders in milliseconds.
    """
    if not journey.stops:
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">'
                f'<rect width="100%" height="100%" fill="#101a17"/></svg>')

    lats = [s.lat for s in journey.stops]
    lons = [s.lon for s in journey.stops]
    pad = 90
    lat_span = max(max(lats) - min(lats), 0.01)
    lon_span = max(max(lons) - min(lons), 0.01)

    def project(lat: float, lon: float) -> tuple[float, float]:
        x = pad + (lon - min(lons)) / lon_span * (width - 2 * pad)
        y = pad + (max(lats) - lat) / lat_span * (height - 2 * pad)  # north is up
        return round(x, 1), round(y, 1)

    points = [project(s.lat, s.lon) for s in journey.stops]
    path = " ".join(f"{'M' if i == 0 else 'L'}{x},{y}" for i, (x, y) in enumerate(points))

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#16241f"/><stop offset="1" stop-color="#0d1512"/>'
        '</linearGradient></defs>',
        '<rect width="100%" height="100%" fill="url(#bg)"/>',
        f'<path d="{path}" fill="none" stroke="#8FBF7F" stroke-width="3" '
        'stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="9 7" opacity="0.85"/>',
    ]
    for i, ((x, y), stop) in enumerate(zip(points, journey.stops)):
        # Radius carries evidence weight: a stop backed by 30 photos should read
        # as more substantial than one backed by a single frame.
        r = 6 + min(stop.evidence_count, 12) * 0.7
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r + 5}" fill="#8FBF7F" opacity="0.16"/>')
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#EAF3E4" '
                     'stroke="#2B3A26" stroke-width="2"/>')
        if stop.label:
            parts.append(f'<text x="{x}" y="{y - r - 10}" fill="#EAF3E4" font-size="17" '
                         f'font-family="Georgia,serif" text-anchor="middle">{stop.label}</text>')
        parts.append(f'<text x="{x}" y="{y + 4}" fill="#2B3A26" font-size="11" '
                     f'font-family="Helvetica,Arial" text-anchor="middle">{i + 1}</text>')

    s = journey.stats()
    parts.append(f'<text x="{pad}" y="{height - 44}" fill="#EAF3E4" font-size="30" '
                 f'font-family="Georgia,serif">{title}</text>')
    parts.append(f'<text x="{pad}" y="{height - 18}" fill="#9FB39A" font-size="17" '
                 f'font-family="Helvetica,Arial">'
                 f'{s["places_visited"]} places · {s["distance_km"]} km · {s["days"]} days'
                 f'</text>')
    parts.append('</svg>')
    return "".join(parts)


def render_route_png(journey: Journey, out_path, *, width: int = 1280, height: int = 720,
                     title: str = ""):
    """Raster the route with Pillow — no libcairo, no tiles, no API key.

    Pillow is already required for curation and composition, so this adds zero
    new dependencies and survives a slim container. cairosvg would have pulled in
    a system libcairo that is absent on most base images.
    """
    from pathlib import Path

    from PIL import Image, ImageDraw

    from app.media.compose import _font

    out_path = Path(out_path)
    img = Image.new("RGB", (width, height), (13, 21, 18))
    draw = ImageDraw.Draw(img, "RGBA")

    # Subtle vertical lift so the canvas doesn't read as flat black.
    for y in range(height):
        t = y / height
        draw.line([(0, y), (width, y)],
                  fill=(int(22 - 9 * t), int(36 - 15 * t), int(31 - 13 * t)))

    if journey.stops:
        lats = [s.lat for s in journey.stops]
        lons = [s.lon for s in journey.stops]
        pad = 90
        lat_span = max(max(lats) - min(lats), 0.01)
        lon_span = max(max(lons) - min(lons), 0.01)
        pts = [
            (pad + (s.lon - min(lons)) / lon_span * (width - 2 * pad),
             pad + (max(lats) - s.lat) / lat_span * (height - 2 * pad))  # north up
            for s in journey.stops
        ]
        # Follow the ORDER TRAVELLED so a return leg is drawn, not implied.
        path_pts = [pts[i] for i in (journey.route or range(len(pts)))]

        # Dashed route line, drawn segment by segment.
        for (x1, y1), (x2, y2) in zip(path_pts, path_pts[1:]):
            length = math.hypot(x2 - x1, y2 - y1) or 1
            steps = max(int(length / 16), 1)
            for i in range(steps):
                if i % 2:
                    continue
                a = i / steps
                b = min((i + 1) / steps, 1.0)
                draw.line([(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a),
                           (x1 + (x2 - x1) * b, y1 + (y2 - y1) * b)],
                          fill=(143, 191, 127, 220), width=3)

        num_font = _font(13)
        for i, ((x, y), stop) in enumerate(zip(pts, journey.stops)):
            r = 7 + min(stop.evidence_count, 12) * 0.8  # radius carries evidence weight
            draw.ellipse([x - r - 6, y - r - 6, x + r + 6, y + r + 6], fill=(143, 191, 127, 45))
            draw.ellipse([x - r, y - r, x + r, y + r],
                         fill=(234, 243, 228), outline=(43, 58, 38), width=2)
            draw.text((x, y), str(i + 1), font=num_font, fill=(43, 58, 38), anchor="mm")

    # Scrim under the caption — a stop can land anywhere, including under text.
    for i in range(150):
        alpha = int(190 * (i / 150) ** 2)
        draw.line([(0, height - 150 + i), (width, height - 150 + i)],
                  fill=(10, 17, 14, alpha))

    s = journey.stats()
    if title:
        draw.text((90, height - 78), title, font=_font(34), fill=(234, 243, 228))
    draw.text((90, height - 34),
              f"{s['places_visited']} places · {s['distance_km']} km · {s['days']} days",
              font=_font(18), fill=(159, 179, 154))

    img.save(out_path)
    return out_path


def route_scene(journey: Journey, out_dir, *, seconds: int = 4, title: str = ""):
    """Render the route as a film scene — a slow push-in, not a static card."""
    from pathlib import Path

    from app.media.compose import _run_ffmpeg

    out_dir = Path(out_dir)
    if not journey.stops:
        return None
    png = render_route_png(journey, out_dir / "route.png", title=title)
    clip = out_dir / "route.mp4"
    _run_ffmpeg(["-loop", "1", "-i", str(png), "-t", str(seconds),
                 "-vf", (f"scale=1280:720,fps=24,"
                         f"zoompan=z='min(zoom+0.0005,1.12)':d={seconds * 24}:s=1280x720"),
                 "-pix_fmt", "yuv420p", str(clip)], stage="route-scene")
    return clip
