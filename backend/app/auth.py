"""Authentication layer.

OAuth-only (Google) for now. fastapi-users handles the JWT + cookie session
backend; httpx-oauth handles the Google OAuth2 exchange. Users land in a
SQLite database at backend/data/users.db.

Endpoints exposed by this module's routers:
    GET  /auth/google/authorize  -> redirects browser to Google consent
    GET  /auth/google/callback   -> Google redirects back here; we set cookie
    POST /auth/logout            -> clears the cookie
    GET  /users/me               -> returns current user profile

Every job-related endpoint in main.py guards on `current_active_user`, so
each user only sees their own jobs.

Phase B intentionally does NOT include:
    - email/password login (OAuth-only by user choice)
    - email verification (OAuth-verified emails already trusted)
    - password reset (no password)
"""

import os
import secrets
import uuid
from pathlib import Path
from typing import AsyncGenerator, Optional

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from fastapi_users_db_sqlalchemy import SQLAlchemyBaseOAuthAccountTableUUID
from httpx_oauth.clients.google import GoogleOAuth2
from sqlalchemy import String
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import get_settings

# ----- Database -----------------------------------------------------------

DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
DATA_ROOT.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite+aiosqlite:///{DATA_ROOT / 'users.db'}"


class Base(DeclarativeBase):
    pass


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    """OAuth credentials per provider per user. fastapi-users-db-sqlalchemy
    expects this exact shape — table name and FK to users table inferred
    via the mixin."""


class User(SQLAlchemyBaseUserTableUUID, Base):
    """Application user. id is UUID, email + hashed_password +
    is_active/is_superuser/is_verified come from the mixin. We add an
    oauth_accounts back-ref so the OAuth router can attach Google identities.

    `hashed_password` exists from the mixin but we never set it (OAuth-only).
    It's harmless to leave; future email/password support drops in cleanly.
    """
    oauth_accounts: Mapped[list[OAuthAccount]] = relationship(
        "OAuthAccount", lazy="joined"
    )


engine = create_async_engine(DATABASE_URL, future=True)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def create_db_and_tables() -> None:
    """Create the SQLite tables on first boot. Safe to call repeatedly."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)


# ----- User manager --------------------------------------------------------

class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """The settings.reset_password_token_secret / verification_token_secret
    fields are still required by fastapi-users' constructor even when those
    flows aren't exposed. They sign internal tokens, not user passwords."""

    @property
    def reset_password_token_secret(self) -> str:
        return _jwt_secret()

    @property
    def verification_token_secret(self) -> str:
        return _jwt_secret()

    async def on_after_register(self, user: User, request: Optional[Request] = None) -> None:
        print(f"[auth] user registered: {user.email} ({user.id})", flush=True)
        # Grant the signup bonus + superuser dev allotment (when applicable).
        # Lazy import so credits.py can import from auth.py without a cycle.
        from .credits import (
            SOURCE_SIGNUP, SOURCE_SUPERUSER_DEV,
            SIGNUP_BONUS_CREDITS, SUPERUSER_DEV_CREDITS,
            grant_credits,
        )
        await grant_credits(user.id, SOURCE_SIGNUP, SIGNUP_BONUS_CREDITS)
        if user.is_superuser:
            await grant_credits(user.id, SOURCE_SUPERUSER_DEV, SUPERUSER_DEV_CREDITS)
            print(
                f"[auth] superuser dev grant: {SUPERUSER_DEV_CREDITS} credits → {user.email}",
                flush=True,
            )

    async def on_after_login(
        self,
        user: User,
        request: Optional[Request] = None,
        response=None,
    ) -> None:
        print(f"[auth] login: {user.email} ({user.id})", flush=True)


async def get_user_manager(user_db=Depends(get_user_db)):
    yield UserManager(user_db)


# ----- Auth backend (cookie + JWT) ----------------------------------------

def _jwt_secret() -> str:
    """Return the JWT signing secret. Auto-generate + persist to .env on
    first boot if unset, so sessions survive process restarts without the
    operator having to manage the secret manually."""
    s = get_settings()
    if s.jwt_secret:
        return s.jwt_secret
    # Generate and persist back to .env.
    new_secret = secrets.token_urlsafe(48)
    env_path = Path(__file__).resolve().parent.parent / ".env"
    line = f"JWT_SECRET={new_secret}\n"
    try:
        existing = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
        if "JWT_SECRET=" not in existing:
            with env_path.open("a", encoding="utf-8") as fh:
                if existing and not existing.endswith("\n"):
                    fh.write("\n")
                fh.write(line)
            print(f"[auth] generated JWT_SECRET (wrote to {env_path.name})", flush=True)
    except OSError as e:
        print(f"[auth] WARNING: could not persist JWT_SECRET to .env: {e}", flush=True)
    # Mutate the settings instance for this process so subsequent calls return
    # the same value without re-reading the file.
    os.environ["JWT_SECRET"] = new_secret
    get_settings.cache_clear() if hasattr(get_settings, "cache_clear") else None
    return new_secret


cookie_transport = CookieTransport(
    cookie_name="autosub_session",
    cookie_max_age=get_settings().jwt_lifetime_seconds,
    cookie_secure=False,        # localhost is HTTP; flip to True when HTTPS
    cookie_httponly=True,
    cookie_samesite="lax",
)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=_jwt_secret(),
        lifetime_seconds=get_settings().jwt_lifetime_seconds,
    )


auth_backend = AuthenticationBackend(
    name="cookie-jwt",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)


# ----- Google OAuth client -------------------------------------------------

def _google_oauth_client() -> GoogleOAuth2 | None:
    """Return the configured Google OAuth client, or None if credentials are
    not configured. Endpoints branch on this so the server still boots
    cleanly when OAuth isn't set up yet — the /auth/google/* routes just
    won't be mounted.

    Scopes: the library defaults to `openid` only, which is NOT enough to
    call Google's userinfo endpoint — that needs `userinfo.email` (and
    `userinfo.profile` for the display name). Without these, the token
    exchange succeeds but the subsequent get_id_email() raises
    GetIdEmailError and the callback 500s. Always request all three.
    """
    s = get_settings()
    if not (s.google_oauth_client_id and s.google_oauth_client_secret):
        return None
    return GoogleOAuth2(
        s.google_oauth_client_id,
        s.google_oauth_client_secret,
        scopes=[
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        ],
    )


google_oauth_client = _google_oauth_client()


# ----- FastAPIUsers facade -------------------------------------------------

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

# Dependency: requires an active user; 401 if no cookie or stale token.
current_active_user = fastapi_users.current_user(active=True)
# Optional variant: returns None instead of 401. Used by /health-style
# endpoints that work for guests AND authed users.
current_user_optional = fastapi_users.current_user(active=True, optional=True)


# ----- Legacy-job claim ----------------------------------------------------

async def claim_orphans_if_first_user(user: User) -> int:
    """If this user is the first registered user (smallest user id by creation
    order), assign every orphan job (no user_id field) to them. Idempotent —
    after the first call, all orphans are gone, so subsequent registrations
    do nothing.

    Returns the number of jobs claimed (0 unless this was the first user).
    """
    from sqlalchemy import select, func

    from .storage import claim_orphan_jobs

    async with async_session_maker() as session:
        # Count users by registration time — the first user gets the orphans.
        result = await session.execute(select(func.count(User.id)))
        count = result.scalar() or 0
    if count != 1:
        # Not the first user. Orphans stay invisible.
        return 0
    return claim_orphan_jobs(str(user.id))
