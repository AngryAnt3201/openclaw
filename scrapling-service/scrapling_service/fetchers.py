"""Unified wrapper around Scrapling's three fetcher tiers."""

from __future__ import annotations

from dataclasses import dataclass, field

VALID_MODES = ("fast", "stealth", "dynamic")
VALID_OUTPUTS = ("markdown", "html", "text")


@dataclass
class FetchRequest:
    url: str
    mode: str = "fast"
    output: str = "markdown"
    session: str | None = None
    selectors: dict[str, str] | None = None
    solve_cloudflare: bool = False
    timeout: int = 30
    proxy: str | None = None
    headless: bool = True

    def __post_init__(self):
        if self.mode not in VALID_MODES:
            raise ValueError(f"Invalid mode '{self.mode}'. Must be one of {VALID_MODES}")
        if self.output not in VALID_OUTPUTS:
            raise ValueError(f"Invalid output '{self.output}'. Must be one of {VALID_OUTPUTS}")


@dataclass
class FetchResponse:
    url: str
    status: int
    content: str
    extracted: dict[str, list[str] | str] | None = None
    cookies: dict[str, str] = field(default_factory=dict)
    cached: bool = False
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "status": self.status,
            "content": self.content,
            "extracted": self.extracted,
            "cookies": self.cookies,
            "cached": self.cached,
            "error": self.error,
        }


@dataclass
class LoginStep:
    action: str  # fill | click | wait | select | check
    selector: str
    value: str | None = None


class ScraplingFetcher:
    """Wraps Scrapling's 3-tier fetchers behind a unified interface.

    Tiers:
      - fast:    Uses Scrapling's Fetcher (httpx-based, no JS rendering)
      - stealth: Uses StealthyFetcher (real browser, anti-bot evasion)
      - dynamic: Uses DynamicFetcher (Playwright-based, full JS support)
    """

    async def fetch(self, request: FetchRequest) -> FetchResponse:
        try:
            if request.mode == "fast":
                return await self._fetch_fast(request)
            elif request.mode == "stealth":
                return await self._fetch_stealth(request)
            elif request.mode == "dynamic":
                return await self._fetch_dynamic(request)
            else:
                raise ValueError(f"Unknown mode: {request.mode}")
        except Exception as e:
            return FetchResponse(
                url=request.url,
                status=0,
                content="",
                error=str(e),
            )

    async def _fetch_fast(self, request: FetchRequest) -> FetchResponse:
        from scrapling.fetchers import Fetcher

        page = Fetcher.get(request.url, timeout=request.timeout, stealthy_headers=True)
        content = self._extract_content(page, request.output)
        extracted = self._extract_selectors(page, request.selectors)
        return FetchResponse(
            url=request.url,
            status=page.status if hasattr(page, "status") else 200,
            content=content,
            extracted=extracted,
            cookies=dict(page.cookies) if hasattr(page, "cookies") else {},
        )

    async def _fetch_stealth(self, request: FetchRequest) -> FetchResponse:
        from scrapling.fetchers import StealthyFetcher

        kwargs: dict = {
            "headless": request.headless,
            "disable_resources": True,
        }
        if request.solve_cloudflare:
            kwargs["solve_cloudflare"] = True
        if request.proxy:
            kwargs["proxy"] = {"server": request.proxy}

        page = StealthyFetcher.fetch(request.url, **kwargs)
        content = self._extract_content(page, request.output)
        extracted = self._extract_selectors(page, request.selectors)
        return FetchResponse(
            url=request.url,
            status=page.status if hasattr(page, "status") else 200,
            content=content,
            extracted=extracted,
            cookies=dict(page.cookies) if hasattr(page, "cookies") else {},
        )

    async def _fetch_dynamic(self, request: FetchRequest) -> FetchResponse:
        from scrapling.fetchers import DynamicFetcher

        kwargs: dict = {
            "headless": request.headless,
        }
        if request.proxy:
            kwargs["proxy"] = {"server": request.proxy}

        page = DynamicFetcher.fetch(request.url, **kwargs)
        content = self._extract_content(page, request.output)
        extracted = self._extract_selectors(page, request.selectors)
        return FetchResponse(
            url=request.url,
            status=page.status if hasattr(page, "status") else 200,
            content=content,
            extracted=extracted,
            cookies=dict(page.cookies) if hasattr(page, "cookies") else {},
        )

    def _extract_content(self, page: object, output: str) -> str:
        if output == "html":
            return str(page.html_content) if hasattr(page, "html_content") else str(page)
        elif output == "text":
            return page.get_all_text() if hasattr(page, "get_all_text") else str(page)
        else:  # markdown
            return page.get_all_text() if hasattr(page, "get_all_text") else str(page)

    def _extract_selectors(
        self, page: object, selectors: dict[str, str] | None
    ) -> dict[str, list[str] | str] | None:
        if not selectors or not hasattr(page, "css"):
            return None
        result: dict[str, list[str] | str] = {}
        for key, sel in selectors.items():
            matches = page.css(sel)
            texts = matches.getall() if hasattr(matches, "getall") else [str(m) for m in matches]
            result[key] = texts
        return result

    async def login(
        self, url: str, steps: list[LoginStep], mode: str = "dynamic", **kwargs
    ) -> FetchResponse:
        from scrapling.fetchers import DynamicFetcher

        def page_action(page):
            for step in steps:
                if step.action == "fill":
                    page.fill(step.selector, step.value or "")
                elif step.action == "click":
                    page.click(step.selector)
                elif step.action == "wait":
                    page.wait_for_selector(step.selector, timeout=kwargs.get("timeout", 30000))
                elif step.action == "select":
                    page.select_option(step.selector, step.value or "")

        page = DynamicFetcher.fetch(
            url,
            headless=kwargs.get("headless", True),
            page_action=page_action,
        )
        return FetchResponse(
            url=url,
            status=page.status if hasattr(page, "status") else 200,
            content=page.get_all_text() if hasattr(page, "get_all_text") else str(page),
            cookies=dict(page.cookies) if hasattr(page, "cookies") else {},
        )
