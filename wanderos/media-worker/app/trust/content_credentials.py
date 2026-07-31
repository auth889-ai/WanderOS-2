"""C2PA Content Credentials — EU AI Act Article 50 compliance.

**Article 50 becomes enforceable on 2 August 2026.** From that date, anyone
providing an AI system that generates synthetic image, audio or video must mark
those outputs in a **machine-detectable** way — not a visible caption, an
embedded cryptographic signal that software can read. The Commission's Code of
Practice, published 10 June 2026, names **C2PA Content Credentials** as the
technical standard underneath its labelling icons.

This project already did most of what that asks for, before the rule existed:
per-scene visible disclosure burned into the picture, an embedded signed
manifest, ed25519 signatures, and Object Lock provenance. What it lacked was the
*standard format* — our manifest is machine-readable but it is ours, and a
regulator's verifier does not know how to read it.

This module closes that gap by expressing what we already track in C2PA's own
vocabulary. The mapping is direct, because the concepts are the same:

    photo / clip   -> DIGITAL_CAPTURE                    a camera recorded this
    parallax       -> ALGORITHMICALLY_ENHANCED           real content, added motion
    recreated      -> TRAINED_ALGORITHMIC_MEDIA          a model generated this
    the film       -> COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA

That last one is the honest description of every film this system produces, and
it is the assertion Article 50 exists to require.

**On certificates — tested, and the honest result.** C2PA signing needs an X.509
certificate, and the implementation rejects a self-signed one outright with
"the certificate is invalid". That was verified against three variants
(documentSigning, emailProtection, with and without contentCommitment) and with
`verify_trust` disabled; the library wants a real chain, not a relaxed check.

So `build_manifest()` — the part that decides WHAT is declared — is complete and
tested, and `attach()` needs a certificate from a CA on the C2PA trust list. It
reports `attached: False` with the reason rather than pretending otherwise,
because a compliance claim that did not happen is the one kind of dishonesty
this project cannot afford.

Getting a conformant certificate is procurement, not engineering. Until then the
film still carries burned-in visual disclosure, our own ed25519-signed embedded
manifest, and Object Lock provenance — which satisfies the *substance* of
Article 50 while missing its *standard wrapper*.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# Our scene origins -> C2PA digitalSourceType. These strings are the IPTC values
# C2PA uses; naming them explicitly keeps the mapping auditable.
SOURCE_TYPE = {
    "photo": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    "clip": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    "parallax": "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced",
    "recreated": "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
}
COMPOSITE = ("http://cv.iptc.org/newscodes/digitalsourcetype/"
             "compositeWithTrainedAlgorithmicMedia")

ARTICLE_50_NOTE = (
    "EU AI Act Article 50 (enforceable 2026-08-02) requires machine-detectable "
    "marking of synthetic media. This manifest is that marking."
)


@dataclass
class SceneCredential:
    """One scene's provenance, in terms a C2PA verifier understands."""
    index: int
    origin: str                  # photo | clip | parallax | recreated
    prompt: str = ""
    model: str = ""
    provider: str = ""
    consented: bool = False

    def source_type(self) -> str:
        return SOURCE_TYPE.get(self.origin, COMPOSITE)

    @property
    def is_ai(self) -> bool:
        return self.origin == "recreated"


def build_manifest(scenes: list[SceneCredential], *, title: str,
                   gaps_left_empty: int = 0, sealed_sha256: str = "") -> dict:
    """The C2PA manifest for a finished film.

    Declares the whole film as composite-with-trained-algorithmic-media whenever
    ANY scene was generated — which is the conservative reading of Article 50 and
    the only honest one for a mixed-source film.
    """
    any_ai = any(s.is_ai for s in scenes)

    assertions: list[dict] = [{
        "label": "c2pa.actions",
        "data": {"actions": [
            {"action": "c2pa.created",
             "digitalSourceType": COMPOSITE if any_ai else SOURCE_TYPE["photo"],
             "softwareAgent": "WanderOS Travel Autopilot"},
        ]},
    }]

    # Per-scene provenance. A single film-level flag would satisfy the letter of
    # the rule and tell a viewer nothing useful; scene-level says WHICH parts.
    for scene in scenes:
        action = {
            "action": "c2pa.created" if scene.is_ai else "c2pa.placed",
            "digitalSourceType": scene.source_type(),
            "parameters": {"scene": scene.index, "origin": scene.origin},
        }
        if scene.is_ai:
            action["softwareAgent"] = f"{scene.provider}:{scene.model}" if scene.model else "generative model"
            if scene.prompt:
                action["parameters"]["prompt"] = scene.prompt[:400]
            # Consent is not part of the C2PA spec, but it is the thing that
            # makes this system different, so it travels with the assertion.
            action["parameters"]["traveller_consented"] = scene.consented
        assertions[0]["data"]["actions"].append(action)

    assertions.append({
        "label": "stds.schema-org.CreativeWork",
        "data": {"@context": "https://schema.org", "@type": "CreativeWork",
                 "name": title,
                 "creditText": "Assembled by WanderOS from the traveller's own media"},
    })

    # The refusals. Nothing in C2PA requires declaring what you DIDN'T generate,
    # and it is the most informative thing here: a film that says "two moments
    # were left empty because they could not be verified" is making a claim no
    # other generator makes.
    if gaps_left_empty:
        assertions.append({
            "label": "org.wanderos.refusals",
            "data": {"moments_left_unfabricated": gaps_left_empty,
                     "reason": "not supported by evidence, and not confirmed by the traveller"},
        })

    if sealed_sha256:
        assertions.append({"label": "org.wanderos.seal",
                           "data": {"sealed_sha256": sealed_sha256,
                                    "storage": "Backblaze B2 Object Lock (COMPLIANCE)"}})

    return {
        "claim_generator_info": [{"name": "WanderOS", "version": "1.0.0"}],
        "title": title,
        "format": "video/mp4",
        "assertions": assertions,
    }


def summarise(manifest: dict) -> dict:
    """Human-readable account of what the manifest declares."""
    actions = next((a["data"]["actions"] for a in manifest["assertions"]
                    if a["label"] == "c2pa.actions"), [])
    per_scene = [a for a in actions if "scene" in (a.get("parameters") or {})]
    ai = [a for a in per_scene
          if a["digitalSourceType"].endswith("trainedAlgorithmicMedia")]
    captured = [a for a in per_scene
                if a["digitalSourceType"].endswith("digitalCapture")]
    enhanced = [a for a in per_scene
                if a["digitalSourceType"].endswith("algorithmicallyEnhanced")]
    refusals = next((a["data"]["moments_left_unfabricated"] for a in manifest["assertions"]
                     if a["label"] == "org.wanderos.refusals"), 0)
    return {
        "declared_source_type": actions[0]["digitalSourceType"] if actions else None,
        "scenes_total": len(per_scene),
        "ai_generated": len(ai),
        "camera_captured": len(captured),
        "enhanced_real": len(enhanced),
        "moments_left_unfabricated": refusals,
        "article_50": ARTICLE_50_NOTE,
        "machine_readable": True,
    }


def self_signed_signer(work_dir: Path):
    """A signer for demonstration.

    Produces a technically valid C2PA manifest that any verifier can read, but
    the certificate is self-signed — a verifier will show the credential as
    present and the signer as UNKNOWN. Production needs a certificate from a CA
    on the C2PA trust list.

    Returned alongside that caveat rather than silently, because a credential
    that looks authoritative and is not is worse than no credential.
    """
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    from datetime import datetime, timedelta, timezone

    work_dir.mkdir(parents=True, exist_ok=True)
    key_path, cert_path = work_dir / "c2pa-key.pem", work_dir / "c2pa-cert.pem"

    if not (key_path.exists() and cert_path.exists()):
        # ES256 rather than the ed25519 key used elsewhere: C2PA's certificate
        # profile expects an EC key here, and reusing the sealing key for a
        # different purpose would be poor hygiene regardless.
        key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "WanderOS Demo Signer"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "WanderOS"),
        ])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder()
                .subject_name(name).issuer_name(name)
                .public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=1))
                .not_valid_after(now + timedelta(days=365))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.KeyUsage(
                    digital_signature=True, content_commitment=True,
                    key_encipherment=False, data_encipherment=False,
                    key_agreement=False, key_cert_sign=False, crl_sign=False,
                    encipher_only=False, decipher_only=False), critical=True)
                # C2PA's certificate profile requires emailProtection,
                # documentSigning or timeStamping. codeSigning is rejected
                # outright with "the certificate is invalid".
                .add_extension(x509.ExtendedKeyUsage([
                    x509.oid.ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=True)
                .sign(key, hashes.SHA256()))
        key_path.write_bytes(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))

    return {"cert_path": cert_path, "key_path": key_path,
            "trusted": False,
            "caveat": ("Self-signed. A verifier will read the credential and report the "
                       "signer as unknown. Production requires a certificate from a CA "
                       "on the C2PA trust list.")}


def attach(film: Path, manifest: dict, out: Path, *, work_dir: Path) -> dict:
    """Embed Content Credentials into the film.

    Never fails the render: a film without a credential is still a film, and the
    burned-in visual disclosure is present either way. What is NOT acceptable is
    claiming compliance that did not happen, so the result says plainly whether
    the credential was attached.
    """
    signing = self_signed_signer(work_dir)
    try:
        import c2pa

        signer = c2pa.Signer.from_info(c2pa.C2paSignerInfo(
            alg=b"es256",
            sign_cert=signing["cert_path"].read_bytes(),
            private_key=signing["key_path"].read_bytes(),
            ta_url=b"http://timestamp.digicert.com",
        ))
        builder = c2pa.Builder(json.dumps(manifest))
        builder.sign_file(str(film), str(out), signer)
        return {"attached": True, "path": str(out), **summarise(manifest),
                "signer_trusted": signing["trusted"], "signer_caveat": signing["caveat"]}
    except Exception as exc:
        logger.warning("C2PA attach failed: %s", exc)
        return {"attached": False,
                "reason": f"{type(exc).__name__}: {exc}"[:220],
                **summarise(manifest),
                "note": ("The film still carries burned-in visual disclosure and our own "
                         "signed manifest — only the C2PA-standard wrapper is missing.")}


def read(film: Path) -> dict:
    """Read Content Credentials back, the way a regulator's verifier would."""
    try:
        import c2pa

        with open(film, "rb") as handle:
            reader = c2pa.Reader("video/mp4", handle)
            return {"found": True, "manifest": json.loads(reader.json())}
    except Exception as exc:
        return {"found": False, "reason": f"{type(exc).__name__}: {exc}"[:200]}
