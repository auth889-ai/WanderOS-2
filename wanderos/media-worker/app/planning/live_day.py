"""Feature 15 — Live Day Controller, and Feature 19 — Culture Copilot.

**Live Day Controller.** A plan meets reality at about 10am. The museum queue is
forty minutes, lunch runs long, a train is cancelled — and from that point the
rest of the day is fiction. Most apps keep displaying the original schedule as
though nothing happened, which is worse than useless: the traveller is now
navigating by a document they know is wrong.

Replanning is not rescheduling everything. It is answering one question — *given
where I actually am and what time it actually is, what can I still do?* — using
real routing, and being honest about what has to go.

The rule when something must be dropped: **drop the cheapest thing to lose, not
the next thing chronologically.** A plan that silently sheds the one activity
the traveller came for, because it happened to be last, is how a tool loses
trust in a single afternoon.

**Culture Copilot.** The phrasebook half already exists in `safety.py` for
emergencies. This is the other half — the things that cause quiet offence rather
than danger, which no phrasebook covers: whether to tip, whether to remove your
shoes, which hand to use, what to do with your chopsticks.

Etiquette is stated as *convention with variation acknowledged*, never as rule.
Customs differ by region, generation and setting, and a confident "always do X"
is how a tool teaches someone to be wrong in a new way.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Conventions travellers most often get wrong, with the variation stated. Sourced
# from widely published etiquette guidance; deliberately hedged because it is.
ETIQUETTE = {
    "JP": {
        "tipping": "Not customary and can cause confusion. Service is included.",
        "shoes": "Removed in homes, many restaurants, temples and some clinics. "
                 "Look for a step up and a shoe rack.",
        "dining": "Do not stand chopsticks upright in rice, and do not pass food "
                  "chopstick-to-chopstick — both echo funeral rites.",
        "greeting": "A slight bow is standard; handshakes are common with foreigners.",
        "volume": "Phone calls on trains are avoided.",
    },
    "TH": {
        "tipping": "Not obligatory; rounding up is normal.",
        "shoes": "Removed in homes and temples.",
        "respect": "The head is symbolically the highest part of the body and feet "
                   "the lowest — avoid touching heads or pointing feet at people or images.",
        "royalty": "Criticism of the monarchy is a criminal offence. This is law, not custom.",
        "dress": "Shoulders and knees covered at temples.",
    },
    "ID": {
        "hands": "The left hand is considered unclean — give, receive and eat with the right.",
        "dress": "Shoulders and knees covered at temples; a sarong is usually provided.",
        "tipping": "Not expected in most places; common in tourist areas.",
        "greeting": "A slight bow with the right hand over the heart after a handshake.",
    },
    "IN": {
        "hands": "Eat and give with the right hand.",
        "shoes": "Removed in homes and places of worship.",
        "dress": "Modest dress is expected at religious sites; heads covered in gurdwaras.",
        "tipping": "Common in restaurants, around 10%.",
    },
    "FR": {
        "greeting": "Say bonjour on entering a shop — omitting it reads as rude more "
                    "than anything you might say afterwards.",
        "tipping": "Service is included. Rounding up is a courtesy, not an obligation.",
        "dining": "Bread goes on the table, not the plate.",
    },
    "IT": {
        "dining": "Cappuccino after a meal is unusual. Nobody will object.",
        "tipping": "Coperto is a cover charge, not a tip. Small extra is optional.",
        "dress": "Shoulders and knees covered in churches.",
    },
    "US": {
        "tipping": "Expected and part of wages — commonly 18-20% in restaurants. "
                   "This is the most consequential difference for most visitors.",
        "greeting": "Small talk with strangers is normal and not intrusive.",
    },
    "AE": {
        "dress": "Modest dress in public; shoulders and knees covered.",
        "ramadan": "Eating, drinking or smoking in public during daylight in Ramadan "
                   "is an offence for everyone, not only for Muslims.",
        "affection": "Public displays of affection are not accepted.",
    },
}

ETIQUETTE_CAVEAT = (
    "Conventions, not rules. Customs vary by region, generation and setting, and "
    "locals are almost always forgiving of a visitor who is visibly trying."
)


def etiquette_for(country: str) -> dict:
    country = (country or "").upper()
    notes = ETIQUETTE.get(country)
    if not notes:
        return {"country": country, "known": False,
                "advice": "We have no etiquette notes for this country. Ask your "
                          "accommodation host — they answer this better than any app.",
                "caveat": ETIQUETTE_CAVEAT}
    return {"country": country, "known": True, "notes": notes,
            "caveat": ETIQUETTE_CAVEAT,
            "most_consequential": max(notes.items(), key=lambda kv: len(kv[1]))[0]}


# --- Live Day Controller ----------------------------------------------------

@dataclass
class PlannedItem:
    name: str
    start: datetime
    end: datetime
    lat: float | None = None
    lon: float | None = None
    mode: str = "transit"
    priority: int = 3          # 1 = came for this, 5 = would not miss it
    closes: datetime | None = None
    cost: float = 0.0


@dataclass
class Position:
    lat: float | None = None
    lon: float | None = None
    at: datetime | None = None
    place: str = ""


def replan(items: list[PlannedItem], now: datetime, position: Position,
           *, buffer_min: int = 15) -> dict:
    """What is still reachable from here, at this hour.

    Uses real street routing rather than straight-line distance, because the
    whole question is whether the traveller can physically get there in time.
    """
    from app.planning.routing import leg

    remaining = sorted([i for i in items if i.end > now], key=lambda i: i.start)
    done = [i.name for i in items if i.end <= now]

    reachable: list[dict] = []
    unreachable: list[dict] = []
    cursor_lat, cursor_lon = position.lat, position.lon
    cursor_time = now

    for item in remaining:
        travel_min = 0.0
        source = "no coordinates"
        if None not in (cursor_lat, cursor_lon, item.lat, item.lon):
            routed = leg(cursor_lat, cursor_lon, item.lat, item.lon, mode=item.mode)
            travel_min = routed.minutes
            source = routed.distance_source

        arrive = cursor_time + timedelta(minutes=travel_min + buffer_min)
        latest_useful = item.closes or item.end

        if arrive >= latest_useful:
            unreachable.append({
                "name": item.name, "priority": item.priority,
                "why": (f"you would arrive {arrive:%H:%M}, after it "
                        f"{'closes' if item.closes else 'ends'} at {latest_useful:%H:%M}"),
                "travel_minutes": round(travel_min),
                "routing": source,
            })
            continue

        actual_start = max(arrive, item.start)
        reachable.append({
            "name": item.name, "priority": item.priority,
            "original_start": item.start.isoformat(),
            "new_start": actual_start.isoformat(),
            "slipped_minutes": round((actual_start - item.start).total_seconds() / 60),
            "travel_minutes": round(travel_min),
            "routing": source,
        })
        cursor_time = actual_start + (item.end - item.start)
        cursor_lat, cursor_lon = item.lat or cursor_lat, item.lon or cursor_lon

    # If something has to go, lose the cheapest thing — never simply the last.
    drop_advice = None
    if unreachable:
        keepers = sorted(unreachable, key=lambda u: u["priority"])
        most_wanted = keepers[0]
        if most_wanted["priority"] <= 2:
            sacrifices = [r for r in reachable if r["priority"] >= 4]
            drop_advice = {
                "protect": most_wanted["name"],
                "why": "this is high priority and currently unreachable",
                "consider_dropping": [s["name"] for s in sacrifices] or None,
                "note": ("Dropping a low-priority item earlier in the day may make the "
                         "one you came for reachable again."
                         if sacrifices else
                         "Nothing low-priority is left to drop — this one may not be "
                         "recoverable today."),
            }

    total_slip = sum(r["slipped_minutes"] for r in reachable)
    return {
        "now": now.isoformat(),
        "from": position.place or "current position",
        "completed": done,
        "still_reachable": reachable,
        "no_longer_reachable": unreachable,
        "total_slip_minutes": total_slip,
        "day_is_on_track": total_slip <= 20 and not unreachable,
        "drop_advice": drop_advice,
        "principle": ("Recomputed from where you actually are, using real street "
                      "routing. When something must go, the cheapest thing to lose "
                      "goes — not whatever happens to be last."),
    }
