"""Entrypoint for running the sidecar via `python -m scrapling_service.server`."""
from __future__ import annotations

import os

import uvicorn

from .app import create_app
from .config import ServiceConfig


def main() -> None:
    cfg = ServiceConfig(
        host=os.environ.get("SCRAPLING_HOST", "0.0.0.0"),
        port=int(os.environ.get("SCRAPLING_PORT", "18790")),
        default_mode=os.environ.get("SCRAPLING_DEFAULT_MODE", "fast"),
        timeout_seconds=int(os.environ.get("SCRAPLING_TIMEOUT", "30")),
        session_ttl_minutes=float(os.environ.get("SCRAPLING_SESSION_TTL", "30")),
        proxy=os.environ.get("SCRAPLING_PROXY"),
    )
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="info")


if __name__ == "__main__":
    main()
