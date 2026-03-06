import pytest
from scrapling_service.fetchers import ScraplingFetcher, FetchRequest, FetchResponse


class TestFetchRequestValidation:
    def test_validates_mode(self):
        with pytest.raises(ValueError, match="Invalid mode"):
            FetchRequest(url="https://example.com", mode="invalid")

    def test_valid_modes(self):
        for mode in ("fast", "stealth", "dynamic"):
            req = FetchRequest(url="https://example.com", mode=mode)
            assert req.mode == mode

    def test_validates_output(self):
        with pytest.raises(ValueError, match="Invalid output"):
            FetchRequest(url="https://example.com", output="xml")

    def test_valid_outputs(self):
        for output in ("markdown", "html", "text"):
            req = FetchRequest(url="https://example.com", output=output)
            assert req.output == output

    def test_default_mode_and_output(self):
        req = FetchRequest(url="https://example.com")
        assert req.mode == "fast"
        assert req.output == "markdown"

    def test_selectors_optional(self):
        req = FetchRequest(url="https://example.com")
        assert req.selectors is None

    def test_selectors_accepted(self):
        req = FetchRequest(
            url="https://example.com",
            selectors={"title": "h1::text"},
        )
        assert req.selectors == {"title": "h1::text"}


class TestFetchResponseSerialization:
    def test_to_dict(self):
        resp = FetchResponse(
            url="https://example.com",
            status=200,
            content="# Hello",
        )
        d = resp.to_dict()
        assert d["url"] == "https://example.com"
        assert d["status"] == 200
        assert d["content"] == "# Hello"
        assert d["extracted"] is None
        assert d["cached"] is False
