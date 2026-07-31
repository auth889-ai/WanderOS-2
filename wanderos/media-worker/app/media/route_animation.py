"""The route, drawing itself — the sequence people actually share.

A film made only of photos is a slideshow no matter how well the photos are
graded. What makes a travel film feel like a *journey* is the moment the map
appears and the line starts moving: it is the single most-shared artifact in
this category, and it is why Polarsteps' route view is the thing people
screenshot.

This renders that frame by frame, so the line grows, stops appear as they are
reached, and the distance counter climbs. It is not a push-in on a static image
— that was the previous implementation and it reads as a still, because it is.

**Everything drawn here is evidence.** Stops come from photo GPS, legs are real
great-circle distances, and the counter shows kilometres that were actually
travelled. A route animation that invented a plausible-looking path would be the
same failure as a generated scene presented as a photograph, so a stop with no
coordinates is simply not drawn.

Pillow only — no map tiles, no API key, no libcairo. Tiles would need a key, a
network call per frame and an attribution overlay; a clean projected line is
more legible at video size anyway.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from app.media.captions import font
from app.media.ffmpeg import run_ffmpeg

W, H = 1920, 1080
BG = (14, 12, 20)
LAND = (30, 27, 40)
LINE = (255, 191, 0)          # the travelled path
LINE_DIM = (90, 78, 40)       # the path still to come
STOP = (243, 233, 217)
STOP_GLOW = (255, 209, 102)
INK = (243, 233, 217)
MUTED = (148, 163, 184)

MARGIN = 190
FPS = 30
# A leg takes this long to draw. Slow enough to read, fast enough that a
# fifteen-stop trip does not outlast the film.
SECONDS_PER_LEG = 0.55
HOLD_SECONDS = 1.6            # at the end, so the finished shape can be read


@dataclass
class RoutePoint:
    lat: float
    lon: float
    label: str = ""
    photos: int = 0


def _project(points: list[RoutePoint]) -> list[tuple[float, float]]:
    """Equirectangular projection scaled to the frame, latitude-corrected.

    Web Mercator would be the usual choice, but it badly distorts a trip that
    spans latitudes and this is a picture of a journey, not a navigation chart.
    Correcting longitude by cos(mean latitude) keeps the shape honest.
    """
    if not points:
        return []
    lats = [p.lat for p in points]
    lons = [p.lon for p in points]
    mean_lat = math.radians(sum(lats) / len(lats))
    xs = [p.lon * math.cos(mean_lat) for p in points]
    ys = [-p.lat for p in points]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)

    usable_w, usable_h = W - MARGIN * 2, H - MARGIN * 2
    # One scale for both axes so the route is never stretched — a squashed map
    # misrepresents the trip.
    scale = min(usable_w / span_x, usable_h / span_y)
    offset_x = (W - span_x * scale) / 2
    offset_y = (H - span_y * scale) / 2
    return [((x - min_x) * scale + offset_x, (y - min_y) * scale + offset_y)
            for x, y in zip(xs, ys)]


def _ease(t: float) -> float:
    """Smoothstep — the line accelerates away and settles into each stop."""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def _draw_frame(points: list[RoutePoint], xy: list[tuple[float, float]],
                legs_km: list[float], progress: float, *, title: str) -> Image.Image:
    """One frame. `progress` is 0..len(legs) — the leg index plus its fraction."""
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)

    # A faint graticule so the plane reads as a map rather than a chart.
    for i in range(1, 6):
        y = H * i / 6
        draw.line([(0, y), (W, y)], fill=LAND, width=1)
    for i in range(1, 9):
        x = W * i / 9
        draw.line([(x, 0), (x, H)], fill=LAND, width=1)

    # The whole route, dimmed — so the shape of the trip is legible from frame
    # one and the bright line reads as progress rather than as the only content.
    if len(xy) > 1:
        draw.line(xy, fill=LINE_DIM, width=3, joint="curve")

    reached = int(progress)
    fraction = progress - reached
    travelled: list[tuple[float, float]] = xy[:reached + 1]

    if reached < len(xy) - 1 and fraction > 0:
        ax, ay = xy[reached]
        bx, by = xy[reached + 1]
        eased = _ease(fraction)
        travelled = travelled + [(ax + (bx - ax) * eased, ay + (by - ay) * eased)]

    if len(travelled) > 1:
        draw.line(travelled, fill=LINE, width=6, joint="curve")

    # Stops appear as they are reached, sized by how much evidence supports them.
    for i, (x, y) in enumerate(xy):
        if i > reached:
            break
        radius = 7 + min(points[i].photos, 12) * 0.8
        draw.ellipse([x - radius - 6, y - radius - 6, x + radius + 6, y + radius + 6],
                     outline=STOP_GLOW, width=2)
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=STOP)
        if points[i].label:
            label_font = font(30)
            draw.text((x + radius + 14, y - 16), points[i].label,
                      font=label_font, fill=INK)

    # The head of the line, only while moving.
    if travelled and reached < len(xy) - 1:
        hx, hy = travelled[-1]
        draw.ellipse([hx - 9, hy - 9, hx + 9, hy + 9], fill=LINE)

    if title:
        draw.text((MARGIN - 60, 74), title, font=font(52), fill=INK)

    # Distance climbs with the line rather than jumping at each stop.
    km = sum(legs_km[:reached])
    if reached < len(legs_km):
        km += legs_km[reached] * _ease(fraction)
    draw.text((MARGIN - 60, H - 132), f"{km:,.0f} km", font=font(64), fill=LINE)
    draw.text((MARGIN - 60, H - 62),
              f"{min(reached + 1, len(points))} of {len(points)} places",
              font=font(28), fill=MUTED)

    return image


def render(points: list[RoutePoint], legs_km: list[float], out: Path, *,
           title: str = "", work_dir: Path | None = None,
           seconds_per_leg: float = SECONDS_PER_LEG, fps: int = FPS) -> Path | None:
    """Render the animated route to an MP4. None if there is nothing to draw.

    Returns None rather than an empty map for a trip with no located photos —
    an empty map card in the middle of a film is worse than no map at all.
    """
    usable = [p for p in points if p.lat is not None and p.lon is not None]
    if len(usable) < 2:
        return None

    work = Path(work_dir or out.parent / "route-frames")
    work.mkdir(parents=True, exist_ok=True)
    xy = _project(usable)
    legs = list(legs_km) + [0.0] * max(0, len(usable) - 1 - len(legs_km))

    frames_per_leg = max(2, int(seconds_per_leg * fps))
    total = frames_per_leg * (len(usable) - 1) + int(HOLD_SECONDS * fps)

    for frame_no in range(total):
        progress = min(frame_no / frames_per_leg, len(usable) - 1)
        _draw_frame(usable, xy, legs, progress, title=title).save(
            work / f"f{frame_no:05d}.png")

    run_ffmpeg(["-framerate", str(fps), "-i", str(work / "f%05d.png"),
                "-c:v", "libx264", "-crf", "18", "-preset", "slow",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
               stage="route-animation", timeout=600)
    return out


def from_journey(journey, out: Path, **kwargs) -> Path | None:
    """Build the animation from an `evidence.journey.Journey`."""
    order = journey.route or list(range(len(journey.stops)))
    points = [
        RoutePoint(lat=journey.stops[i].lat, lon=journey.stops[i].lon,
                   label=journey.stops[i].label or "",
                   photos=journey.stops[i].evidence_count)
        for i in order if i < len(journey.stops)
    ]
    return render(points, list(journey.legs_km), out, **kwargs)
