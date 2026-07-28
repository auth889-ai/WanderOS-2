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

    # Providers
    gmi_api_key: str = ""
    gemini_api_key: str = ""
    elevenlabs_api_key: str = ""
    nvidia_api_key: str = ""

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
