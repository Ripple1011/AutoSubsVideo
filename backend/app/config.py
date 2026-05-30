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

    # Retention. Jobs older than this many days (by job-state file mtime) get
    # cleaned up — uploads folder + jobs JSON both removed. Sweep runs on
    # startup and at the start of each GET /jobs, so no background task is
    # needed. Set to 0 to disable cleanup entirely.
    retention_days: int = 14              # env: RETENTION_DAYS

    # Single-password gate for the API. When set, every mutating + listing
    # route requires an `X-AutoSub-Password` header matching this value.
    # Bypass paths (see main.py middleware): /health, /jobs/{id}/video,
    # and /export/soft — they're either monitoring or bytes-only downloads
    # that can't attach custom headers (the random 12-char job ID is the
    # soft secret in those cases). Leave unset for localhost dev; REQUIRED
    # for any internet-reachable deployment that uses a server-side
    # Gemini key (otherwise random visitors burn through your quota).
    shared_password: str | None = None    # env: SHARED_PASSWORD

    # --- Slice 2: Google OAuth auth -----------------------------------------
    # Both required for OAuth to work. Set in backend/.env after creating an
    # OAuth client at https://console.cloud.google.com/apis/credentials.
    google_oauth_client_id: str | None = None     # env: GOOGLE_OAUTH_CLIENT_ID
    google_oauth_client_secret: str | None = None # env: GOOGLE_OAUTH_CLIENT_SECRET

    # JWT signing secret for session cookies. Auto-generated on first boot
    # if unset (written back to .env so sessions survive restarts). Rotating
    # this invalidates every existing session — do it deliberately.
    jwt_secret: str | None = None                 # env: JWT_SECRET
    jwt_lifetime_seconds: int = 60 * 60 * 24 * 30  # 30 days
    # The base URL the OAuth callback redirects to. Must match an Authorized
    # Redirect URI in Google Cloud Console exactly. Localhost only for now;
    # set per-environment for VPS / production.
    oauth_callback_base: str = "http://localhost:8000"  # env: OAUTH_CALLBACK_BASE
    # Where to send the user after a successful OAuth login (frontend URL).
    oauth_success_redirect: str = "http://localhost:5173/projects"

    # --- Slice 3b: Razorpay -------------------------------------------------
    # India-native checkout. Test keys (rzp_test_*) for localhost; live
    # keys (rzp_live_*) only after the app is on a real domain with HTTPS
    # because Razorpay's webhook delivery requires it.
    razorpay_key_id: str | None = None        # env: RAZORPAY_KEY_ID
    razorpay_key_secret: str | None = None    # env: RAZORPAY_KEY_SECRET
    # Webhook secret comes later -- localhost can't receive Razorpay
    # webhooks without ngrok/cloudflared. For test mode we verify via the
    # client-side success handler's HMAC signature instead.
    razorpay_webhook_secret: str | None = None  # env: RAZORPAY_WEBHOOK_SECRET

    # Resend transactional email. RESEND_API_KEY drives sends; missing key
    # turns email into a silent no-op (we still log the skip). RESEND_FROM
    # is the verified sender address ("hello@vaacha.app") -- before the
    # domain is verified in Resend, leave it blank and we fall back to
    # the onboarding@resend.dev sandbox address.
    resend_api_key: str | None = None         # env: RESEND_API_KEY
    resend_from: str | None = None            # env: RESEND_FROM


def get_settings() -> Settings:
    return Settings()
