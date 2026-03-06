import pytest
from httpx import AsyncClient, ASGITransport
from scrapling_service.app import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
class TestHealthEndpoint:
    async def test_health(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "sessions" in data


@pytest.mark.asyncio
class TestSessionEndpoints:
    async def test_create_session(self, client):
        resp = await client.post("/sessions", json={"name": "s1", "mode": "fast"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "s1"
        assert data["mode"] == "fast"

    async def test_create_duplicate_session(self, client):
        await client.post("/sessions", json={"name": "dup", "mode": "fast"})
        resp = await client.post("/sessions", json={"name": "dup", "mode": "fast"})
        assert resp.status_code == 409

    async def test_list_sessions(self, client):
        await client.post("/sessions", json={"name": "a", "mode": "fast"})
        await client.post("/sessions", json={"name": "b", "mode": "stealth"})
        resp = await client.get("/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    async def test_get_session(self, client):
        await client.post("/sessions", json={"name": "detail", "mode": "dynamic"})
        resp = await client.get("/sessions/detail")
        assert resp.status_code == 200
        assert resp.json()["name"] == "detail"

    async def test_get_missing_session(self, client):
        resp = await client.get("/sessions/ghost")
        assert resp.status_code == 404

    async def test_destroy_session(self, client):
        await client.post("/sessions", json={"name": "doomed", "mode": "fast"})
        resp = await client.delete("/sessions/doomed")
        assert resp.status_code == 200
        resp2 = await client.get("/sessions/doomed")
        assert resp2.status_code == 404

    async def test_destroy_missing_session(self, client):
        resp = await client.delete("/sessions/ghost")
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestFetchEndpointValidation:
    async def test_fetch_requires_url(self, client):
        resp = await client.post("/fetch", json={})
        assert resp.status_code == 422

    async def test_fetch_rejects_invalid_mode(self, client):
        resp = await client.post("/fetch", json={"url": "https://example.com", "mode": "turbo"})
        assert resp.status_code == 422

    async def test_extract_requires_selectors(self, client):
        resp = await client.post("/extract", json={"url": "https://example.com"})
        assert resp.status_code == 422
