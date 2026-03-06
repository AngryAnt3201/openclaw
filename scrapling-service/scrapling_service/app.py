"""FastAPI application for the Scrapling sidecar service."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

from .config import ServiceConfig
from .fetchers import FetchRequest, LoginStep, ScraplingFetcher, VALID_MODES, VALID_OUTPUTS
from .sessions import SessionManager


# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------


class FetchBody(BaseModel):
    url: str
    mode: str = "fast"
    output: str = "markdown"
    session: str | None = None
    solve_cloudflare: bool = False
    timeout: int = 30
    proxy: str | None = None
    headless: bool = True

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v not in VALID_MODES:
            raise ValueError(f"Invalid mode '{v}'. Must be one of {VALID_MODES}")
        return v

    @field_validator("output")
    @classmethod
    def validate_output(cls, v: str) -> str:
        if v not in VALID_OUTPUTS:
            raise ValueError(f"Invalid output '{v}'. Must be one of {VALID_OUTPUTS}")
        return v


class ExtractBody(BaseModel):
    url: str
    selectors: dict[str, str]
    mode: str = "fast"
    output: str = "markdown"
    session: str | None = None
    solve_cloudflare: bool = False
    timeout: int = 30
    proxy: str | None = None
    headless: bool = True

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v not in VALID_MODES:
            raise ValueError(f"Invalid mode '{v}'. Must be one of {VALID_MODES}")
        return v

    @field_validator("output")
    @classmethod
    def validate_output(cls, v: str) -> str:
        if v not in VALID_OUTPUTS:
            raise ValueError(f"Invalid output '{v}'. Must be one of {VALID_OUTPUTS}")
        return v


class LoginStepBody(BaseModel):
    action: str
    selector: str
    value: str | None = None


class LoginBody(BaseModel):
    session: str
    url: str
    steps: list[LoginStepBody]
    mode: str = "dynamic"
    headless: bool = True
    timeout: int = 30000


class SessionCreateBody(BaseModel):
    name: str
    mode: str = "fast"
    ttl_minutes: float | None = None

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v not in VALID_MODES:
            raise ValueError(f"Invalid mode '{v}'. Must be one of {VALID_MODES}")
        return v


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app(config: ServiceConfig | None = None) -> FastAPI:
    """Create and return a configured FastAPI application."""
    cfg = config or ServiceConfig()
    app = FastAPI(title="Scrapling Service", version="0.1.0")

    sessions = SessionManager(default_ttl_minutes=cfg.session_ttl_minutes)
    fetcher = ScraplingFetcher()

    # -- Health ---------------------------------------------------------------

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "sessions": len(sessions.list_sessions()),
            "defaultMode": cfg.default_mode,
        }

    # -- Fetch ----------------------------------------------------------------

    @app.post("/fetch")
    async def fetch(body: FetchBody):
        req = FetchRequest(
            url=body.url,
            mode=body.mode,
            output=body.output,
            session=body.session,
            solve_cloudflare=body.solve_cloudflare,
            timeout=body.timeout,
            proxy=body.proxy or cfg.proxy,
            headless=body.headless,
        )
        result = await fetcher.fetch(req)
        return result.to_dict()

    # -- Extract --------------------------------------------------------------

    @app.post("/extract")
    async def extract(body: ExtractBody):
        req = FetchRequest(
            url=body.url,
            mode=body.mode,
            output=body.output,
            session=body.session,
            selectors=body.selectors,
            solve_cloudflare=body.solve_cloudflare,
            timeout=body.timeout,
            proxy=body.proxy or cfg.proxy,
            headless=body.headless,
        )
        result = await fetcher.fetch(req)
        return result.to_dict()

    # -- Login ----------------------------------------------------------------

    @app.post("/login")
    async def login(body: LoginBody):
        info = sessions.get(body.session)
        if info is None:
            raise HTTPException(status_code=404, detail=f"Session '{body.session}' not found")

        steps = [
            LoginStep(action=s.action, selector=s.selector, value=s.value)
            for s in body.steps
        ]
        result = await fetcher.login(
            url=body.url,
            steps=steps,
            mode=info.mode,
            headless=body.headless,
            timeout=body.timeout,
        )

        # Store cookies back into the session
        if result.cookies:
            sessions.set_cookies(body.session, result.cookies)
        sessions.touch(body.session)

        return result.to_dict()

    # -- Sessions -------------------------------------------------------------

    @app.post("/sessions", status_code=201)
    async def create_session(body: SessionCreateBody):
        try:
            info = sessions.create(
                name=body.name,
                mode=body.mode,
                ttl_minutes=body.ttl_minutes,
            )
        except ValueError:
            raise HTTPException(status_code=409, detail=f"Session '{body.name}' already exists")
        return info.to_dict()

    @app.get("/sessions")
    async def list_sessions():
        return [s.to_dict() for s in sessions.list_sessions()]

    @app.get("/sessions/{name}")
    async def get_session(name: str):
        info = sessions.get(name)
        if info is None:
            raise HTTPException(status_code=404, detail=f"Session '{name}' not found")
        return info.to_dict()

    @app.delete("/sessions/{name}")
    async def destroy_session(name: str):
        if not sessions.destroy(name):
            raise HTTPException(status_code=404, detail=f"Session '{name}' not found")
        return {"ok": True}

    return app
