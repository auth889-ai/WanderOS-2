# Backblaze Generative Media Hackathon — Research Report (2026-07-28)

Deadline: Aug 3 2026, 5pm ET (Devpost). Winners Aug 12. $10k prizes.
Judging: Real-World Utility, Production Readiness, B2 Storage/Data Orchestration, meaningful Genblaze SDK usage.

## (a) Verified sources

Official:
- https://github.com/backblaze-labs/genblaze (SDK, ~475 stars, active)
- https://github.com/backblaze-labs/genblaze-gen-media-multi-provider-sample
- https://github.com/backblaze-labs/genblaze-gmicloud-pipeline
- https://www.backblaze.com/blog/introducing-genblaze-a-python-sdk-for-generative-media-pipelines/ ("the pipeline is becoming the moat")
- https://www.backblaze.com/blog/backblaze-generative-media-hackathon-build-with-b2-genblaze-and-gmi-cloud/
- https://backblaze-generative-media.devpost.com/
- SDK docs: docs/features/{agents,iteration,trust-modes,manifest-provenance,object-storage,retry-policy,streaming,parquet-sink,moderation,queue-integration}.md

Competitors (all verified live):
- https://github.com/upgradedev/cinemory (strongest)
- https://github.com/iarjunganesh/bankers-wrapped
- https://github.com/mytodd1-dotcom/rescue-reel
- https://github.com/adjcjh777/backblaze-proofframe
- https://github.com/Cubiczan/consensus-media-gen
- Also: nexicturbo/proofframe, tobowers/genblaze-explainer, OrionArchitekton/reprise,
  Abhinav0905/Incidentlens, lucylow/VeriGen-Genblaze-on-B2, woadi-vector/reel,
  reach-Harishapc/Genblaze-Studio-QC

## (b) Genblaze SDK — exact primitives

- Pipeline: `Pipeline("name").step(Provider(), model=..., prompt=..., modality=Modality.VIDEO).run(sink=storage, timeout=600)`;
  `.stream()` typed events; `chain=True` auto-threads outputs; `max_concurrency=N` fan-out;
  fallback chains fire on MODEL_ERROR; `Pipeline.from_result()` for iteration chains.
- AgentLoop (docs/features/agents.md):
  - Factory: `def build_pipeline(ctx: AgentContext) -> Pipeline`
    - ctx.iteration (0-based), ctx.prior_results (all PipelineResults), ctx.last_evaluation (None on iter 0)
    - canonical pattern: append `ctx.last_evaluation.feedback` to the prompt each iteration
  - Evaluator returns `EvaluationResult(passed: bool, score: float, feedback: str)`
  - Stops when any: `evaluation.passed == True`; `max_iterations` reached;
    pipeline error with `stop_on_pipeline_failure=True` (default)
  - Lineage: each iteration manifest carries `parent_run_id` -> previous attempt
    (iter0 run A parent None -> iter1 run B parent A); parent_run_id excluded from canonical hash
  - Docs show vision-model-as-judge, streaming events, cost tracking examples
- Manifest: canonical SHA-256 provenance doc; `manifest.verify()` requires byte-backed SHA-256
  on all outputs; `manifest.verify_hash()` hash-only; embeddable into media (Mp4Handler);
  `genblaze replay manifest.json`; `genblaze verify video.mp4 [--fetch]`
- Trust modes: Mode 1 "Integrity" (shipping, default); Mode 2 "Authenticated Integrity"
  (Ed25519, roadmap); Mode 3 "Standards-Verifiable" (C2PA, roadmap).
  URL-only assets fail verify(); byte-backed pass.
- ObjectStorageSink: `ObjectStorageSink(S3StorageBackend.for_backblaze("bucket"), key_strategy=KeyStrategy.HIERARCHICAL)`;
  content-addressable layouts; Object Lock support in genblaze-s3; ParquetSink for queryable run history.
- StepCache: step-level caching in genblaze-core.

Official sample flows:
1. multi-provider sample: prompt -> LLM storyboard (response_format=StoryboardSpec) ->
   per-scene fan-out (max_concurrency=3) keyframes/clips/TTS/music -> compose MP4 ->
   manifest embedded via Mp4Handler; B1/B2 stages share slug + parent run IDs; SSE to Next.js UI.
   Does NOT heavily use AgentLoop, fallback chains, or StepCache.
2. gmicloud pipeline: generate -> iterate -> approve (human gate) -> 3-model video fan-out -> verify.
   All Genblaze imports confined to one ~100-line pipelines.py, enforced by structural tests; no boto3.

## (c) Competitors

| Repo | What | Strengths | Weaknesses |
|---|---|---|---|
| cinemory | Photos -> Kling I2V clips -> seedance bridges -> beat assembly -> sealed reel; FastAPI+React; live on Cloud Run | 60 commits, live deploy, offline-verifiable SHA-256 seals, contract tests, security suite, graceful degradation | See (e) |
| bankers-wrapped | CSV/Plaid -> personality -> 5-scene narrated recap; 4 async agents; B2 truth store; 12 ADRs; 99% coverage | Polish, Genblaze-only provider access, NIM fallback | Gimmick problem (weak utility); no AgentLoop; no Object Lock; hand-rolled agents; sandbox-only Plaid |
| rescue-reel | Rescue intake -> campaign media with audit trail | Real utility angle; approval gate | 5 commits, local-only, thin |
| backblaze-proofframe | Provenance media vault / ops desk | Fail-closed gates, checklists | Mock-only public demo; no proven live E2E; compliance over features |
| consensus-media-gen | Multi-model image consensus -> B2 | State machine, realtime UI | No AgentLoop; vague scoring; TS reimplementation not the real SDK; 5 commits; no tests |

## (d) 5 patterns a 1st-place submission needs

1. AgentLoop as the visible brain — build_pipeline(ctx) + vision evaluator + max_iterations +
   parent_run_id chain rendered in UI. NO official sample or competitor showcases AgentLoop.
2. Per-scene concurrent fan-out with provider fallback chains (GMI Cloud primary + fallback on MODEL_ERROR).
3. Manifest lineage graph, embedded + sealed: intake->timeline->scenes->film parent_run_id chain,
   Mp4Handler embed, manifest.verify() green, B2 Object Lock seal (NO competitor uses Object Lock).
4. B2 as source of truth + queryable data plane: hierarchical KeyStrategy, ParquetSink/JSONL run
   history powering the Experience Graph, StepCache so re-runs skip paid generation.
5. Clean SDK boundary + streaming UX: all Genblaze imports in one pipelines.py + structural test;
   .stream() -> SSE live progress; human approval interrupt before expensive fan-out.

## (e) Cinemory weaknesses we beat

1. No AgentLoop / no quality feedback loop (generate-once).
2. Custom provenance chaining + raw boto3 instead of SDK-native Manifest.verify()/genblaze-s3.
3. No Object Lock / immutability — seals prove integrity only.
4. Single provider (GMI Cloud only); multi-provider is roadmap, not built; no fallback chains.
5. Photos-only, synthetic-data demo vs our multi-modal evidence (photos+PDF+voice) verified timeline.
6. Offline demo runs a deterministic "fake stitcher"; our composer produces the real film locally.

## 48-hour parallel plan (4 independent streams)

- A (~10h): AgentLoop scene refinement — wrap scene gen in AgentLoop(build_pipeline, vision_judge,
  max_iterations=3); show iteration/score/feedback/parent_run_id in UI. Touches media engine only.
- B (~6h): fan-out max_concurrency=3 + fallback chain + StepCache. Pipeline builder module only.
- C (~8h): canonical Manifest everywhere, Mp4Handler embed, parent_run_id chain intake->film,
  B2 Object Lock seal, Verify page running manifest.verify() + lineage graph. Extends P5 sealing.
- D (~8h): single pipelines.py boundary + structural test, SSE streaming UI, demo script,
  README with judging-criteria mapping, ParquetSink/JSONL history for Experience Graph endpoint.
- Final 6h serial: live E2E on real B2, demo video, Devpost submission (Aug 3 5pm ET).

Note on AWS credits: storage must stay on B2 (judged criterion); AWS credits are fine for
hosting/compute only.

## Pitch: problem, billion-dollar path, winning position

Problem: post-trip evidence (300+ photos, booking PDFs, voice notes) is never assembled;
existing tools make dumb slideshows. 2026 twist: generative media is untrustworthy.
Travel Autopilot = verified memory film — every frame traces via manifest chain to real
evidence, sealed in B2 Object Lock. Audiences: travelers, creators (provable authenticity),
claims/visa evidence timelines, tour operators.

Billion-dollar path (ExperienceOS): films are the wedge; every processed trip yields
structured verified experience data -> Experience Graph (proprietary dataset) ->
platform layer (verified recommendations, creator marketplaces, claims automation,
proof-of-experience APIs). Travel = $1.9T industry with no verified experience data layer.
"The pipeline is becoming the moat" (Backblaze's own framing).

Winning position vs 1,145 participants: the two highest-leverage unclaimed gaps are
AgentLoop (nobody uses it, not even official samples) and B2 Object Lock (no competitor).
Claim both, match cinemory's production polish (deployed URL, SSE, tests, approval gate),
tell the stronger multi-modal real-evidence story.

Architecture (repo reality + 48h additions):
intake UI -> B2 originals -> LangGraph brain (intake/timeline/gaps/planner + durable
storyboard interrupt) -> Genblaze layer in single pipelines.py (per-scene fan-out
max_concurrency=3, GMI Cloud primary + fallback chain on MODEL_ERROR, AgentLoop per scene
with vision judge EvaluationResult(passed,score,feedback) max_iterations=3, StepCache)
-> film composer (Pillow overlay) -> 7-step sealing (canonical Manifest, Mp4Handler embed,
manifest.verify(), B2 Object Lock) -> Experience Graph API over ParquetSink/JSONL history
-> public Verify page showing lineage graph.

Submission mechanics: working app URL (host on AWS credits; storage stays B2), ~3-min demo,
providers/models list, B2+Genblaze explanation, star genblaze repo, file one thoughtful
Genblaze issue (feeds 10-team mentorship feedback prize).
