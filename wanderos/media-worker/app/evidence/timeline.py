"""Deterministic trip-timeline builder — the 'understanding' engine.

Algorithm (verified against how Google Photos Memories / Storyo engineer this —
metadata-first, deterministic, vision only for labeling later):
  1. EXIF pass: datetime + GPS per photo (Pillow).
  2. Sort by (datetime, key) — total order, same input → same timeline, always.
  3. Split DAYS by calendar date.
  4. Split MOMENTS within a day when the gap to the previous photo > 90 min
     OR the GPS jump > 2 km.
  5. Photos with no EXIF datetime append to a trailing 'unplaced' bucket in
     filename order (the story planner may still use them).
Vision labels/quality/emotion are attached LATER by the understand node — never
used for clustering (that's the production lesson: clustering must be cheap,
deterministic, and explainable).
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from datetime import datetime

import httpx
from PIL import ExifTags, Image

MOMENT_GAP_MIN = 90
MOMENT_JUMP_KM = 2.0

_EXIF_DT_KEYS = {v: k for k, v in ExifTags.TAGS.items() if v in ("DateTimeOriginal", "DateTime")}
_GPS_KEY = {v: k for k, v in ExifTags.TAGS.items()}.get("GPSInfo")


@dataclass
class PhotoMeta:
    key: str
    taken_at: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    error: str | None = None


@dataclass
class Moment:
    photos: list[str] = field(default_factory=list)
    start: str | None = None
    end: str | None = None
    lat: float | None = None
    lon: float | None = None


def _dms_to_deg(dms, ref) -> float | None:
    try:
        deg = float(dms[0]) + float(dms[1]) / 60 + float(dms[2]) / 3600
        return -deg if ref in ("S", "W") else deg
    except Exception:
        return None


def extract_meta(key: str, data: bytes) -> PhotoMeta:
    meta = PhotoMeta(key=key)

    # exifread (BSD-3) first: it parses the GPS sub-IFD and maker notes that
    # Pillow's getexif() silently drops, and it reads HEIC — which matters
    # because that is the iPhone default, and losing the timestamp on an iPhone
    # photo would silently break the timeline for most travellers.
    try:
        import exifread

        tags = exifread.process_file(io.BytesIO(data), details=False)
        if tags:
            for field in ("EXIF DateTimeOriginal", "Image DateTime", "EXIF DateTimeDigitized"):
                if field in tags:
                    try:
                        meta.taken_at = datetime.strptime(str(tags[field]), "%Y:%m:%d %H:%M:%S")
                        break
                    except ValueError:
                        continue
            lat_t, lon_t = tags.get("GPS GPSLatitude"), tags.get("GPS GPSLongitude")
            if lat_t and lon_t:
                def _deg(t, ref) -> float | None:
                    try:
                        d, m, s = [float(v.num) / float(v.den) for v in t.values]
                        val = d + m / 60 + s / 3600
                        return -val if str(ref) in ("S", "W") else val
                    except Exception:
                        return None

                meta.lat = _deg(lat_t, tags.get("GPS GPSLatitudeRef", "N"))
                meta.lon = _deg(lon_t, tags.get("GPS GPSLongitudeRef", "E"))
            if meta.taken_at or meta.lat is not None:
                return meta
    except Exception:
        pass  # fall through to Pillow rather than lose the photo entirely

    try:
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()  # HEIC/HEIF -> Pillow
        except Exception:
            pass
        img = Image.open(io.BytesIO(data))
        exif = img.getexif()
        if not exif:
            return meta
        for name in ("DateTimeOriginal", "DateTime"):
            tag = _EXIF_DT_KEYS.get(name)
            raw = exif.get(tag) if tag else None
            if not raw:  # DateTimeOriginal lives in the Exif IFD on many phones
                try:
                    raw = exif.get_ifd(0x8769).get(36867)
                except Exception:
                    raw = None
            if raw:
                try:
                    meta.taken_at = datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S")
                    break
                except ValueError:
                    continue
        if _GPS_KEY:
            try:
                gps = exif.get_ifd(_GPS_KEY)
                if gps:
                    lat = _dms_to_deg(gps.get(2), gps.get(1))
                    lon = _dms_to_deg(gps.get(4), gps.get(3))
                    meta.lat, meta.lon = lat, lon
            except Exception:
                pass
    except Exception as e:
        meta.error = str(e)[:200]
    return meta


def _km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def build_timeline(metas: list[PhotoMeta]) -> dict:
    dated = sorted([m for m in metas if m.taken_at], key=lambda m: (m.taken_at, m.key))
    unplaced = sorted([m.key for m in metas if not m.taken_at])

    days: list[dict] = []
    cur_day: dict | None = None
    cur_moment: Moment | None = None
    prev: PhotoMeta | None = None

    for m in dated:
        date_str = m.taken_at.date().isoformat()
        new_day = cur_day is None or cur_day["date"] != date_str
        gap_min = ((m.taken_at - prev.taken_at).total_seconds() / 60) if prev else 0
        jump_km = (
            _km(prev.lat, prev.lon, m.lat, m.lon)
            if prev and None not in (prev.lat, prev.lon, m.lat, m.lon)
            else 0.0
        )
        new_moment = new_day or gap_min > MOMENT_GAP_MIN or jump_km > MOMENT_JUMP_KM

        if new_day:
            cur_day = {"day": len(days) + 1, "date": date_str, "moments": []}
            days.append(cur_day)
        if new_moment:
            cur_moment = Moment()
            cur_day["moments"].append(cur_moment.__dict__)
        cm = cur_day["moments"][-1]
        cm["photos"].append(m.key)
        cm["start"] = cm["start"] or m.taken_at.isoformat()
        cm["end"] = m.taken_at.isoformat()
        if m.lat is not None:
            cm["lat"], cm["lon"] = m.lat, m.lon
        prev = m

    return {
        "days": days,
        "unplaced": unplaced,
        "stats": {
            "photos_total": len(metas),
            "photos_dated": len(dated),
            "days": len(days),
            "moments": sum(len(d["moments"]) for d in days),
        },
    }


async def analyze_photos(photos: list[dict]) -> dict:
    """photos: [{key, url}] — url is presigned (B2) or any fetchable URL."""
    metas: list[PhotoMeta] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for p in photos:
            try:
                resp = await client.get(p["url"])
                resp.raise_for_status()
                metas.append(extract_meta(p["key"], resp.content))
            except Exception as e:
                metas.append(PhotoMeta(key=p["key"], error=str(e)[:200]))
    return build_timeline(metas)
