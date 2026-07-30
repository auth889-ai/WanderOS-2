"""Central settings — reads wanderos/.env plus media-worker/.env (later wins)."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT.parent / ".env", ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Backblaze B2
    b2_region: str = "us-west-004"
    b2_key_id: str = ""
    b2_application_key: str = ""
    b2_bucket_media: str = "wanderos-media"
    b2_bucket_provenance: str = "wanderos-provenance"
    b2_bucket_intermediate: str = "wanderos-intermediate"
    b2_bucket_logs: str = "wanderos-logs"
    parquet_dir: str = "/tmp/wanderos/parquet"   # queryable run history (ParquetSink)
    otel_enabled: bool = False                   # add an OTelTracer rung when true
    step_max_retries: int = 2                    # resumes a prediction, never re-submits
    step_timeout_sec: int = 600                  # one provider step
    pipeline_timeout_sec: int = 900              # whole run — bounds a stuck poll
    object_lock_days: int = 30  # COMPLIANCE retention applied per publish record

    # Providers — each configured key becomes a live link in the failover chain
    gmi_api_key: str = ""
    gemini_api_key: str = ""
    elevenlabs_api_key: str = ""
    nvidia_api_key: str = ""
    openai_api_key: str = ""

    # AWS — Bedrock (Stability image) + Polly (narration). Bedrock image runs in
    # us-west-2: the Stability text-to-image models are ACTIVE there, while Nova
    # Canvas/Reel are LEGACY and refuse InvokeModel on cold accounts.
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    bedrock_region: str = "us-west-2"
    polly_voice: str = "Joanna"
    aws_staging_bucket: str = ""  # S3 bucket Transcribe/Luma read+write (async APIs need S3)

    # Claude critic (Experience Director's quality gate)
    anthropic_api_key: str = ""
    critic_model: str = "claude-opus-5"
    critic_threshold: float = 0.85
    max_scene_attempts: int = 3

    # Pipeline behavior
    pipeline_tier: str = "mock"  # mock | dev | final
    step_cache_dir: str = str(ROOT / ".cache" / "genblaze")
    manifest_signing_key_path: str = str(ROOT / "keys" / "signing.key")

    # Infra
    redis_url: str = "redis://localhost:6379"
    demo_force: bool = False  # forces one real critic-reject + one provider fallback per run

    @property
    def b2_configured(self) -> bool:
        return bool(self.b2_key_id and self.b2_application_key)


settings = Settings()
