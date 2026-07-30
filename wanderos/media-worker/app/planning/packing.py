"""Feature 14 — Smart Packing Autopilot.

Two failures worth preventing, and they are not the same kind of problem:

**Forgetting something** is annoying — you buy an adapter at the airport.

**Packing something in the wrong bag** gets it confiscated, and in the case of
lithium batteries it is a fire-safety rule, not an inconvenience. A power bank
in checked luggage is refused at the desk or removed from the hold; medication
in a checked bag that goes astray is a medical problem in a foreign country.

So the carry-on/checked split is treated as a safety rule with a reason
attached, not a packing preference. IATA dangerous-goods guidance is explicit
that spare lithium batteries and power banks must travel in the CABIN, where a
thermal event is visible and reachable, never in the hold.

Everything here is deterministic. Weather and activities drive quantities; the
bag assignment is a lookup table with citations. No model is asked what may fly.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Bag rules. CABIN_ONLY entries are safety rules, not conveniences.
CABIN_ONLY = {
    "power_bank": "spare lithium batteries and power banks are prohibited in the hold "
                  "(IATA dangerous goods) — a thermal event must be reachable in the cabin",
    "spare_batteries": "same lithium rule as power banks",
    "e_cigarette": "vaping devices must be carried in the cabin and never charged in flight",
    "medication": "if a checked bag is delayed you still have your medication, and many "
                  "countries want it in its original labelled packaging with the prescription",
    "passport": "you cannot check in without it",
    "laptop": "high-value electronics are excluded from most airline liability for checked bags",
    "camera": "same liability exclusion as laptops",
    "jewellery": "excluded from checked-baggage liability",
    "keys": "a delayed bag should not mean you cannot get into your home",
}
CHECKED_ONLY = {
    "liquids_over_100ml": "cabin liquids are limited to 100 ml per container",
    "sharp_tools": "blades and tools over the permitted length are refused at security",
    "scissors_large": "over roughly 6 cm blade length is refused in the cabin",
    "aerosols_large": "large aerosols exceed cabin limits",
}

# Plug type by country (ISO-2). Enough to cover the common cases; an unknown
# country returns "check" rather than a guess, because a wrong adapter is the
# same as no adapter.
PLUG_TYPES = {
    "GB": "G", "IE": "G", "MT": "G", "SG": "G", "MY": "G", "HK": "G", "AE": "G",
    "US": "A/B", "CA": "A/B", "MX": "A/B", "JP": "A/B", "PH": "A/B",
    "FR": "C/E", "BE": "C/E", "PL": "C/E", "CZ": "C/E",
    "DE": "C/F", "ES": "C/F", "IT": "C/F/L", "NL": "C/F", "PT": "C/F", "NO": "C/F",
    "SE": "C/F", "FI": "C/F", "AT": "C/F", "GR": "C/F", "TR": "C/F", "ID": "C/F",
    "CH": "J", "DK": "K", "IN": "C/D/M", "BD": "C/D/G", "ZA": "M/N/C",
    "AU": "I", "NZ": "I", "CN": "I/A/C", "AR": "I", "TH": "A/B/C",
    "BR": "N/C", "IL": "H/C",
}

# Rough grams, for a bag-weight estimate that is useful rather than precise.
TYPICAL_WEIGHT_G = {
    "tshirt": 150, "trousers": 400, "jumper": 500, "jacket": 800, "shoes": 900,
    "underwear": 60, "socks": 50, "swimwear": 120, "toiletries": 700,
    "laptop": 1500, "camera": 700, "power_bank": 250, "adapter": 100,
    "medication": 200, "book": 350, "umbrella": 300, "sunscreen": 200,
    "hat": 100, "gloves": 120, "thermal_layer": 300, "rain_jacket": 400,
}


@dataclass
class Item:
    name: str
    quantity: int = 1
    bag: str = "either"          # cabin | checked | either
    reason: str = ""
    because: str = ""            # what triggered it (weather, activity, rule)
    shared: bool = False         # one per group, not one per person

    def weight_g(self) -> int:
        return TYPICAL_WEIGHT_G.get(self.name, 200) * self.quantity

    def as_dict(self) -> dict:
        return {**self.__dict__, "weight_g": self.weight_g()}


@dataclass
class TripProfile:
    days: int
    destination_country: str = ""
    home_country: str = ""
    min_temp_c: float | None = None
    max_temp_c: float | None = None
    rain_expected: bool = False
    activities: list[str] = field(default_factory=list)   # beach, hiking, formal, business
    travellers: int = 1
    checked_allowance_kg: float | None = None
    cabin_allowance_kg: float | None = None
    medications: list[str] = field(default_factory=list)


def _clothing(profile: TripProfile) -> list[Item]:
    """Quantities scale with trip length but cap where laundry becomes rational."""
    days = max(1, profile.days)
    tops = min(days + 1, 10)
    bottoms = min((days // 2) + 1, 5)
    items = [
        Item("tshirt", tops, because=f"{days}-day trip"),
        Item("trousers", bottoms, because=f"{days}-day trip"),
        Item("underwear", min(days + 2, 12), because=f"{days}-day trip"),
        Item("socks", min(days + 2, 12), because=f"{days}-day trip"),
        Item("shoes", 1, because="worn or packed"),
    ]
    if days > 10:
        items.append(Item("laundry_detergent", 1,
                          because="over 10 days — washing beats packing 14 shirts"))
    return items


def _weather(profile: TripProfile) -> list[Item]:
    items: list[Item] = []
    if profile.min_temp_c is not None and profile.min_temp_c < 10:
        items += [
            Item("jacket", 1, because=f"lows near {profile.min_temp_c:.0f}°C"),
            Item("thermal_layer", 2, because=f"lows near {profile.min_temp_c:.0f}°C"),
        ]
        if profile.min_temp_c < 0:
            items += [Item("gloves", 1, because="sub-zero lows"),
                      Item("hat", 1, because="sub-zero lows")]
    elif profile.min_temp_c is not None and profile.min_temp_c < 18:
        items.append(Item("jumper", 1, because=f"lows near {profile.min_temp_c:.0f}°C"))
    if profile.max_temp_c is not None and profile.max_temp_c > 25:
        items += [Item("sunscreen", 1, bag="checked",
                       reason="over 100 ml is refused in the cabin",
                       because=f"highs near {profile.max_temp_c:.0f}°C"),
                  Item("hat", 1, because=f"highs near {profile.max_temp_c:.0f}°C")]
    if profile.rain_expected:
        items += [Item("rain_jacket", 1, because="rain forecast"),
                  Item("umbrella", 1, shared=True, because="rain forecast")]
    return items


ACTIVITY_ITEMS = {
    "beach": [("swimwear", 2), ("flip_flops", 1), ("beach_towel", 1)],
    "hiking": [("hiking_boots", 1), ("daypack", 1), ("water_bottle", 1)],
    "formal": [("formal_outfit", 1), ("dress_shoes", 1)],
    "business": [("laptop", 1), ("charger", 1), ("formal_outfit", 1)],
    "diving": [("swimwear", 2), ("dive_certification", 1)],
    "skiing": [("ski_gloves", 1), ("goggles", 1), ("thermal_layer", 2)],
}


def build_for_trip(destination: str, start, end, **kwargs) -> dict:
    """Build a packing list from a destination NAME and real dates.

    Fetches the actual weather rather than making the caller supply temperatures
    — which previously meant the caller had to already know the answer, and in
    practice meant a guess. The result records whether the weather was a
    forecast or a climate estimate, because packing for "typically 8C in March"
    is a different confidence than packing for a forecast.
    """
    from app.planning.weather import for_trip

    place, window = for_trip(destination, start, end)
    profile = TripProfile(
        days=(end - start).days + 1,
        destination_country=(place.country_code if place else kwargs.pop("destination_country", "")),
        min_temp_c=window.min_temp_c,
        max_temp_c=window.max_temp_c,
        rain_expected=window.rain_expected,
        **kwargs,
    )
    result = build_packing_list(profile)
    result["weather"] = {
        "kind": window.kind,
        "resolved_place": place.as_dict() if place else None,
        "min_temp_c": window.min_temp_c, "max_temp_c": window.max_temp_c,
        "rain_expected": window.rain_expected, "wet_days": window.wet_days,
        "basis": window.basis,
        "attribution": window.attribution,
    }
    if not window.usable:
        result["warnings"].append(
            f"weather unavailable ({window.basis}) — the list assumes nothing about climate")
    elif window.kind == "climate_estimate":
        result["warnings"].append(
            "weather is a climate estimate from previous years, not a forecast — "
            "re-check nearer the date")
    return result


def build_packing_list(profile: TripProfile) -> dict:
    items: list[Item] = []
    items += _clothing(profile)
    items += _weather(profile)

    for activity in profile.activities:
        for name, qty in ACTIVITY_ITEMS.get(activity, []):
            items.append(Item(name, qty, because=f"{activity} planned"))

    # Essentials, with their bag assignment carrying the reason.
    items += [
        Item("passport", 1, because="required"),
        Item("toiletries", 1, bag="checked",
             reason="most toiletries exceed the 100 ml cabin limit", because="required"),
        Item("phone_charger", 1, because="required"),
    ]
    for med in profile.medications:
        items.append(Item("medication", 1, because=f"prescription: {med}"))
    if profile.medications:
        items.append(Item("prescription_copy", 1,
                          because="some countries require documentation for medication"))

    # Adapter — only when the plug standard actually differs.
    home = PLUG_TYPES.get(profile.home_country.upper())
    away = PLUG_TYPES.get(profile.destination_country.upper())
    if profile.destination_country and away is None:
        items.append(Item("travel_adapter", 1, shared=True,
                          because=f"plug type for {profile.destination_country} unknown — "
                                  "check before you travel"))
    elif home and away and home != away:
        items.append(Item("travel_adapter", 1, shared=True,
                          because=f"{profile.home_country} uses type {home}, "
                                  f"{profile.destination_country} uses type {away}"))

    # Apply the safety rules last so they override anything set above.
    for item in items:
        if item.name in CABIN_ONLY:
            item.bag, item.reason = "cabin", CABIN_ONLY[item.name]
        elif item.name in CHECKED_ONLY:
            item.bag, item.reason = "checked", CHECKED_ONLY[item.name]

    cabin = [i for i in items if i.bag == "cabin"]
    checked = [i for i in items if i.bag == "checked"]
    either = [i for i in items if i.bag == "either"]

    # Shared items are counted once for the group, not once per traveller.
    def total_g(group: list[Item]) -> int:
        return sum(i.weight_g() * (1 if i.shared else profile.travellers) for i in group)

    est_checked_kg = round((total_g(checked) + total_g(either)) / 1000, 1)
    est_cabin_kg = round(total_g(cabin) / 1000, 1)

    warnings: list[str] = []
    if profile.checked_allowance_kg and est_checked_kg > profile.checked_allowance_kg:
        warnings.append(
            f"estimated checked weight {est_checked_kg}kg exceeds your "
            f"{profile.checked_allowance_kg}kg allowance by "
            f"{est_checked_kg - profile.checked_allowance_kg:.1f}kg")
    if profile.cabin_allowance_kg and est_cabin_kg > profile.cabin_allowance_kg:
        warnings.append(
            f"estimated cabin weight {est_cabin_kg}kg exceeds your "
            f"{profile.cabin_allowance_kg}kg allowance")

    return {
        "cabin": [i.as_dict() for i in cabin],
        "checked": [i.as_dict() for i in checked],
        "either": [i.as_dict() for i in either],
        "estimated_cabin_kg": est_cabin_kg,
        "estimated_checked_kg": est_checked_kg,
        "warnings": warnings,
        # The subset a traveller must not get wrong, pulled out so it is not
        # buried in a list of eighty items.
        "safety_rules": [
            {"item": i.name, "bag": i.bag, "reason": i.reason}
            for i in items if i.name in CABIN_ONLY or i.name in CHECKED_ONLY
        ],
        "shared_items": [i.name for i in items if i.shared],
        "total_items": len(items),
    }
