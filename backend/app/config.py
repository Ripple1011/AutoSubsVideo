"""Server configuration loaded from environment.

Server-side defaults for ASR providers. User-supplied BYOK keys arrive via
request headers and take precedence over these values (see whisper_client.py).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ASR provider defaults
    asr_provider: str = "groq"            # "groq" | "openai"
    asr_model: str = "whisper-large-v3"   # provider-scoped default
    groq_api_key: str | None = None
    openai_api_key: str | None = None
    sarvam_api_key: str | None = None
    gemini_api_key: str | None = None

    # Infra
    redis_url: str = "redis://localhost:6379/0"
    celery_enabled: bool = False          # False = run pipeline inline in /upload.
                                          # True  = dispatch to Celery worker.

    # Upload limits
    max_video_seconds: int = 600          # 10 min personal cap


def get_settings() -> Settings:
    return Settings()
