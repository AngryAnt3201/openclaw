from dataclasses import dataclass


@dataclass
class ServiceConfig:
    host: str = "0.0.0.0"
    port: int = 18790
    default_mode: str = "fast"  # fast | stealth | dynamic
    timeout_seconds: int = 30
    session_ttl_minutes: int = 30
    proxy: str | None = None
