"""Smart curation — drop the duplicates and the unusable shots before anything else.

The single most common complaint about trip-photo apps is that near-identical
frames and blurry misfires clutter the result and the user has to wade through
them. We also pay per asset that reaches a vision model, so curating first is
both the quality fix and the cost fix.

Deliberately dependency-light and deterministic: difference-hash for perceptual
similarity, variance-of-Laplacian for blur. Both are classic, cheap, explainable
methods — the user is told *why* a photo was set aside, which matters when we are
about to tell them what their trip contained.

Nothing is deleted. Every original stays in B2; curation only decides what the
story is built from.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

HASH_SIZE = 8            # 64-bit dHash
NEAR_DUPLICATE_BITS = 6  # <=6 differing bits ~ the same shot
# Variance-of-Laplacian, calibrated against real photos from this repo rather
# than a textbook constant: sharp originals score 300-1000, a 2px gaussian blur
# scores ~89, 4px ~17, 8px ~3. 60 sits below "slightly soft but usable" and
# above anything genuinely unusable.
BLUR_FLOOR = 60.0


@dataclass
class PhotoScore:
    key: str
    phash: int | None = None
    sharpness: float = 0.0
    megapixels: float = 0.0
    usable: bool = True
    reason: str = ""
    duplicate_of: str | None = None
    group: int = -1


@dataclass
class CurationResult:
    scored: list[PhotoScore] = field(default_factory=list)
    selected: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        dupes = sum(1 for p in self.scored if p.duplicate_of)
        blurry = sum(1 for p in self.scored if not p.usable and not p.duplicate_of)
        return {
            "uploaded": len(self.scored),
            "duplicates": dupes,
            "low_quality": blurry,
            "usable": len(self.selected),
            "headline": (f"{len(self.scored)} uploaded → {dupes} duplicates, "
                         f"{blurry} low quality → {len(self.selected)} used"),
        }


def _dhash(image) -> int:
    """Difference hash: compare each pixel to its right neighbour.

    Robust to resizing and mild compression, which is exactly the "same photo
    from two phones" case — and far cheaper than embedding every image.
    """
    small = image.convert("L").resize((HASH_SIZE + 1, HASH_SIZE))
    px = list(small.getdata())
    bits = 0
    for row in range(HASH_SIZE):
        base = row * (HASH_SIZE + 1)
        for col in range(HASH_SIZE):
            bits = (bits << 1) | int(px[base + col] > px[base + col + 1])
    return bits


def _sharpness(image) -> float:
    """Variance of the Laplacian — the standard cheap blur metric.

    Implemented over a downscaled greyscale copy so a 40MP photo costs the same
    as a small one.
    """
    small = image.convert("L").resize((256, 256))
    px = list(small.getdata())
    w = 256
    values = []
    for y in range(1, 255):
        row = y * w
        for x in range(1, 255, 2):  # every other pixel: same signal, half the work
            i = row + x
            values.append(4 * px[i] - px[i - 1] - px[i + 1] - px[i - w] - px[i + w])
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / len(values)


def score_photo(key: str, data: bytes) -> PhotoScore:
    from PIL import Image

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        return PhotoScore(key=key, usable=False, reason=f"unreadable ({type(exc).__name__})")

    w, h = image.size
    score = PhotoScore(
        key=key,
        phash=_dhash(image),
        sharpness=_sharpness(image),
        megapixels=round(w * h / 1_000_000, 1),
    )
    if score.sharpness < BLUR_FLOOR:
        score.usable = False
        score.reason = f"too soft to use (sharpness {score.sharpness:.0f})"
    elif score.megapixels < 0.3:
        score.usable = False
        score.reason = f"too small ({w}x{h})"
    return score


def curate(photos: list[tuple[str, bytes]]) -> CurationResult:
    """Score, group near-duplicates, and keep the sharpest of each group."""
    scored = [score_photo(key, data) for key, data in photos]

    # Group by perceptual distance. O(n^2) is fine at trip scale (hundreds), and
    # is exact — an ANN index would trade that away for no real gain here.
    groups: list[list[PhotoScore]] = []
    for photo in scored:
        if photo.phash is None:
            continue
        for group in groups:
            if bin(photo.phash ^ group[0].phash).count("1") <= NEAR_DUPLICATE_BITS:
                group.append(photo)
                break
        else:
            groups.append([photo])

    selected: list[str] = []
    for index, group in enumerate(groups):
        for photo in group:
            photo.group = index
        # Keep the sharpest usable frame; resolution breaks ties.
        candidates = [p for p in group if p.usable] or group
        best = max(candidates, key=lambda p: (p.sharpness, p.megapixels))
        for photo in group:
            if photo is not best:
                photo.duplicate_of = best.key
                photo.usable = False
                if not photo.reason:
                    photo.reason = "near-duplicate of a sharper shot"
        if best.usable:
            selected.append(best.key)

    return CurationResult(scored=scored, selected=selected)
