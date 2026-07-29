# WanderOS — Master Document

*Single source of truth. Supersedes HACKATHON_RESEARCH.md and WANDEROS_WINNING_BLUEPRINT.md.*
*Last verified: 2026-07-29 by live probe, not by assumption.*

---

## 1. CURRENT CONDITION — measured, not claimed

Both servers run locally right now:

| Service | URL | State |
|---|---|---|
| Web app | http://localhost:3000 | HTTP 200 |
| Media worker | http://localhost:8000/health | healthy, `dev` tier |
| Database | local Postgres `wanderos` | 42 tables, migrations applied |
| Redis | localhost:6379 | PONG |

### Live capability probe — 12/14, every critical one working

```
WORKS   storage + Object Lock    Backblaze B2               wanderos-provenance
WORKS   reasoning / critic       Claude Sonnet 4.6          via AWS Bedrock
WORKS   reasoning fallback       OpenAI gpt-4o-mini
WORKS   PDF / itinerary          pypdf                      local, no entitlement
WORKS   voice transcription      OpenAI Whisper             whisper-1
WORKS   photo understanding      OpenAI vision              gpt-4o-mini
WORKS   image generation         AWS Bedrock Stability      stable-image-core-v1:1
WORKS   narration                AWS Polly                  neural voices
WORKS   video generation         OpenAI Sora                sora-2
WORKS   video (synthetic)        AWS Bedrock Luma Ray       luma.ray-v2:0
WORKS   video/image fallback     GMI Cloud                  configured, needs credits
WORKS   composition              ffmpeg                     local
BLOCKED PDF (rich/scanned)       AWS Textract               optional — pypdf covers it
BLOCKED photo labels             AWS Rekognition            optional — OpenAI vision is richer
```

Run it yourself: `cd wanderos/media-worker && python3 scripts/capability_report.py`

### Why it has *felt* poor

Not because it is weak — because **it was never visible**. Everything was verified in
terminal output; there was no running app, no URL, no screen. That is now fixed.
The honest remaining weaknesses are listed in §7.

---

## 2. WHAT IT IS

> WanderOS turns fragmented trip evidence into a traveler-approved film, asks
> permission before recreating anything it cannot prove, self-corrects bad
> generations, and seals the complete production lineage into Backblaze B2.

**The one thing no competitor does:** it negotiates the truth boundary before
generating. When the itinerary lists a sunset but no photo proves it, WanderOS
stops and asks instead of quietly inventing the memory.

### Positioning

- **Weak (occupied):** "upload photos, get an AI travel video" — Polarsteps has 22M+
  users doing exactly this with Trip Reels and Travel Books.
- **Strong:** post-trip Experience Autopilot for **tour operators**, who lose the
  customer relationship the moment a tour ends and have no scalable way to turn a
  real trip into branded, trustworthy, referral-driving content.

---

## 3. THE TRUTH MODEL — the differentiator

Every statement the film might make is a claim with a status. Generation is gated on it.

| Status | Meaning | May be recreated? |
|---|---|---|
| `VERIFIED` | photo evidence attests it | uses real media, no label |
| `INFERRED` | planned or plausible, unproven | **NO — ask the traveler** |
| `USER_CONFIRMED` | traveler confirmed it happened | yes, with disclosure |
| `SYNTHETIC` | story device, no real basis | yes, with disclosure |
| `CONTRADICTED` | sources disagree | NO — ask |
| `UNKNOWN` | cannot responsibly decide | omit or title card |

**Only the traveler can produce `USER_CONFIRMED`.** `truth.apply_consent()` is the
single place a status may be promoted — never client-side.

Verified working, real Claude on Bedrock:

```
[VERIFIED  ] 0.9  Two people spent time at the beach, swimming in the afternoon.
[INFERRED  ] 0.6  The traveler visited Uluwatu Temple for sunset viewing.
     ASK: "Your itinerary lists a sunset visit at 18:30, AND YOUR VOICE NOTE
           mentions making it up to the temple — but no photo confirms it. Did you go?"
[INFERRED  ] 0.4  The traveler had a seafood dinner at Jimbaran Bay.
     ASK: "...but no photo or voice note confirms this happened. Did you go?"

generatable BEFORE consent: []          <- the gate holds
generatable AFTER confirm : [sunset]    <- only what was confirmed
```

Claude raised the sunset to 0.6 **because the voice note corroborated the itinerary**,
and scored the uncorroborated dinner 0.4. Deterministic rules cannot do that.

---

## 4. ARCHITECTURE

```
Next.js UI  (upload · evidence · consent · storyboard · production · verify)
      |
LangGraph orchestrator  — 3 DURABLE interrupts, survive server restart
      |
  intake -> understand -> extract_evidence -> [CONSENT] ->
  detect_gaps -> plan_story -> [STORYBOARD] -> generate ->
  [FINAL APPROVAL] -> deliver
      |
      +-- Evidence plane   pypdf | OpenAI Whisper | OpenAI vision  (AWS optional)
      +-- Truth plane      Claude on Bedrock -> claim classification -> consent gate
      +-- Media plane      Genblaze Pipeline + AgentLoop + ChainProvider
      +-- Quality plane    Claude vision critic -> reject -> prompt patch / model switch
      |
Backblaze B2 — system of record
  trips/{id}/ source · analysis · generations/scene-N/attempt-N · evaluations
              · approvals · consent · delivery · provenance (Object Lock)
```

### Cross-provider failover (built, proven)

Genblaze's `fallback_models` only swaps models *within one provider*. `ChainProvider`
adds true cross-provider failover — one step, N links, first success wins:

```
image  AWS Bedrock -> OpenAI DALL-E -> GMI Seedream
video  OpenAI Sora -> GMI Kling -> GMI Seedance
audio  ElevenLabs -> AWS Polly -> OpenAI TTS -> GMI
```

Verified: two links killed, third served, lineage recorded `served_by` plus both failures.

---

## 5. API KEYS — what is actually needed

**Required (3 groups, 5 values):**

| Variable | Purpose |
|---|---|
| `B2_KEY_ID` + `B2_APPLICATION_KEY` | storage, Object Lock provenance |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Bedrock (Claude + images) + Polly |
| `OPENAI_API_KEY` | Sora video, Whisper, vision, DALL-E fallback |

**Optional:** `GMI_API_KEY` (needs credits), `ELEVENLABS_API_KEY` (premium TTS),
`GEMINI_API_KEY` (current planner), `ANTHROPIC_API_KEY` (only to bypass Bedrock).

**Not API keys:** `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, and the local
ed25519 `signing.key` / `signing.pub` pair.

> More providers ≠ better score. Judges score *meaningful* usage. Each model here
> has one defensible job; adding a twelfth provider is model-count theater.

---

## 6. USING THE $200 AWS CREDIT FULLY

Currently drawing on AWS: **Bedrock Claude** (reasoning + critic), **Bedrock Stability**
(images), **Polly** (narration). To use more of the credit meaningfully:

| Service | Job | Unblock needed |
|---|---|---|
| Bedrock Luma Ray | synthetic-scene video | IAM: S3 (async output) |
| Textract | scanned/photographed itineraries | IAM |
| Rekognition | face grouping for privacy controls | IAM |
| Transcribe | multi-speaker voice notes | IAM + S3 |
| Nova Multimodal Embeddings | Experience Graph semantic search | none |
| App Runner / Amplify | **the judge-facing deployed URL** | none |

**One console action unlocks four of these:**
IAM → Users → `wanderosmedia` → Add permissions → inline policy → paste
`wanderos/media-worker/aws-iam-policy.json`

Bedrock Claude access is already granted (the Anthropic use-case form was submitted).

**Blocked permanently:** Nova Reel (image-to-video) is LEGACY in all 33 Bedrock
regions — verified by exhaustive scan. Region changes cannot fix it. Sora covers this.

---

## 7. HONEST GAPS

1. **Not deployed** — judges require a working URL. AWS credits cover this.
2. **Zero Python tests** — real weakness against the Production Readiness criterion.
3. **Render job uses a daemon thread**, not a durable queue; state mirrors to B2 but an
   interrupted job does not self-resume.
4. **No real end-to-end run with actual trip files** — only synthetic fixtures so far.
5. **No external user validation** — no operator interview, no pilot.

---

## 8. COMPETITIVE INTELLIGENCE (verified links)

| Project | What it is | Beatable because |
|---|---|---|
| [cinemory](https://github.com/upgradedev/cinemory) | photos → Kling clips → sealed reel; live on Cloud Run, 60 commits, security CI | no critic loop, single provider, self-rolled boto3 provenance, no consent gate, photos-only intake. **Its ops hygiene is the bar to match.** |
| [bankers-wrapped](https://github.com/iarjunganesh/bankers-wrapped) | CSV → financial recap video; 12 ADRs, ~99% coverage | gimmick problem; no AgentLoop; README claims Genblaze-only but TTS calls OpenAI directly |
| [backblaze-proofframe](https://github.com/adjcjh777/backblaze-proofframe) | provenance ops desk | mock-mode only. **Copy its Judge Mode discipline.** |
| [consensus-media-gen](https://github.com/Cubiczan/consensus-media-gen) | multi-model consensus | TS reimplementation, not the real SDK |
| [rescue-reel](https://github.com/mytodd1-dotcom/rescue-reel) | rescue campaigns with approval gate | early (5 commits) |

**Corrections to earlier claims (both were wrong):**
- "No competitor uses Object Lock" — **false.** Waystation ships it with compliance
  retention and a delete-proof script. Object Lock alone is table stakes.
- "Nobody uses AgentLoop" — unprovable absolute across 1,144 entrants. Say
  "rarely surfaced as a visible refinement loop in the public projects reviewed."

### Winning patterns worth stealing (from prior hackathon winners)

- **Tailored Labs** (Grand Prize): judges want an *editable workflow*, not a
  regenerate-everything button → scene-level surgery.
- **Living Memory**: voice interview extracts emotional context a form never will.
- **VideoGen-Agent**: AI decides *structure*; deterministic ffmpeg decides *final
  composition*. Never let AI blindly render the whole film.
- **From Seed** (Audience Choice): 15 coherent seconds beat 60 incoherent ones →
  4 excellent scenes, not 8 mediocre ones.

### Official resources

- SDK: https://github.com/backblaze-labs/genblaze — `docs/features/agents.md`,
  `trust-modes.md`, `manifest-provenance.md`, `object-storage.md`
- Samples: [multi-provider](https://github.com/backblaze-labs/genblaze-gen-media-multi-provider-sample) ·
  [gmicloud](https://github.com/backblaze-labs/genblaze-gmicloud-pipeline)
- Blog: ["the pipeline is becoming the moat"](https://www.backblaze.com/blog/introducing-genblaze-a-python-sdk-for-generative-media-pipelines/)
- Devpost: https://backblaze-generative-media.devpost.com/ — **Aug 3, 5:00 PM EDT**

---

## 9. JUDGING CRITERIA → OUR EVIDENCE

| Criterion | Evidence |
|---|---|
| Real-World Utility | real multi-modal evidence in, operator-ready film out; consent solves the 2026 trust problem |
| Production Readiness | 3 durable interrupts surviving restart, cross-provider failover, idempotent job POST, honest degradation everywhere, live capability probe |
| B2 Storage & Orchestration | every source, attempt (incl. rejected), verdict, approval, consent record and final asset addressable; **per-object COMPLIANCE Object Lock**, verified delete-proof |
| Genblaze Usage | Pipeline + StepCache + SSE tracer + ObjectStorageSink + **AgentLoop with a real Claude vision critic** + a **custom SyncProvider written for AWS** (no official adapter exists) |

**Honest provenance wording — use this, never overclaim:**
> "Tamper-evident after publication, with signed generation lineage and
> scene-level disclosure."
>
> NOT "provably real" / "can never be faked" / "proves the trip happened."

---

## 10. REMAINING BUILD ORDER

1. **Deploy** — App Runner/Amplify on AWS credits → the judge URL *(blocks submission)*
2. **Tests** — truth-policy gate, chain failover, tamper detection, idempotency
3. **Real end-to-end run** — actual photos + a real PDF + a real voice note
4. **Judge Mode** — preloaded trip, cached fast path, one live regeneration
5. **Public /verify page** — one-click verify + download-tampered-copy
6. **Fresh public repo** — no WanderOS-2 history, secrets purged, keys rotated
7. **Demo video** (~3 min) + Devpost

### 3-minute demo script

```
0:00-0:20  126 scattered photos, one PDF, one voice note. Nobody builds the story.
0:20-0:45  Upload -> real B2 paths appear
0:45-1:10  Timeline + claims: 5 VERIFIED, 1 INFERRED sunset -> the system ASKS
1:10-1:30  Consent + storyboard approval with cost estimate
1:30-2:00  Live AgentLoop: attempt 1 rejected (0.62, reason) -> repair -> 0.91 accepted
2:00-2:25  The film plays
2:25-2:45  Passport: attempts, verdicts, consent, Object Lock retention
2:45-3:00  Tamper demo: original green, modified copy red
```

---

## 11. SECURITY — ACT BEFORE ANY PUBLIC PUSH

Exposed in chat/zips during development and **must be rotated**:
AWS root password · AWS access keys · B2 master + app keys · GMI key · OpenAI key ·
Gemini key · the old ed25519 signing key *(already rotated once)*.

Then: `gitleaks detect --source . --verbose` before the fresh repo push.
`WanderOS-2` is a **public** remote — do not push competitive analysis to it.
