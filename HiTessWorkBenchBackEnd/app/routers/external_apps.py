from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response


router = APIRouter(prefix="/external-apps", tags=["external-apps"])

BLOCK_WELD_UPSTREAM = "http://10.14.42.145:31880/"
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


def _filter_headers(headers):
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
        and key.lower() not in {"host", "content-length"}
    }


def _rewrite_html_links(content: bytes, content_type: str, proxy_path: str) -> bytes:
    if "text/html" not in content_type.lower():
        return content

    try:
        html = content.decode("utf-8")
    except UnicodeDecodeError:
        return content

    replacements = {
        'href="/': f'href="{proxy_path}/',
        'src="/': f'src="{proxy_path}/',
        'action="/': f'action="{proxy_path}/',
        'content="/': f'content="{proxy_path}/',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    return html.encode("utf-8")


async def _proxy_block_weld(request: Request, path: str = ""):
    upstream_origin = BLOCK_WELD_UPSTREAM.rstrip("/")
    proxy_origin = str(request.base_url).rstrip("/")
    proxy_base = f"{proxy_origin}/external-apps/block-weld"
    target_url = urljoin(BLOCK_WELD_UPSTREAM, path)
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    headers = _filter_headers(request.headers)
    headers["host"] = urlparse(BLOCK_WELD_UPSTREAM).netloc

    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
            upstream = await client.request(
                request.method,
                target_url,
                content=await request.body(),
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Block Weld upstream server is unavailable: {exc}",
        ) from exc

    response_headers = _filter_headers(upstream.headers)
    location = response_headers.get("location")
    if location:
        if location.startswith(upstream_origin):
            response_headers["location"] = location.replace(upstream_origin, proxy_base, 1)
        elif location.startswith("/"):
            response_headers["location"] = f"{proxy_base}{location}"

    content_type = upstream.headers.get("content-type", "")
    content = _rewrite_html_links(upstream.content, content_type, "/external-apps/block-weld")

    return Response(
        content=content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=content_type,
    )


@router.api_route("/block-weld", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_block_weld_root(request: Request):
    return await _proxy_block_weld(request)


@router.api_route("/block-weld/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_block_weld_path(request: Request, path: str):
    return await _proxy_block_weld(request, path)
