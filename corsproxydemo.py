from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import uvicorn


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

ACCESS_CONTROL_ALLOW_PRIVATE_NETWORK = "Access-Control-Allow-Private-Network"
ACCESS_CONTROL_REQUEST_PRIVATE_NETWORK = "Access-Control-Request-Private-Network"


@dataclass
class BackoffRecord:
    """Track a backoff window for a specific host."""

    until: datetime
    attempts: int
    status: int


class CorsProxyServer:
    """FastAPI-based demo CORS proxy tailored for FeedCycle testing."""

    def __init__(
        self,
        *,
        allow_origins: Optional[Iterable[str]] = None,
        upstream_timeout: float = 12.0,
        backoff_base_seconds: int = 30,
        backoff_max_seconds: int = 900,
        long_backoff_seconds: int = 86_400,
        static_root: Optional[Path] = None,
        serve_static: bool = True,
    ) -> None:
        """Configure the proxy with timeout and backoff settings."""

        self.allow_origins = list(allow_origins) if allow_origins else ["*"]
        self.upstream_timeout = upstream_timeout
        self.backoff_base_seconds = backoff_base_seconds
        self.backoff_max_seconds = backoff_max_seconds
        self.long_backoff_seconds = long_backoff_seconds
        self.long_backoff_statuses = {403, 404, 500}
        self.static_root = (static_root or Path(__file__).resolve().parent).resolve()
        self.serve_static = serve_static
        self.backoffs: Dict[str, BackoffRecord] = {}
        self.client: Optional[httpx.AsyncClient] = None
        self.app: Optional[FastAPI] = None

    def build_app(self) -> FastAPI:
        """Create and configure the FastAPI application."""

        app = FastAPI(title="corsproxydemo", version="0.1.0")
        app.add_middleware(
            CORSMiddleware,
            allow_origins=self.allow_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @app.middleware("http")
        async def add_private_network_header(request: Request, call_next):
            response = await call_next(request)
            self._apply_private_network_header(request, response)
            return response

        app.add_event_handler("startup", self.startup)
        app.add_event_handler("shutdown", self.shutdown)
        app.get("/raw")(self.proxy_raw)
        if self.serve_static:
            app.get("/", include_in_schema=False)(self.serve_feedcycle_root)
            app.get("/feedcycle.html", include_in_schema=False)(self.serve_feedcycle_html)
            app.get("/feedcycle.js", include_in_schema=False)(self.serve_feedcycle_js)
            app.get("/feedcycle.css", include_in_schema=False)(self.serve_feedcycle_css)
            app.get("/assets/js/pwa.js", include_in_schema=False)(self.serve_pwa_js)
            app.get("/assets/js/version.js", include_in_schema=False)(self.serve_version_js)
            app.get("/parental.js", include_in_schema=False)(self.serve_parental_js)
            app.get("/manifest.webmanifest", include_in_schema=False)(self.serve_manifest)
            app.get("/favicon.ico", include_in_schema=False)(self.serve_favicon)
            app.add_api_route(
                "/sw.js",
                self.serve_service_worker,
                methods=["GET", "HEAD"],
                include_in_schema=False,
            )
            app.mount(
                "/assets/appicons",
                StaticFiles(directory=str(self.static_root / "assets" / "appicons")),
                name="appicons",
            )
            app.get(
                "/.well-known/appspecific/com.chrome.devtools.json",
                include_in_schema=False,
            )(self.serve_devtools_manifest)
        self.app = app
        return app

    async def startup(self) -> None:
        """Instantiate the HTTP client."""

        self.client = httpx.AsyncClient(
            timeout=self.upstream_timeout, follow_redirects=True
        )

    async def shutdown(self) -> None:
        """Dispose of the HTTP client."""

        if self.client:
            await self.client.aclose()
            self.client = None

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _parse_target(self, raw_url: str) -> str:
        if not raw_url:
            raise HTTPException(status_code=400, detail="Missing url parameter")
        target = httpx.URL(raw_url)
        if target.scheme not in ("http", "https") or not target.host:
            raise HTTPException(
                status_code=400,
                detail="Only absolute http(s) URLs with a host are allowed",
            )
        return str(target)

    def _host_key(self, target: str) -> str:
        parsed = httpx.URL(target)
        if not parsed.host:
            raise HTTPException(status_code=400, detail="Target host is required")
        return parsed.host

    def _active_backoff(self, host: str) -> Optional[int]:
        record = self.backoffs.get(host)
        if not record:
            return None
        now = self._now()
        if record.until <= now:
            self.backoffs.pop(host, None)
            return None
        return int((record.until - now).total_seconds())

    def _register_backoff(
        self, host: str, status_code: int, retry_after_header: Optional[str]
    ) -> int:
        now = self._now()
        retry_after_header = retry_after_header or None
        retry_after = None
        if retry_after_header:
            try:
                retry_after = int(float(retry_after_header))
            except ValueError:
                retry_after = None

        if status_code in self.long_backoff_statuses:
            attempts = 1
            delay = self.long_backoff_seconds
        else:
            prior = self.backoffs.get(host)
            attempts = (prior.attempts if prior else 0) + 1
            delay = min(
                self.backoff_base_seconds * (2 ** (attempts - 1)),
                self.backoff_max_seconds,
            )

        if retry_after is not None:
            delay = max(delay, retry_after)

        until = now + timedelta(seconds=delay)
        self.backoffs[host] = BackoffRecord(
            until=until, attempts=attempts, status=status_code
        )
        return int(delay)

    def _clear_backoff(self, host: str) -> None:
        self.backoffs.pop(host, None)

    def _wants_private_network(self, request: Request) -> bool:
        return (
            request.headers.get(ACCESS_CONTROL_REQUEST_PRIVATE_NETWORK, "")
            .lower()
            .strip()
            == "true"
        )

    def _apply_private_network_header(self, request: Request, response: Response) -> None:
        if self._wants_private_network(request):
            response.headers[ACCESS_CONTROL_ALLOW_PRIVATE_NETWORK] = "true"

    def _file_response(self, filename: str, media_type: str, *, no_store: bool = False) -> FileResponse:
        path = self.static_root.joinpath(filename)
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"Missing {filename}")
        headers = {"Cache-Control": "no-store"} if no_store else None
        return FileResponse(path, media_type=media_type, headers=headers)

    async def serve_feedcycle_root(self) -> RedirectResponse:
        return RedirectResponse(url="/feedcycle.html")

    async def serve_feedcycle_html(self) -> FileResponse:
        return self._file_response("feedcycle.html", "text/html; charset=utf-8", no_store=True)

    async def serve_feedcycle_js(self) -> FileResponse:
        return self._file_response("feedcycle.js", "application/javascript", no_store=True)

    async def serve_feedcycle_css(self) -> FileResponse:
        return self._file_response("feedcycle.css", "text/css", no_store=True)

    async def serve_pwa_js(self) -> FileResponse:
        return self._file_response("assets/js/pwa.js", "application/javascript")

    async def serve_version_js(self) -> FileResponse:
        return self._file_response("assets/js/version.js", "application/javascript")

    async def serve_parental_js(self) -> FileResponse:
        return self._file_response("parental.js", "application/javascript")

    async def serve_manifest(self) -> FileResponse:
        return self._file_response("manifest.webmanifest", "application/manifest+json")

    async def serve_favicon(self) -> FileResponse:
        return self._file_response("favicon.ico", "image/x-icon")

    async def serve_service_worker(self) -> Response:
        # Minimal no-op service worker so the PWA loader stops polling in demo mode.
        body = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',evt=>evt.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{})"
        return Response(
            content=body,
            media_type="application/javascript",
            headers={"Cache-Control": "no-store"},
        )

    async def serve_devtools_manifest(self) -> Response:
        # Chrome devtools probes this during remote debugging; return empty JSON to avoid 404 noise.
        return Response(content="{}", media_type="application/json", headers={"Cache-Control": "no-store"})

    async def proxy_raw(self, request: Request, url: str) -> Response:  # type: ignore[override]
        """Proxy the upstream request for the given URL."""

        target = self._parse_target(url)
        host_key = self._host_key(target)

        wait = self._active_backoff(host_key)
        if wait:
            raise HTTPException(
                status_code=429,
                detail="Backoff in effect for upstream host",
                headers={"Retry-After": str(wait)},
            )

        if self.client is None:
            raise RuntimeError("HTTP client not initialised")

        # Preserve caller identity where possible; some hosts 403 non-browser UA.
        ua = request.headers.get("user-agent") or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        accept = request.headers.get("accept") or "application/rss+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7"
        accept_lang = request.headers.get("accept-language") or "en-US,en;q=0.9"
        referer = request.headers.get("referer") or target
        try:
            upstream = await self.client.get(
                target,
                headers={
                    "User-Agent": ua,
                    "Accept": accept,
                    "Accept-Language": accept_lang,
                    "Referer": referer,
                },
            )
        except httpx.RequestError as exc:
            delay = self._register_backoff(host_key, 503, None)
            raise HTTPException(
                status_code=502,
                detail=f"Upstream connection failed: {exc}",
                headers={"Retry-After": str(delay)},
            ) from exc
        status = upstream.status_code
        headers = {
            k: v
            for k, v in upstream.headers.items()
            if k.lower() not in HOP_BY_HOP_HEADERS
        }
        headers.pop("content-length", None)
        headers.pop("content-encoding", None)

        if status == 429 or status in self.long_backoff_statuses:
            delay = self._register_backoff(host_key, status, headers.get("Retry-After"))
            headers["Retry-After"] = str(delay)
        else:
            self._clear_backoff(host_key)

        return Response(
            content=upstream.content,
            status_code=status,
            headers=headers,
            media_type=upstream.headers.get("content-type"),
        )


def build_arg_parser() -> argparse.ArgumentParser:
    """Construct the CLI parser for running the proxy."""

    parser = argparse.ArgumentParser(description="CORS proxy demo for FeedCycle.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address")
    parser.add_argument("--port", type=int, default=8000, help="Bind port")
    parser.add_argument(
        "--timeout",
        type=float,
        default=12.0,
        help="Upstream request timeout (seconds)",
    )
    parser.add_argument(
        "--backoff-base",
        type=int,
        default=30,
        metavar="SECONDS",
        help="Base backoff for 429 responses",
    )
    parser.add_argument(
        "--backoff-max",
        type=int,
        default=900,
        metavar="SECONDS",
        help="Maximum backoff for repeated 429 responses",
    )
    parser.add_argument(
        "--long-backoff",
        type=int,
        default=86_400,
        metavar="SECONDS",
        help="Backoff duration for 403/404/500 responses",
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        dest="allow_origins",
        help="Allowed Origin for CORS (default: allow all)",
    )
    parser.add_argument(
        "--static-root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory to serve static files from (defaults to repo root)",
    )
    parser.add_argument(
        "--no-static",
        action="store_true",
        help="Disable static file serving",
    )
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["critical", "error", "warning", "info", "debug", "trace"],
        help="Uvicorn log level",
    )
    return parser


def main() -> None:
    """Entry point when running as a script."""

    parser = build_arg_parser()
    args = parser.parse_args()

    server = CorsProxyServer(
        allow_origins=args.allow_origins,
        upstream_timeout=args.timeout,
        backoff_base_seconds=args.backoff_base,
        backoff_max_seconds=args.backoff_max,
        long_backoff_seconds=args.long_backoff,
        static_root=args.static_root,
        serve_static=not args.no_static,
    )
    app = server.build_app()

    static_status = "on" if not args.no_static else "off"
    base_url = f"http://{args.host}:{args.port}"
    client_url = f"{base_url}/feedcycle.html"
    print(
        "Starting corsproxydemo",
        f"host={args.host}:{args.port}",
        f"static={static_status}",
        f"static_root={args.static_root}",
        f"allow_origins={args.allow_origins or ['*']}",
        "proxy_endpoint=/raw?url=<http/https URL>",
        f"client_url={client_url if not args.no_static else 'static-disabled'}",
    )

    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)


# Default app for uvicorn module loading
app = CorsProxyServer().build_app()


if __name__ == "__main__":
    main()
