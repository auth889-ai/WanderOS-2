"""Live Day Controller, Culture Copilot and Capture Director."""
from __future__ import annotations

from datetime import date, datetime

from app.media import capture_director as cap
from app.planning import live_day


class TestCaptureDirector:
    def _gaps(self):
        return [cap.StoryGap("Ubud", ["establishing", "human"]),
                cap.StoryGap("Uluwatu", ["establishing", "motion"]),
                cap.StoryGap("Jimbaran", ["detail"])]

    def test_places_being_left_today_rank_first(self):
        """Ranked by how soon the chance closes, not by how good the shot is."""
        result = cap.direct(self._gaps(), [
            cap.Presence("Ubud", leaves_on=date(2026, 9, 25)),
            cap.Presence("Uluwatu", leaves_on=date(2026, 9, 22)),
        ], today=date(2026, 9, 21))
        assert result["prompts"][0]["place"] == "Uluwatu"
        assert result["prompts"][0]["urgency"] == "leaving_today"

    def test_places_already_left_are_reported_not_requested(self):
        """You cannot photograph somewhere you have gone. Asking would be noise;
        saying so is what tells the traveller the gap card is coming."""
        result = cap.direct(self._gaps(), [cap.Presence("Ubud")], today=date(2026, 9, 21))
        assert "Jimbaran" in result["no_longer_reachable"]
        assert all(p["place"] != "Jimbaran" for p in result["prompts"])

    def test_prompt_list_is_capped(self):
        """A list of twenty requests gets ignored entirely."""
        many = [cap.StoryGap(f"P{i}", list(cap.SHOT_TYPES)) for i in range(8)]
        presence = [cap.Presence(f"P{i}") for i in range(8)]
        result = cap.direct(many, presence, today=date(2026, 9, 21), limit=5)
        assert len(result["prompts"]) == 5
        assert result["held_back"] > 0

    def test_instructions_are_actionable_not_vague(self):
        """'Take more pictures' is useless; a shot description is a thing a
        person can do."""
        result = cap.direct([cap.StoryGap("Ubud", ["establishing"])],
                            [cap.Presence("Ubud")], today=date(2026, 9, 21))
        assert len(result["prompts"][0]["instruction"]) > 30

    def test_coverage_requires_an_establishing_shot(self):
        """Its absence is what makes a film feel like a photo dump."""
        report = cap.coverage({"A": ["detail", "human"], "B": ["establishing", "detail"]},
                              ["A", "B"])
        assert report["places"]["A"]["story_ready"] is False
        assert report["places"]["B"]["story_ready"] is True


class TestLiveDayController:
    D = datetime(2026, 9, 22)

    def _at(self, h, m):
        return self.D.replace(hour=h, minute=m)

    def _items(self):
        return [
            live_day.PlannedItem("Louvre", self._at(9, 0), self._at(11, 0),
                                 48.8606, 2.3376, priority=1),
            live_day.PlannedItem("Shopping", self._at(11, 30), self._at(12, 30),
                                 48.8656, 2.3212, mode="walk", priority=5),
            live_day.PlannedItem("Eiffel", self._at(13, 0), self._at(14, 30),
                                 48.8584, 2.2945, priority=2),
        ]

    def test_finished_items_are_not_replanned(self):
        result = live_day.replan(self._items(), now=self._at(12, 40),
                                 position=live_day.Position(48.8606, 2.3376))
        assert "Louvre" in result["completed"]
        assert all(r["name"] != "Louvre" for r in result["still_reachable"])

    def test_slippage_is_reported_rather_than_hidden(self):
        """Most apps keep showing the original schedule, which is worse than
        useless once it is wrong."""
        result = live_day.replan(self._items(), now=self._at(12, 40),
                                 position=live_day.Position(48.8606, 2.3376))
        assert result["total_slip_minutes"] > 0
        assert result["still_reachable"][0]["slipped_minutes"] > 0

    def test_a_small_slip_still_counts_as_on_track(self):
        """Ten minutes late with nothing missed is a normal day, not an alarm.
        A controller that panics at every delay gets ignored at the real one."""
        result = live_day.replan(self._items(), now=self._at(12, 40),
                                 position=live_day.Position(48.8606, 2.3376))
        assert result["total_slip_minutes"] <= 20
        assert result["day_is_on_track"] is True

    def test_a_missed_item_takes_the_day_off_track(self):
        items = self._items()
        items.append(live_day.PlannedItem(
            "Closed soon", self._at(13, 30), self._at(15, 0), 48.8049, 2.1204,
            priority=3, closes=self._at(12, 50)))
        result = live_day.replan(items, now=self._at(12, 40),
                                 position=live_day.Position(48.8606, 2.3376))
        assert result["day_is_on_track"] is False

    def test_an_item_that_closes_before_arrival_is_unreachable(self):
        items = self._items()
        items.append(live_day.PlannedItem(
            "Versailles", self._at(15, 30), self._at(18, 0), 48.8049, 2.1204,
            priority=1, closes=self._at(13, 0)))
        result = live_day.replan(items, now=self._at(12, 40),
                                 position=live_day.Position(48.8606, 2.3376))
        assert any(u["name"] == "Versailles" for u in result["no_longer_reachable"])

    def test_advice_protects_the_high_priority_item(self):
        """A plan that sheds the thing the traveller came for, because it was
        last, loses trust in one afternoon."""
        items = self._items()
        items.append(live_day.PlannedItem(
            "Came for this", self._at(15, 30), self._at(18, 0), 48.8049, 2.1204,
            priority=1, closes=self._at(13, 5)))
        result = live_day.replan(items, now=self._at(12, 40),
                                 position=live_day.Position(48.8606, 2.3376))
        advice = result["drop_advice"]
        assert advice and advice["protect"] == "Came for this"

    def test_an_on_track_day_says_so(self):
        result = live_day.replan(self._items(), now=self._at(8, 30),
                                 position=live_day.Position(48.8606, 2.3376))
        assert result["no_longer_reachable"] == []


class TestCultureCopilot:
    def test_known_country_returns_hedged_conventions(self):
        result = live_day.etiquette_for("JP")
        assert result["known"]
        assert "chopsticks" in str(result["notes"]).lower()
        assert "vary" in result["caveat"].lower()

    def test_unknown_country_defers_to_a_human(self):
        result = live_day.etiquette_for("ZZ")
        assert not result["known"]
        assert "host" in result["advice"].lower()

    def test_law_is_distinguished_from_custom(self):
        """Thailand's lese-majeste is a criminal offence, not an etiquette tip,
        and conflating the two is dangerous."""
        assert "law" in live_day.etiquette_for("TH")["notes"]["royalty"].lower()
