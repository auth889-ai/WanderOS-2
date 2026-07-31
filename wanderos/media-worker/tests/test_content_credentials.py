"""C2PA manifest construction — EU AI Act Article 50 vocabulary.

Tests what is actually complete: the decision about WHAT to declare. Attaching
needs a CA-issued certificate, which is procurement rather than engineering, and
is asserted to report failure honestly rather than to succeed.
"""
from __future__ import annotations

from app.trust import content_credentials as cc


def scenes():
    return [cc.SceneCredential(0, "photo"),
            cc.SceneCredential(1, "parallax"),
            cc.SceneCredential(2, "clip"),
            cc.SceneCredential(3, "recreated", prompt="a clifftop temple",
                               model="sora-2", provider="openai", consented=True)]


def test_a_mixed_film_declares_itself_composite_with_ai():
    """The conservative reading of Article 50, and the only honest one for a
    film that mixes real footage with a generated scene."""
    summary = cc.summarise(cc.build_manifest(scenes(), title="Trip"))
    assert summary["declared_source_type"].endswith("compositeWithTrainedAlgorithmicMedia")


def test_a_film_with_no_generated_scenes_is_not_labelled_as_ai():
    """Over-labelling is its own dishonesty — it teaches viewers the label is
    meaningless."""
    real_only = [cc.SceneCredential(0, "photo"), cc.SceneCredential(1, "clip")]
    summary = cc.summarise(cc.build_manifest(real_only, title="Trip"))
    assert summary["declared_source_type"].endswith("digitalCapture")
    assert summary["ai_generated"] == 0


def test_each_scene_carries_its_own_source_type():
    """A single film-level flag satisfies the letter of the rule and tells a
    viewer nothing about WHICH parts were generated."""
    summary = cc.summarise(cc.build_manifest(scenes(), title="Trip"))
    assert summary["scenes_total"] == 4
    assert summary["camera_captured"] == 2      # photo + clip
    assert summary["enhanced_real"] == 1        # parallax
    assert summary["ai_generated"] == 1


def test_generated_scenes_name_the_model_and_the_prompt():
    manifest = cc.build_manifest(scenes(), title="Trip")
    actions = manifest["assertions"][0]["data"]["actions"]
    generated = [a for a in actions
                 if a["digitalSourceType"].endswith("trainedAlgorithmicMedia")
                 and "scene" in a.get("parameters", {})]
    assert generated[0]["softwareAgent"] == "openai:sora-2"
    assert "temple" in generated[0]["parameters"]["prompt"]


def test_consent_travels_with_the_generated_assertion():
    """Not part of the C2PA spec, and the thing that makes this system
    different, so it rides along with the declaration."""
    manifest = cc.build_manifest(scenes(), title="Trip")
    actions = manifest["assertions"][0]["data"]["actions"]
    generated = next(a for a in actions
                     if a.get("parameters", {}).get("origin") == "recreated")
    assert generated["parameters"]["traveller_consented"] is True


def test_refusals_are_declared_though_no_standard_requires_it():
    """Nothing in C2PA asks what you did NOT generate. A film stating that two
    moments were left empty makes a claim no other generator makes."""
    manifest = cc.build_manifest(scenes(), title="Trip", gaps_left_empty=2)
    refusal = next(a for a in manifest["assertions"]
                   if a["label"] == "org.wanderos.refusals")
    assert refusal["data"]["moments_left_unfabricated"] == 2
    assert cc.summarise(manifest)["moments_left_unfabricated"] == 2


def test_seal_hash_is_carried_when_present():
    manifest = cc.build_manifest(scenes(), title="Trip", sealed_sha256="abc123")
    seal = next(a for a in manifest["assertions"] if a["label"] == "org.wanderos.seal")
    assert seal["data"]["sealed_sha256"] == "abc123"
    assert "Object Lock" in seal["data"]["storage"]


def test_summary_states_the_article_50_basis():
    summary = cc.summarise(cc.build_manifest(scenes(), title="Trip"))
    assert "Article 50" in summary["article_50"]
    assert summary["machine_readable"] is True


def test_attach_reports_failure_rather_than_claiming_compliance(tmp_path):
    """A compliance claim that did not happen is the one dishonesty this
    project cannot afford. Without a CA-issued cert this must say so."""
    film = tmp_path / "not-a-real-film.mp4"
    film.write_bytes(b"\x00" * 64)
    result = cc.attach(film, cc.build_manifest(scenes(), title="Trip"),
                       tmp_path / "out.mp4", work_dir=tmp_path / "certs")
    assert result["attached"] is False
    assert "reason" in result
    # The substantive disclosure is still present and is said so.
    assert "burned-in" in result["note"]
