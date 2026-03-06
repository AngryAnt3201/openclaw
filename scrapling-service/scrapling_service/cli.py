from __future__ import annotations

import json
import sys

import click
import httpx


DEFAULT_BASE_URL = "http://localhost:18790"


def _client(base_url: str, timeout: int) -> httpx.Client:
    return httpx.Client(base_url=base_url, timeout=timeout)


def _output(data: dict | list, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(data, indent=2))
    elif isinstance(data, dict) and "content" in data:
        if data.get("error"):
            click.echo(f"Error: {data['error']}", err=True)
            sys.exit(1)
        click.echo(data["content"])
    elif isinstance(data, list):
        for item in data:
            click.echo(f"  {item.get('name', '?')} [{item.get('mode', '?')}] ttl={item.get('ttlMinutes', '?')}m")
    else:
        click.echo(json.dumps(data, indent=2))


@click.group()
@click.option("--base-url", default=DEFAULT_BASE_URL, envvar="SCRAPLING_URL", help="Sidecar base URL")
@click.option("--timeout", default=60, type=int, help="Request timeout in seconds")
@click.option("--json", "as_json", is_flag=True, help="Output raw JSON")
@click.pass_context
def main(ctx: click.Context, base_url: str, timeout: int, as_json: bool) -> None:
    """Scrapling CLI -- thin wrapper around the Scrapling sidecar service."""
    ctx.ensure_object(dict)
    ctx.obj["base_url"] = base_url
    ctx.obj["timeout"] = timeout
    ctx.obj["as_json"] = as_json


@main.command()
@click.argument("url")
@click.option("--mode", type=click.Choice(["fast", "stealth", "dynamic"]), default="fast")
@click.option("--session", default=None, help="Named session to use")
@click.option("--output", "output_fmt", type=click.Choice(["markdown", "html", "text"]), default="markdown")
@click.option("--solve-cloudflare", is_flag=True)
@click.option("--proxy", default=None)
@click.pass_context
def fetch(ctx: click.Context, url: str, mode: str, session: str | None, output_fmt: str, solve_cloudflare: bool, proxy: str | None) -> None:
    """Fetch a URL using Scrapling."""
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        body: dict = {"url": url, "mode": mode, "output": output_fmt, "solve_cloudflare": solve_cloudflare}
        if session:
            body["session"] = session
        if proxy:
            body["proxy"] = proxy
        resp = c.post("/fetch", json=body)
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])


@main.command()
@click.argument("url")
@click.option("--selectors", required=True, help="JSON object of name->CSS selector mappings")
@click.option("--mode", type=click.Choice(["fast", "stealth", "dynamic"]), default="fast")
@click.option("--session", default=None)
@click.pass_context
def extract(ctx: click.Context, url: str, selectors: str, mode: str, session: str | None) -> None:
    """Fetch a URL and extract data with CSS/XPath selectors."""
    sel = json.loads(selectors)
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        body: dict = {"url": url, "selectors": sel, "mode": mode}
        if session:
            body["session"] = session
        resp = c.post("/extract", json=body)
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])


@main.command()
@click.argument("url")
@click.option("--session", required=True, help="Named session for login state")
@click.option("--steps", required=True, help="JSON array of login steps")
@click.option("--verify-url", default=None, help="URL to verify after login")
@click.pass_context
def login(ctx: click.Context, url: str, session: str, steps: str, verify_url: str | None) -> None:
    """Execute a login flow on a named session."""
    step_list = json.loads(steps)
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        body: dict = {"session": session, "url": url, "steps": step_list}
        if verify_url:
            body["verify_url"] = verify_url
        resp = c.post("/login", json=body)
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])


@main.group(name="session")
def session_group() -> None:
    """Manage persistent scraping sessions."""
    pass


@session_group.command(name="create")
@click.argument("name")
@click.option("--mode", type=click.Choice(["fast", "stealth", "dynamic"]), default="stealth")
@click.option("--ttl", type=float, default=None, help="Session TTL in minutes")
@click.pass_context
def session_create(ctx: click.Context, name: str, mode: str, ttl: float | None) -> None:
    """Create a named session."""
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        body: dict = {"name": name, "mode": mode}
        if ttl is not None:
            body["ttl"] = ttl
        resp = c.post("/sessions", json=body)
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])


@session_group.command(name="list")
@click.pass_context
def session_list(ctx: click.Context) -> None:
    """List active sessions."""
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        resp = c.get("/sessions")
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])


@session_group.command(name="info")
@click.argument("name")
@click.pass_context
def session_info(ctx: click.Context, name: str) -> None:
    """Get session details."""
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        resp = c.get(f"/sessions/{name}")
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])


@session_group.command(name="destroy")
@click.argument("name")
@click.pass_context
def session_destroy(ctx: click.Context, name: str) -> None:
    """Destroy a session."""
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        resp = c.delete(f"/sessions/{name}")
        resp.raise_for_status()
        click.echo(f"Destroyed session '{name}'")


@main.command()
@click.pass_context
def health(ctx: click.Context) -> None:
    """Check sidecar health."""
    with _client(ctx.obj["base_url"], ctx.obj["timeout"]) as c:
        resp = c.get("/health")
        resp.raise_for_status()
        _output(resp.json(), ctx.obj["as_json"])
