from __future__ import annotations

import time
from dataclasses import dataclass, field
from threading import Lock


@dataclass
class SessionInfo:
    """Metadata for a named scraping session."""

    name: str
    mode: str  # fast | stealth | dynamic
    created_at: float
    last_used_at: float
    ttl_minutes: float
    cookies: dict[str, str] = field(default_factory=dict)

    def is_expired(self) -> bool:
        if self.ttl_minutes <= 0:
            return True
        deadline = self.last_used_at + (self.ttl_minutes * 60)
        return time.time() > deadline

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "mode": self.mode,
            "createdAt": self.created_at,
            "lastUsedAt": self.last_used_at,
            "ttlMinutes": self.ttl_minutes,
            "cookies": self.cookies,
            "expired": self.is_expired(),
        }


class SessionManager:
    """Thread-safe manager for named scraping sessions with TTL-based expiry."""

    def __init__(self, default_ttl_minutes: float = 30):
        self._sessions: dict[str, SessionInfo] = {}
        self._scrapling_sessions: dict[str, object] = {}
        self._default_ttl = default_ttl_minutes
        self._lock = Lock()

    def create(
        self, name: str, mode: str, ttl_minutes: float | None = None
    ) -> SessionInfo:
        """Create a new named session. Raises ValueError if name is taken."""
        with self._lock:
            if name in self._sessions:
                raise ValueError(f"Session '{name}' already exists")
            now = time.time()
            info = SessionInfo(
                name=name,
                mode=mode,
                created_at=now,
                last_used_at=now,
                ttl_minutes=ttl_minutes if ttl_minutes is not None else self._default_ttl,
            )
            self._sessions[name] = info
            return info

    def get(self, name: str) -> SessionInfo | None:
        """Return session info by name, or None if not found."""
        with self._lock:
            return self._sessions.get(name)

    def list_sessions(self) -> list[SessionInfo]:
        """Return all active sessions."""
        with self._lock:
            return list(self._sessions.values())

    def destroy(self, name: str) -> bool:
        """Remove a session. Returns True if it existed, False otherwise."""
        with self._lock:
            if name not in self._sessions:
                return False
            del self._sessions[name]
            self._scrapling_sessions.pop(name, None)
            return True

    def touch(self, name: str) -> None:
        """Update last_used_at to now, extending the TTL window."""
        with self._lock:
            if name in self._sessions:
                self._sessions[name].last_used_at = time.time()

    def set_cookies(self, name: str, cookies: dict[str, str]) -> None:
        """Store cookies for a session."""
        with self._lock:
            if name in self._sessions:
                self._sessions[name].cookies = cookies

    def get_scrapling_session(self, name: str) -> object | None:
        """Return the underlying Scrapling session object, if any."""
        return self._scrapling_sessions.get(name)

    def set_scrapling_session(self, name: str, session: object) -> None:
        """Attach a Scrapling session object to a named session."""
        self._scrapling_sessions[name] = session

    def cleanup_expired(self) -> list[str]:
        """Remove all expired sessions. Returns list of removed names."""
        with self._lock:
            expired = [n for n, s in self._sessions.items() if s.is_expired()]
            for name in expired:
                del self._sessions[name]
                self._scrapling_sessions.pop(name, None)
            return expired
