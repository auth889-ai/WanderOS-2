"""Feature 20 — Safety Guardian.

The information you need in an emergency abroad is the information you cannot
look up when the emergency happens: your phone has no data, you do not speak the
language, and you do not know that the ambulance number here is not 911.

So none of this is fetched live. Emergency numbers, embassy contacts and medical
phrases are assembled BEFORE departure and travel with the traveller, because a
safety feature that needs connectivity has failed at exactly the moment it
matters.

Emergency numbers are hardcoded on purpose — the same reasoning as the EC261
amounts and IATA cabin rules. They are published national standards that change
on the order of decades, and fetching them from a third party would make them
less reliable, not more. A wrong ambulance number is worse than no app.

What this deliberately does NOT do: give medical advice, assess how dangerous a
place is, or tell anyone whether to travel. It surfaces contacts and phrases,
and points at the official advisory rather than paraphrasing it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ISO-2 -> {police, ambulance, fire, general}. "112" is the EU-wide number and
# works alongside national numbers everywhere in the EEA.
EMERGENCY_NUMBERS = {
    "GB": {"general": "999", "eu_alt": "112"},
    "IE": {"general": "999", "eu_alt": "112"},
    "US": {"general": "911"}, "CA": {"general": "911"},
    "FR": {"general": "112", "police": "17", "ambulance": "15", "fire": "18"},
    "DE": {"general": "112", "police": "110"},
    "IT": {"general": "112", "police": "113", "ambulance": "118"},
    "ES": {"general": "112"}, "PT": {"general": "112"}, "NL": {"general": "112"},
    "BE": {"general": "112"}, "GR": {"general": "112"}, "AT": {"general": "112"},
    "CH": {"general": "112", "police": "117", "ambulance": "144"},
    "NO": {"general": "112", "ambulance": "113"}, "SE": {"general": "112"},
    "DK": {"general": "112"}, "FI": {"general": "112"}, "IS": {"general": "112"},
    "PL": {"general": "112"}, "CZ": {"general": "112"}, "TR": {"general": "112"},
    "AU": {"general": "000"}, "NZ": {"general": "111"},
    "JP": {"police": "110", "ambulance": "119"},
    "KR": {"police": "112", "ambulance": "119"},
    "CN": {"police": "110", "ambulance": "120", "fire": "119"},
    "IN": {"general": "112", "police": "100", "ambulance": "102"},
    "BD": {"general": "999"}, "PK": {"police": "15", "ambulance": "1122"},
    "TH": {"general": "191", "ambulance": "1669", "tourist_police": "1155"},
    "VN": {"police": "113", "ambulance": "115"},
    "ID": {"general": "112", "police": "110", "ambulance": "118"},
    "MY": {"general": "999"}, "SG": {"police": "999", "ambulance": "995"},
    "PH": {"general": "911"},
    "AE": {"police": "999", "ambulance": "998"},
    "ZA": {"general": "112", "ambulance": "10177"},
    "EG": {"police": "122", "ambulance": "123"},
    "MA": {"police": "190", "ambulance": "150"},
    "BR": {"police": "190", "ambulance": "192"},
    "MX": {"general": "911"}, "AR": {"general": "911"}, "CL": {"general": "133"},
}

# The phrases that matter when you cannot explain yourself. Kept short: a phrase
# nobody can pronounce is not usable, and these are meant to be SHOWN as much as
# spoken.
MEDICAL_PHRASES = {
    "en": {"help": "Help!", "ambulance": "Call an ambulance",
           "allergic": "I am allergic to", "diabetic": "I am diabetic",
           "no_speak": "I do not speak the language", "police": "Call the police",
           "hospital": "Where is the hospital?", "pharmacy": "Where is a pharmacy?"},
    "es": {"help": "¡Ayuda!", "ambulance": "Llame a una ambulancia",
           "allergic": "Soy alérgico a", "diabetic": "Soy diabético",
           "no_speak": "No hablo español", "police": "Llame a la policía",
           "hospital": "¿Dónde está el hospital?", "pharmacy": "¿Dónde hay una farmacia?"},
    "fr": {"help": "Au secours !", "ambulance": "Appelez une ambulance",
           "allergic": "Je suis allergique à", "diabetic": "Je suis diabétique",
           "no_speak": "Je ne parle pas français", "police": "Appelez la police",
           "hospital": "Où est l'hôpital ?", "pharmacy": "Où est la pharmacie ?"},
    "it": {"help": "Aiuto!", "ambulance": "Chiami un'ambulanza",
           "allergic": "Sono allergico a", "diabetic": "Sono diabetico",
           "no_speak": "Non parlo italiano", "police": "Chiami la polizia",
           "hospital": "Dov'è l'ospedale?", "pharmacy": "Dov'è la farmacia?"},
    "de": {"help": "Hilfe!", "ambulance": "Rufen Sie einen Krankenwagen",
           "allergic": "Ich bin allergisch gegen", "diabetic": "Ich bin Diabetiker",
           "no_speak": "Ich spreche kein Deutsch", "police": "Rufen Sie die Polizei",
           "hospital": "Wo ist das Krankenhaus?", "pharmacy": "Wo ist eine Apotheke?"},
    "ja": {"help": "助けて!", "ambulance": "救急車を呼んでください",
           "allergic": "アレルギーがあります", "diabetic": "糖尿病です",
           "no_speak": "日本語が話せません", "police": "警察を呼んでください",
           "hospital": "病院はどこですか?", "pharmacy": "薬局はどこですか?"},
    "id": {"help": "Tolong!", "ambulance": "Panggil ambulans",
           "allergic": "Saya alergi terhadap", "diabetic": "Saya diabetes",
           "no_speak": "Saya tidak bisa bahasa Indonesia", "police": "Panggil polisi",
           "hospital": "Di mana rumah sakit?", "pharmacy": "Di mana apotek?"},
    "th": {"help": "ช่วยด้วย!", "ambulance": "เรียกรถพยาบาล",
           "allergic": "ฉันแพ้", "diabetic": "ฉันเป็นเบาหวาน",
           "no_speak": "ฉันพูดภาษาไทยไม่ได้", "police": "เรียกตำรวจ",
           "hospital": "โรงพยาบาลอยู่ที่ไหน", "pharmacy": "ร้านขายยาอยู่ที่ไหน"},
}

COUNTRY_LANGUAGE = {
    "ES": "es", "MX": "es", "AR": "es", "CL": "es", "FR": "fr", "BE": "fr",
    "IT": "it", "DE": "de", "AT": "de", "CH": "de", "JP": "ja", "ID": "id",
    "TH": "th",
}

# Where to check the real advisory. We link, never paraphrase — a summarised
# travel warning that is subtly wrong is worse than a link to the real one.
ADVISORY_SOURCES = {
    "GB": "https://www.gov.uk/foreign-travel-advice",
    "US": "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html",
    "CA": "https://travel.gc.ca/travelling/advisories",
    "AU": "https://www.smartraveller.gov.au/destinations",
    "IE": "https://www.ireland.ie/en/dfa/overseas-travel/advice/",
    "NZ": "https://www.safetravel.govt.nz/",
}


@dataclass
class EmergencyContact:
    name: str
    relationship: str = ""
    phone: str = ""
    email: str = ""


@dataclass
class MedicalInfo:
    """Carried so a stranger can act on it, so it is deliberately minimal."""
    blood_type: str = ""
    allergies: list[str] = field(default_factory=list)
    conditions: list[str] = field(default_factory=list)
    medications: list[str] = field(default_factory=list)
    insurance_policy: str = ""
    insurance_phone: str = ""


def emergency_numbers(country: str) -> dict:
    country = (country or "").upper()
    numbers = EMERGENCY_NUMBERS.get(country)
    if not numbers:
        return {"known": False, "country": country,
                "advice": "Look up the local emergency number before you travel — "
                          "it is not 911 everywhere and guessing wastes the call."}
    return {"known": True, "country": country, **numbers}


def phrases_for(country: str) -> dict:
    lang = COUNTRY_LANGUAGE.get((country or "").upper(), "en")
    return {"language": lang, "phrases": MEDICAL_PHRASES.get(lang, MEDICAL_PHRASES["en"]),
            "note": "Show the screen rather than attempting pronunciation — being "
                    "understood matters more than saying it correctly."}


def safety_card(*, destination_country: str, home_country: str = "",
                contacts: list[EmergencyContact] | None = None,
                medical: MedicalInfo | None = None) -> dict:
    """One screen someone else can act on if the traveller cannot speak.

    Written to be shown to a stranger, a paramedic or a police officer — which
    is why it leads with medical facts and emergency numbers rather than with
    the traveller's itinerary.
    """
    medical = medical or MedicalInfo()
    return {
        "emergency_numbers": emergency_numbers(destination_country),
        "phrases": phrases_for(destination_country),
        "medical": {
            "blood_type": medical.blood_type,
            "allergies": medical.allergies,
            "conditions": medical.conditions,
            "medications": medical.medications,
            "insurance_policy": medical.insurance_policy,
            "insurance_phone": medical.insurance_phone,
        },
        "contacts": [{"name": c.name, "relationship": c.relationship,
                      "phone": c.phone, "email": c.email}
                     for c in (contacts or [])],
        "advisory_source": ADVISORY_SOURCES.get((home_country or "").upper()),
        "advisory_note": ("Check your own government's advisory directly. We link to it "
                          "rather than summarising it — a paraphrased travel warning that "
                          "is subtly wrong is more dangerous than no summary."),
        "works_offline": True,
        "disclaimer": ("Contacts and phrases only. This is not medical advice and does "
                       "not assess how safe a place is."),
    }


def gaps(card: dict) -> list[str]:
    """What is missing while it can still be filled in."""
    missing = []
    if not card["emergency_numbers"].get("known"):
        missing.append("emergency number for this country is not in our list — look it up")
    if not card["contacts"]:
        missing.append("no emergency contact added")
    if not card["medical"]["insurance_phone"]:
        missing.append("no insurance emergency line — this is the number you call first")
    if not card["medical"]["blood_type"]:
        missing.append("blood type not recorded")
    return missing
