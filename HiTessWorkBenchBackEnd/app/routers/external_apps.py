from __future__ import annotations

from dataclasses import dataclass, replace
from html import escape as html_escape
import json
import logging
import re
import time
from typing import Callable
from urllib.parse import quote, unquote, urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, RedirectResponse, Response, StreamingResponse

from app import database, models
from app.dependencies import require_auth
from app.services import app_settings as app_settings_service
from app.services import external_app_registry
from app.services.external_app_access import (
    GRANT_TTL_SECONDS,
    SESSION_TTL_SECONDS,
    external_app_access_store,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/external-apps", tags=["external-apps"])

BLOCK_WELD_UPSTREAM = "http://10.14.42.145:31880/"
BLOCK_WELD_PROXY_PATH = "/external-apps/block-weld"
INDEPENDENT_TANK_UPSTREAM = "http://10.14.42.145:31870/"
INDEPENDENT_TANK_PROXY_PATH = "/external-apps/independent-tank"
HEAVY_BLOCK_LIFTING_UPSTREAM = "http://10.14.42.145:31860/"
HEAVY_BLOCK_LIFTING_PROXY_PATH = "/external-apps/heavy-block-lifting"

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
WORKBENCH_CREDENTIAL_HEADERS = {"authorization"}
RESERVED_QUERY_PARAMETERS = {"__wb_grant"}
EXTERNAL_PROXY_MAX_BODY_BYTES = 25 * 1024 * 1024
# 외부 앱이 요청 하나에 응답해야 하는 시간(App Settings 등록 창의 개발자 안내와 같은 값).
UPSTREAM_READ_TIMEOUT_SECONDS = 30.0
_EMPLOYEE_PATH_RE = re.compile(r"^A\d{6}$", re.IGNORECASE)

_block_weld_client: httpx.AsyncClient | None = None
_independent_tank_client: httpx.AsyncClient | None = None
_heavy_block_lifting_client: httpx.AsyncClient | None = None
_registered_app_client: httpx.AsyncClient | None = None


def get_block_weld_client() -> httpx.AsyncClient:
    global _block_weld_client
    if _block_weld_client is None or _block_weld_client.is_closed:
        _block_weld_client = httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(UPSTREAM_READ_TIMEOUT_SECONDS, connect=5.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _block_weld_client


async def close_block_weld_client() -> None:
    global _block_weld_client
    if _block_weld_client is not None and not _block_weld_client.is_closed:
        await _block_weld_client.aclose()
    _block_weld_client = None


def get_independent_tank_client() -> httpx.AsyncClient:
    global _independent_tank_client
    if _independent_tank_client is None or _independent_tank_client.is_closed:
        _independent_tank_client = httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(UPSTREAM_READ_TIMEOUT_SECONDS, connect=5.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _independent_tank_client


async def close_independent_tank_client() -> None:
    global _independent_tank_client
    if _independent_tank_client is not None and not _independent_tank_client.is_closed:
        await _independent_tank_client.aclose()
    _independent_tank_client = None


def get_heavy_block_lifting_client() -> httpx.AsyncClient:
    global _heavy_block_lifting_client
    if _heavy_block_lifting_client is None or _heavy_block_lifting_client.is_closed:
        _heavy_block_lifting_client = httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(UPSTREAM_READ_TIMEOUT_SECONDS, connect=5.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _heavy_block_lifting_client


async def close_heavy_block_lifting_client() -> None:
    global _heavy_block_lifting_client
    if _heavy_block_lifting_client is not None and not _heavy_block_lifting_client.is_closed:
        await _heavy_block_lifting_client.aclose()
    _heavy_block_lifting_client = None


def get_registered_app_client() -> httpx.AsyncClient:
    """App Settings 에서 등록한 외부 앱이 함께 쓰는 클라이언트(대상 주소는 요청마다 다르다)."""
    global _registered_app_client
    if _registered_app_client is None or _registered_app_client.is_closed:
        _registered_app_client = httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(UPSTREAM_READ_TIMEOUT_SECONDS, connect=5.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _registered_app_client


async def close_registered_app_client() -> None:
    global _registered_app_client
    if _registered_app_client is not None and not _registered_app_client.is_closed:
        await _registered_app_client.aclose()
    _registered_app_client = None


@dataclass(frozen=True)
class ExternalAppProxy:
    key: str
    display_name: str
    # App Settings 의 app_key(= ANALYSIS_DATA title). 관리자가 IP·Port 를 바꾸는 단위.
    app_key: str
    # 코드 기본 upstream. 실제 요청은 _effective_config() 가 오버라이드를 덮어 쓴다.
    upstream: str
    proxy_path: str
    cookie_name: str
    get_client: Callable[[], httpx.AsyncClient]


BLOCK_WELD = ExternalAppProxy(
    key="block-weld",
    display_name="Block Weld",
    app_key="Block Weld Assessment",
    upstream=BLOCK_WELD_UPSTREAM,
    proxy_path=BLOCK_WELD_PROXY_PATH,
    cookie_name="wb_ext_block_weld",
    get_client=get_block_weld_client,
)
INDEPENDENT_TANK = ExternalAppProxy(
    key="independent-tank",
    display_name="Independent Tank",
    app_key="Independent Tank Assessment",
    upstream=INDEPENDENT_TANK_UPSTREAM,
    proxy_path=INDEPENDENT_TANK_PROXY_PATH,
    cookie_name="wb_ext_independent_tank",
    get_client=get_independent_tank_client,
)
HEAVY_BLOCK_LIFTING = ExternalAppProxy(
    key="heavy-block-lifting",
    display_name="Heavy Block Lifting",
    app_key="Heavy Block Lifting Simulation",
    upstream=HEAVY_BLOCK_LIFTING_UPSTREAM,
    proxy_path=HEAVY_BLOCK_LIFTING_PROXY_PATH,
    cookie_name="wb_ext_heavy_block_lifting",
    get_client=get_heavy_block_lifting_client,
)
_GATEWAY_COOKIE_NAMES = frozenset(
    {
        BLOCK_WELD.cookie_name,
        INDEPENDENT_TANK.cookie_name,
        HEAVY_BLOCK_LIFTING.cookie_name,
    }
)


def external_app_configs() -> tuple[ExternalAppProxy, ...]:
    """등록된 외부 앱 전체(App Settings 의 IP·Port 편집 대상)."""
    return (BLOCK_WELD, INDEPENDENT_TANK, HEAVY_BLOCK_LIFTING)


def registered_app_proxy_path(slug: str) -> str:
    return f"/external-apps/{slug}"


def _registered_app_config(registration: dict) -> ExternalAppProxy:
    slug = registration["slug"]
    return ExternalAppProxy(
        # 접두사로 코드 앱 키와 겹치지 않게 한다(실행 권한·세션 저장소의 이름공간).
        key=f"registered:{slug}",
        display_name=registration["title"],
        app_key=registration["title"],
        upstream=f"http://{registration['host']}:{registration['port']}/",
        proxy_path=registered_app_proxy_path(slug),
        cookie_name=f"{_GATEWAY_COOKIE_PREFIX}app_{slug.replace('-', '_')}",
        get_client=get_registered_app_client,
    )


def _load_registration(slug: str) -> tuple[dict | None, dict | None]:
    """(등록 정보, app_settings 오버라이드). 없는 slug 면 (None, None)."""
    db = database.SessionLocal()
    try:
        registration = external_app_registry.load_registrations(db).get(slug)
        if registration is None:
            return None, None
        setting = app_settings_service.load_settings(db).get(registration["title"])
        return registration, setting
    finally:
        db.close()


def _is_admin(employee_id: str) -> bool:
    db = database.SessionLocal()
    try:
        return app_settings_service.is_admin_user(db, employee_id)
    finally:
        db.close()


async def _registered_config_or_404(slug: str) -> tuple[ExternalAppProxy, dict, dict | None]:
    registration, setting = await run_in_threadpool(_load_registration, slug)
    if registration is None:
        raise HTTPException(status_code=404, detail="등록되지 않은 외부 앱입니다.")
    return _registered_app_config(registration), registration, setting


def _load_app_setting(app_key: str) -> dict | None:
    db = database.SessionLocal()
    try:
        return app_settings_service.load_settings(db).get(app_key)
    finally:
        db.close()


async def _effective_config(config: ExternalAppProxy) -> ExternalAppProxy:
    """App Settings 에서 바꾼 IP·Port 를 반영한 설정. 조회 실패 시 코드 기본값."""
    try:
        setting = await run_in_threadpool(_load_app_setting, config.app_key)
    except Exception:  # DB 장애로 외부 앱 전체가 막히지 않게 기본 주소로 계속한다.
        logger.warning("외부 앱 주소 설정 조회 실패 — 기본 주소 사용: %s", config.key, exc_info=True)
        return config
    upstream = app_settings_service.effective_external_upstream(config.upstream, setting)
    if upstream == config.upstream:
        return config
    return replace(config, upstream=upstream)


# 등록 앱 쿠키는 이름이 동적이라 고정 목록 대신 이 접두사로 거른다(코드 앱 쿠키도 같은 접두사).
_GATEWAY_COOKIE_PREFIX = "wb_ext_"
_COOKIE_NAME_RE = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")


def _is_gateway_cookie(name: str) -> bool:
    return name in _GATEWAY_COOKIE_NAMES or name.startswith(_GATEWAY_COOKIE_PREFIX)


class BootstrapRequest(BaseModel):
    cache_bust: bool = True


def _filter_headers(headers, *, strip_credentials: bool = False):
    blocked = HOP_BY_HOP_HEADERS | {"host", "content-length"}
    if strip_credentials:
        blocked |= WORKBENCH_CREDENTIAL_HEADERS
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in blocked
        and key.lower() != "forwarded"
        and not key.lower().startswith("x-forwarded-")
    }


def _upstream_cookie_header(raw_cookie: str | None) -> str | None:
    """Keep upstream cookies while removing every WorkBench gateway session.

    Parse the complete header before forwarding anything.  ``SimpleCookie`` can
    retain successfully parsed prefixes when a later pair is malformed, which
    would make a fail-closed policy unreliable here.
    """

    if not raw_cookie:
        return None

    if any(ord(char) < 32 or ord(char) == 127 for char in raw_cookie):
        return None

    chunks: list[str] = []
    start = 0
    in_quotes = False
    escaped = False
    for index, char in enumerate(raw_cookie):
        if in_quotes:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_quotes = False
        elif char == '"':
            in_quotes = True
        elif char == ";":
            chunks.append(raw_cookie[start:index])
            start = index + 1
    if in_quotes or escaped:
        return None
    chunks.append(raw_cookie[start:])

    pairs: list[str] = []
    for chunk in chunks:
        pair = chunk.strip()
        if not pair or "=" not in pair:
            return None
        name, value = pair.split("=", 1)
        if name != name.strip() or not _COOKIE_NAME_RE.fullmatch(name):
            return None
        value = value.strip()
        if not value:
            value = ""
        elif value.startswith('"'):
            if not value.endswith('"') or len(value) < 2:
                return None
            escaped = False
            for char in value[1:-1]:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    return None
            if escaped:
                return None
        elif '"' in value or any(char.isspace() for char in value):
            return None

        # RFC 2109 attributes occasionally appear in legacy Cookie headers.
        # They are metadata rather than upstream cookie pairs and retain the
        # gateway's established filtering behavior.
        if name.startswith("$") or _is_gateway_cookie(name):
            continue
        pairs.append(f"{name}={value}")

    return "; ".join(pairs) or None


def _upstream_set_cookie_headers(headers) -> list[str]:
    """Return individual safe upstream Set-Cookie fields without coalescing."""

    values = (
        headers.get_list("set-cookie")
        if hasattr(headers, "get_list")
        else [
            value
            for name, value in headers.items()
            if name.lower() == "set-cookie"
        ]
    )
    safe_values = []
    for value in values:
        first_pair = value.split(";", 1)[0].strip()
        if "=" not in first_pair:
            continue
        name, _cookie_value = first_pair.split("=", 1)
        if (
            not _COOKIE_NAME_RE.fullmatch(name)
            or _is_gateway_cookie(name)
        ):
            continue
        safe_values.append(value)
    return safe_values


def _append_upstream_set_cookie_headers(response: Response, headers) -> None:
    for value in _upstream_set_cookie_headers(headers):
        response.raw_headers.append((b"set-cookie", value.encode("latin-1")))


def _same_origin(left: str, right: str) -> bool:
    left_url = urlparse(left)
    right_url = urlparse(right)
    return (
        left_url.scheme.lower(),
        left_url.hostname,
        left_url.port,
    ) == (
        right_url.scheme.lower(),
        right_url.hostname,
        right_url.port,
    )


def _proxy_response_headers(headers, upstream_origin: str, proxy_base: str):
    response_headers = _filter_headers(headers)
    response_headers.pop("set-cookie", None)
    location = response_headers.get("location")
    if location:
        if _same_origin(location, upstream_origin):
            parsed = urlparse(location)
            suffix = parsed.path or "/"
            if parsed.query:
                suffix = f"{suffix}?{parsed.query}"
            if parsed.fragment:
                suffix = f"{suffix}#{parsed.fragment}"
            response_headers["location"] = f"{proxy_base}{suffix}"
        elif location.startswith("/") and not location.startswith("//"):
            response_headers["location"] = f"{proxy_base}{location}"
    return response_headers


def _build_subpath_shim(proxy_path: str) -> str:
    """Build the compatibility shim for root-relative external applications."""

    prefix = json.dumps(proxy_path)
    return (
        "<script>(function(){"
        f"var P={prefix};"
        "function fix(u){try{"
        "if(typeof u!=='string'||!u)return u;"
        "if(u===P||u.indexOf(P+'/')===0)return u;"
        "if(u.charAt(0)==='/'&&u.charAt(1)!=='/')return P+u;"
        "var o=location.origin+'/';"
        "if(u.indexOf(o)===0){var pth=u.slice(location.origin.length);"
        "if(pth!==P&&pth.indexOf(P+'/')!==0)return location.origin+P+pth;}"
        "}catch(e){}return u;}"
        "try{var p=location.pathname;"
        "if(p===P)history.replaceState(history.state,'','/'+location.search+location.hash);"
        "else if(p.indexOf(P+'/')===0)"
        "history.replaceState(history.state,'',p.slice(P.length)+location.search+location.hash);"
        "}catch(e){}"
        "var F=window.fetch;if(F){window.fetch=function(i,init){try{"
        "if(typeof i==='string')i=fix(i);"
        "else if(i&&i.url){var nu=fix(i.url);if(nu!==i.url)i=new Request(nu,i);}"
        "}catch(e){}return F.call(this,i,init);};}"
        "var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){"
        "var a=Array.prototype.slice.call(arguments);"
        "try{if(typeof a[1]==='string')a[1]=fix(a[1]);}catch(e){}"
        "return XO.apply(this,a);};"
        "})();</script>"
    )


def _document_base_href(proxy_path: str, request_path: str) -> str:
    """Return the proxy-side base URL for the upstream document's directory.

    The shim below rewrites ``location.pathname`` so the external app can still
    read the employee id from the first path segment.  That also moves the
    document URL, and with it the base every *relative* asset resolves against:
    ``<script src="app.js">`` parsed after the shim would resolve to ``/app.js``
    on the WorkBench origin instead of the proxied subpath.  Pinning ``<base>``
    to the upstream directory keeps relative resolution stable regardless.
    """

    directory = f"{request_path.rsplit('/', 1)[0]}/" if "/" in request_path else ""
    encoded = quote(directory, safe="/:@!$&'()*+,;=-._~%")
    return html_escape(f"{proxy_path}/{encoded}", quote=True)


def _rewrite_html_links(
    content: bytes,
    content_type: str,
    proxy_path: str,
    request_path: str = "",
) -> bytes:
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

    def _fix_importmap(match):
        block = match.group(2).replace('"/', f'"{proxy_path}/')
        return match.group(1) + block + match.group(3)

    html = re.sub(
        r'(<script[^>]*type=["\']importmap["\'][^>]*>)(.*?)(</script>)',
        _fix_importmap,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Pin relative resolution before any asset tag is parsed.  An upstream that
    # ships its own <base> already controls resolution and is left untouched.
    if not re.search(r"<base\b", html, re.IGNORECASE):
        base_tag = f'<base href="{_document_base_href(proxy_path, request_path)}">'
        head_open = re.search(r"<head\b[^>]*>", html, re.IGNORECASE)
        if head_open:
            html = html[: head_open.end()] + base_tag + html[head_open.end() :]
        else:
            html = base_tag + html

    shim = _build_subpath_shim(proxy_path)
    if "</head>" in html:
        html = html.replace("</head>", shim + "</head>", 1)
    elif "<head>" in html:
        html = html.replace("<head>", "<head>" + shim, 1)
    else:
        html = shim + html

    return html.encode("utf-8")


def _path_is_safe(path: str) -> bool:
    """Reject every representation that could change the pinned upstream origin."""

    candidate = path
    for _ in range(3):
        if (
            any(ord(char) < 32 or ord(char) == 127 for char in candidate)
            or "\\" in candidate
            or candidate.startswith("/")
            or candidate.startswith("//")
        ):
            return False
        parsed = urlparse(candidate)
        if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
            return False
        if any(segment in {".", ".."} for segment in candidate.split("/")):
            return False
        decoded = unquote(candidate)
        if decoded == candidate:
            break
        candidate = decoded
    return True


def _build_target_url(config: ExternalAppProxy, path: str, request: Request) -> str:
    if not _path_is_safe(path):
        raise HTTPException(status_code=400, detail="허용되지 않는 외부 앱 경로입니다.")

    # Quote decoded route text while retaining valid path delimiters.  The URL is
    # constructed by concatenation, never urljoin, and then origin-pinned below.
    encoded_path = quote(path, safe="/:@!$&'()*+,;=-._~%")
    target_url = f"{config.upstream.rstrip('/')}/{encoded_path}"
    query_items = [
        (key, value)
        for key, value in request.query_params.multi_items()
        if key not in RESERVED_QUERY_PARAMETERS
    ]
    if query_items:
        target_url = f"{target_url}?{urlencode(query_items, doseq=True)}"

    if not _same_origin(target_url, config.upstream):
        raise HTTPException(status_code=400, detail="외부 앱 upstream 경로가 거부되었습니다.")
    return target_url


def _employee_is_active(employee_id: str) -> bool:
    """Revalidate browser-cookie identity against the current account state."""

    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter(
            models.User.employee_id == employee_id
        ).first()
        return bool(user and user.is_active)
    finally:
        db.close()


async def _require_browser_session(request: Request, config: ExternalAppProxy) -> str:
    token = request.cookies.get(config.cookie_name)
    session = external_app_access_store.get_session(token, config.key)
    if session is None:
        raise HTTPException(
            status_code=401,
            detail="외부 앱 세션이 없거나 만료되었습니다. WorkBench에서 다시 실행해주세요.",
        )
    if not await run_in_threadpool(_employee_is_active, session.employee_id):
        external_app_access_store.revoke_employee(session.employee_id)
        raise HTTPException(
            status_code=401,
            detail="사용자 계정이 비활성화되어 외부 앱 세션이 종료되었습니다.",
        )
    return session.employee_id


def _assert_path_employee(path: str, employee_id: str) -> None:
    """Prevent a browser session from selecting another user's upstream root."""

    candidate = path
    for _ in range(3):
        decoded = unquote(candidate)
        if decoded == candidate:
            break
        candidate = decoded
    first_segment = candidate.split("/", 1)[0].strip()
    if not first_segment:
        return
    if first_segment.casefold() == employee_id.strip().casefold():
        return
    if _EMPLOYEE_PATH_RE.fullmatch(first_segment):
        raise HTTPException(
            status_code=403,
            detail="다른 사용자의 외부 앱 경로에는 접근할 수 없습니다.",
        )


async def _read_limited_request_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > EXTERNAL_PROXY_MAX_BODY_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="외부 앱 요청 본문 크기 제한을 초과했습니다.",
                )
        except ValueError:
            pass

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > EXTERNAL_PROXY_MAX_BODY_BYTES:
            raise HTTPException(
                status_code=413,
                detail="외부 앱 요청 본문 크기 제한을 초과했습니다.",
            )
    return bytes(body)


def _issue_bootstrap(config: ExternalAppProxy, employee_id: str, payload: BootstrapRequest):
    grant = external_app_access_store.issue_grant(
        config.key,
        employee_id,
        cache_bust=payload.cache_bust,
    )
    return JSONResponse(
        {
            "launchPath": f"{config.proxy_path}/__wb_bootstrap?grant={quote(grant)}",
            "expiresIn": GRANT_TTL_SECONDS,
        },
        headers={"Cache-Control": "no-store"},
    )


def _exchange_bootstrap(request: Request, config: ExternalAppProxy, grant_token: str):
    grant = external_app_access_store.consume_grant(grant_token, config.key)
    if grant is None:
        raise HTTPException(
            status_code=401,
            detail="외부 앱 실행 권한이 만료되었거나 이미 사용되었습니다.",
        )

    session_token = external_app_access_store.issue_session(
        config.key,
        grant.employee_id,
    )
    employee_path = quote(grant.employee_id, safe="")
    clean_url = f"{config.proxy_path}/{employee_path}"
    if grant.cache_bust:
        clean_url = f"{clean_url}?__wb_cache_bust={int(time.time() * 1000)}"

    response = RedirectResponse(url=clean_url, status_code=303)
    response.set_cookie(
        key=config.cookie_name,
        value=session_token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/external-apps",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


async def _proxy_request(request: Request, config: ExternalAppProxy, path: str = ""):
    employee_id = await _require_browser_session(request, config)
    _assert_path_employee(path, employee_id)
    config = await _effective_config(config)
    target_url = _build_target_url(config, path, request)
    proxy_origin = str(request.base_url).rstrip("/")
    proxy_base = f"{proxy_origin}{config.proxy_path}"

    # WorkBench credentials terminate at the gateway and are never sent to the
    # external engineering application.  The upstream Host is pinned explicitly.
    headers = _filter_headers(request.headers, strip_credentials=True)
    upstream_cookie = _upstream_cookie_header(request.headers.get("cookie"))
    if upstream_cookie:
        headers["cookie"] = upstream_cookie
    else:
        headers.pop("cookie", None)
    headers["host"] = urlparse(config.upstream).netloc
    client = config.get_client()
    body = await _read_limited_request_body(request)

    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                target_url,
                content=body,
                headers=headers,
            ),
            stream=True,
        )
    except httpx.TimeoutException as exc:
        # 예전엔 아래 502 로 빠져 "unavailable: " 처럼 원인이 빈 문구가 나갔다(실측).
        raise HTTPException(
            status_code=504,
            detail=(
                f"{config.display_name} 가 {UPSTREAM_READ_TIMEOUT_SECONDS:.0f}초 안에 응답하지 않았습니다. "
                "오래 걸리는 계산은 작업을 시작한 뒤 상태를 나눠 확인하도록 외부 앱을 고쳐야 합니다."
            ),
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"{config.display_name} upstream server is unavailable: {exc!r}",
        ) from exc

    upstream_origin = config.upstream.rstrip("/")
    response_headers = _proxy_response_headers(upstream.headers, upstream_origin, proxy_base)
    content_type = upstream.headers.get("content-type", "")
    if "text/html" not in content_type.lower():
        response = StreamingResponse(
            upstream.aiter_bytes(),
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=content_type,
            background=BackgroundTask(upstream.aclose),
        )
        _append_upstream_set_cookie_headers(response, upstream.headers)
        return response

    try:
        content = _rewrite_html_links(
            await upstream.aread(),
            content_type,
            config.proxy_path,
            path,
        )
        response = Response(
            content=content,
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=content_type,
        )
        _append_upstream_set_cookie_headers(response, upstream.headers)
        return response
    finally:
        await upstream.aclose()


async def _proxy_health(config: ExternalAppProxy):
    config = await _effective_config(config)
    target_url = config.upstream
    client = config.get_client()
    try:
        upstream = await client.send(client.build_request("GET", target_url), stream=True)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"{config.display_name} upstream server is unavailable: {exc}",
        ) from exc

    try:
        return JSONResponse(
            {"ok": upstream.status_code < 500, "upstreamStatus": upstream.status_code},
            status_code=200 if upstream.status_code < 500 else 502,
        )
    finally:
        await upstream.aclose()


async def _proxy_block_weld(request: Request, path: str = ""):
    return await _proxy_request(request, BLOCK_WELD, path)


async def _proxy_independent_tank(request: Request, path: str = ""):
    return await _proxy_request(request, INDEPENDENT_TANK, path)


async def _proxy_heavy_block_lifting(request: Request, path: str = ""):
    return await _proxy_request(request, HEAVY_BLOCK_LIFTING, path)


@router.post("/block-weld/__wb_bootstrap")
async def issue_block_weld_bootstrap(
    payload: BootstrapRequest,
    employee_id: str = Depends(require_auth),
):
    return _issue_bootstrap(BLOCK_WELD, employee_id, payload)


@router.get("/block-weld/__wb_bootstrap")
async def exchange_block_weld_bootstrap(request: Request, grant: str):
    return _exchange_bootstrap(request, BLOCK_WELD, grant)


@router.get("/block-weld/__wb_proxy_health")
async def proxy_block_weld_health(_employee_id: str = Depends(require_auth)):
    return await _proxy_health(BLOCK_WELD)


@router.api_route(
    "/block-weld",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_block_weld_root(request: Request):
    return await _proxy_block_weld(request)


@router.api_route(
    "/block-weld/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_block_weld_path(request: Request, path: str):
    return await _proxy_block_weld(request, path)


@router.post("/independent-tank/__wb_bootstrap")
async def issue_independent_tank_bootstrap(
    payload: BootstrapRequest,
    employee_id: str = Depends(require_auth),
):
    return _issue_bootstrap(INDEPENDENT_TANK, employee_id, payload)


@router.get("/independent-tank/__wb_bootstrap")
async def exchange_independent_tank_bootstrap(request: Request, grant: str):
    return _exchange_bootstrap(request, INDEPENDENT_TANK, grant)


@router.get("/independent-tank/__wb_proxy_health")
async def proxy_independent_tank_health(_employee_id: str = Depends(require_auth)):
    return await _proxy_health(INDEPENDENT_TANK)


@router.api_route(
    "/independent-tank",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_independent_tank_root(request: Request):
    return await _proxy_independent_tank(request)


@router.api_route(
    "/independent-tank/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_independent_tank_path(request: Request, path: str):
    return await _proxy_independent_tank(request, path)


@router.post("/heavy-block-lifting/__wb_bootstrap")
async def issue_heavy_block_lifting_bootstrap(
    payload: BootstrapRequest,
    employee_id: str = Depends(require_auth),
):
    return _issue_bootstrap(HEAVY_BLOCK_LIFTING, employee_id, payload)


@router.get("/heavy-block-lifting/__wb_bootstrap")
async def exchange_heavy_block_lifting_bootstrap(request: Request, grant: str):
    return _exchange_bootstrap(request, HEAVY_BLOCK_LIFTING, grant)


@router.get("/heavy-block-lifting/__wb_proxy_health")
async def proxy_heavy_block_lifting_health(_employee_id: str = Depends(require_auth)):
    return await _proxy_health(HEAVY_BLOCK_LIFTING)


@router.api_route(
    "/heavy-block-lifting",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_heavy_block_lifting_root(request: Request):
    return await _proxy_heavy_block_lifting(request)


@router.api_route(
    "/heavy-block-lifting/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_heavy_block_lifting_path(request: Request, path: str):
    return await _proxy_heavy_block_lifting(request, path)


# ── App Settings 에서 등록한 외부 앱 ──────────────────────────────────────
# ⚠ 반드시 파일 맨 끝에 둔다. FastAPI 는 등록 순서대로 경로를 맞추므로, 위의 코드 앱
# 경로(/block-weld/...)가 먼저 잡혀야 한다. 같은 slug 는 RESERVED_SLUGS 로 막는다.


@router.post("/{slug}/__wb_bootstrap")
async def issue_registered_app_bootstrap(
    slug: str,
    payload: BootstrapRequest,
    employee_id: str = Depends(require_auth),
):
    config, registration, setting = await _registered_config_or_404(slug)
    # 코드 앱은 app_settings 게이트 미들웨어가 막지만 등록 앱은 경로가 동적이라 여기서 막는다.
    reason = external_app_registry.effective_block_reason(registration, setting)
    if reason is not None and not await run_in_threadpool(_is_admin, employee_id):
        raise HTTPException(status_code=403, detail=reason[1])
    return _issue_bootstrap(config, employee_id, payload)


@router.get("/{slug}/__wb_bootstrap")
async def exchange_registered_app_bootstrap(request: Request, slug: str, grant: str):
    config, _registration, _setting = await _registered_config_or_404(slug)
    return _exchange_bootstrap(request, config, grant)


@router.get("/{slug}/__wb_proxy_health")
async def proxy_registered_app_health(slug: str, _employee_id: str = Depends(require_auth)):
    config, _registration, _setting = await _registered_config_or_404(slug)
    return await _proxy_health(config)


@router.api_route(
    "/{slug}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_registered_app_root(request: Request, slug: str):
    config, _registration, _setting = await _registered_config_or_404(slug)
    return await _proxy_request(request, config)


@router.api_route(
    "/{slug}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_registered_app_path(request: Request, slug: str, path: str):
    config, _registration, _setting = await _registered_config_or_404(slug)
    return await _proxy_request(request, config, path)
