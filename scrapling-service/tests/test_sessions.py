import pytest
import time
from scrapling_service.sessions import SessionManager, SessionInfo


class TestSessionManager:
    def setup_method(self):
        self.mgr = SessionManager(default_ttl_minutes=1)

    def test_create_session(self):
        info = self.mgr.create("test-session", mode="fast")
        assert info.name == "test-session"
        assert info.mode == "fast"
        assert info.created_at > 0

    def test_create_duplicate_raises(self):
        self.mgr.create("dup", mode="fast")
        with pytest.raises(ValueError, match="already exists"):
            self.mgr.create("dup", mode="fast")

    def test_list_sessions(self):
        self.mgr.create("a", mode="fast")
        self.mgr.create("b", mode="stealth")
        sessions = self.mgr.list_sessions()
        assert len(sessions) == 2
        names = {s.name for s in sessions}
        assert names == {"a", "b"}

    def test_get_session(self):
        self.mgr.create("my-session", mode="dynamic")
        info = self.mgr.get("my-session")
        assert info is not None
        assert info.mode == "dynamic"

    def test_get_missing_returns_none(self):
        assert self.mgr.get("nonexistent") is None

    def test_destroy_session(self):
        self.mgr.create("doomed", mode="fast")
        assert self.mgr.destroy("doomed") is True
        assert self.mgr.get("doomed") is None

    def test_destroy_missing_returns_false(self):
        assert self.mgr.destroy("ghost") is False

    def test_touch_updates_last_used(self):
        self.mgr.create("touchy", mode="fast")
        info_before = self.mgr.get("touchy")
        time.sleep(0.01)
        self.mgr.touch("touchy")
        info_after = self.mgr.get("touchy")
        assert info_after.last_used_at >= info_before.last_used_at

    def test_cleanup_expired(self):
        mgr = SessionManager(default_ttl_minutes=0)  # immediate expiry
        mgr.create("old", mode="fast")
        time.sleep(0.01)
        removed = mgr.cleanup_expired()
        assert removed == ["old"]
        assert mgr.get("old") is None
