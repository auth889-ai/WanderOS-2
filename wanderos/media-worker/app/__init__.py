"""WanderOS media-worker.

Package layout mirrors the pipeline's stages, so each concern is findable and
independently testable rather than living in one flat module directory:

  config/     settings
  evidence/   extractors (PDF/voice/photo) · timeline · gaps · truth model
  reasoning/  the Claude access layer · the visual critic
  media/      Genblaze pipelines · provider chain · scene engine · composition
  trust/      hashing, ed25519 signing, Object Lock sealing, verification
  delivery/   the delivery pack (reel, cover, journal, cost)
  jobs/       the render-job state machine
  runtime/    SSE event plumbing
"""
