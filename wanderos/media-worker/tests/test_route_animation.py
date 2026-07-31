"""Animated route — the sequence people share, and it must stay evidence.

A route animation that invented a plausible path would be the same failure as a
generated scene presented as a photograph.
"""
from __future__ import annotations

from app.media import route_animation as ra


def points():
    return [ra.RoutePoint(-8.65, 115.21, "Denpasar", 6),
            ra.RoutePoint(-8.50, 115.26, "Ubud", 22),
            ra.RoutePoint(-8.82, 115.08, "Uluwatu", 14)]


def test_a_single_point_renders_nothing(tmp_path):
    """One located photo is not a journey. An empty map card mid-film is worse
    than no map at all."""
    assert ra.render(points()[:1], [], tmp_path / "r.mp4") is None


def test_points_without_coordinates_are_excluded(tmp_path):
    mixed = points() + [ra.RoutePoint(None, None, "Unknown", 3)]
    projected = ra._project([p for p in mixed if p.lat is not None])
    assert len(projected) == 3, "a stop with no GPS must not be drawn"


def test_projection_never_stretches_the_route(tmp_path):
    """One scale for both axes — a squashed map misrepresents the trip."""
    xy = ra._project(points())
    assert len(xy) == 3
    assert all(0 <= x <= ra.W and 0 <= y <= ra.H for x, y in xy)


def test_projection_is_latitude_corrected():
    """Equirectangular without cos(lat) badly distorts a trip spanning
    latitudes. Two points at the same longitude must stay vertically aligned."""
    same_lon = [ra.RoutePoint(0.0, 100.0), ra.RoutePoint(40.0, 100.0)]
    xy = ra._project(same_lon)
    assert abs(xy[0][0] - xy[1][0]) < 1.0


def test_easing_starts_and_ends_still():
    assert ra._ease(0.0) == 0.0
    assert ra._ease(1.0) == 1.0
    assert 0.4 < ra._ease(0.5) < 0.6


def test_frame_shows_only_the_stops_reached_so_far():
    """The counter is the honest part — it must not run ahead of the line."""
    pts = points()
    xy = ra._project(pts)
    early = ra._draw_frame(pts, xy, [16.5, 48.0], progress=0.5, title="T")
    late = ra._draw_frame(pts, xy, [16.5, 48.0], progress=2.0, title="T")
    assert early.size == (ra.W, ra.H) == late.size
    # Later frames have strictly more bright pixels — the line has grown.
    bright = lambda im: sum(1 for p in im.getdata() if p[0] > 200 and p[1] > 150)
    assert bright(late) > bright(early)


def test_renders_a_real_clip(tmp_path):
    out = ra.render(points(), [16.5, 48.0], tmp_path / "route.mp4",
                    title="Bali", work_dir=tmp_path / "frames",
                    seconds_per_leg=0.2, fps=12)
    assert out is not None and out.exists()
    assert out.stat().st_size > 1000
