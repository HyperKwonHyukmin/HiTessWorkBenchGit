import json
import re
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse, Response, StreamingResponse


router = APIRouter(prefix="/external-apps", tags=["external-apps"])

BLOCK_WELD_UPSTREAM = "http://10.14.42.145:31880/"
BLOCK_WELD_PROXY_PATH = "/external-apps/block-weld"
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
_block_weld_client: httpx.AsyncClient | None = None


def get_block_weld_client() -> httpx.AsyncClient:
    global _block_weld_client
    if _block_weld_client is None or _block_weld_client.is_closed:
        _block_weld_client = httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(30.0, connect=5.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _block_weld_client


async def close_block_weld_client() -> None:
    global _block_weld_client
    if _block_weld_client is not None and not _block_weld_client.is_closed:
        await _block_weld_client.aclose()
    _block_weld_client = None


def _filter_headers(headers):
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
        and key.lower() not in {"host", "content-length"}
    }


def _proxy_response_headers(headers, upstream_origin: str, proxy_base: str):
    response_headers = _filter_headers(headers)
    location = response_headers.get("location")
    if location:
        if location.startswith(upstream_origin):
            response_headers["location"] = location.replace(upstream_origin, proxy_base, 1)
        elif location.startswith("/"):
            response_headers["location"] = f"{proxy_base}{location}"
    return response_headers


def _build_subpath_shim(proxy_path: str) -> str:
    """루트(/) 기준으로 작성된 외부 앱을 서브패스 프록시(예: /external-apps/block-weld)
    아래에서 동작시키기 위한 런타임 보정 스크립트를 생성한다.

    이 앱(Block Weld)은 직접 접속(IP:31880/<사번>) 시엔 정상이지만, 서브패스로 감싸면
    HTML 속성 치환(_rewrite_html_links)만으로는 다음 세 가지가 깨진다. 이를 클라이언트
    런타임에서 보정한다.
      1) location.pathname 첫 세그먼트로 사번을 추출(app.js: split('/')[0]) → 프록시에선
         'external-apps'를 사번으로 오인. history.replaceState 로 프리픽스를 제거해 앱이
         보는 pathname 을 '/<사번>' 으로 되돌린다.
      2) 런타임 fetch / XMLHttpRequest 가 루트 절대경로(/api, /vendor ...)를 사용 → 창
         origin(WorkBench 9091)으로 새어 WorkBench API 와 충돌. 절대경로에 프리픽스를 자동
         부착한다. (앱은 절대경로만 사용 — 상대경로는 건드리지 않는다.)
    importmap 의 절대경로 모듈 URL 은 HTML 단계(_rewrite_html_links)에서 별도 치환한다.
    """
    prefix = json.dumps(proxy_path)  # 안전한 JS 문자열 리터럴
    return (
        "<script>(function(){"
        f"var P={prefix};"
        "function fix(u){try{"
        "if(typeof u!=='string'||!u)return u;"
        "if(u===P||u.indexOf(P+'/')===0)return u;"  # 이미 프리픽스됨
        "if(u.charAt(0)==='/'&&u.charAt(1)!=='/')return P+u;"  # 루트 절대경로
        "var o=location.origin+'/';"
        "if(u.indexOf(o)===0){var pth=u.slice(location.origin.length);"
        "if(pth!==P&&pth.indexOf(P+'/')!==0)return location.origin+P+pth;}"  # 동일 origin 절대 URL
        "}catch(e){}return u;}"
        # 1) pathname 프리픽스 제거 → 앱의 사번 파싱 정상화
        "try{var p=location.pathname;"
        "if(p===P)history.replaceState(history.state,'','/'+location.search+location.hash);"
        "else if(p.indexOf(P+'/')===0)"
        "history.replaceState(history.state,'',p.slice(P.length)+location.search+location.hash);"
        "}catch(e){}"
        # 2) fetch 가로채기
        "var F=window.fetch;if(F){window.fetch=function(i,init){try{"
        "if(typeof i==='string')i=fix(i);"
        "else if(i&&i.url){var nu=fix(i.url);if(nu!==i.url)i=new Request(nu,i);}"
        "}catch(e){}return F.call(this,i,init);};}"
        # 3) XMLHttpRequest 가로채기(THREE 로더 등 내부 XHR 포함 대비)
        "var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){"
        "var a=Array.prototype.slice.call(arguments);"
        "try{if(typeof a[1]==='string')a[1]=fix(a[1]);}catch(e){}"
        "return XO.apply(this,a);};"
        "})();</script>"
    )


def _rewrite_html_links(content: bytes, content_type: str, proxy_path: str) -> bytes:
    if "text/html" not in content_type.lower():
        return content

    try:
        html = content.decode("utf-8")
    except UnicodeDecodeError:
        return content

    # 1) HTML 속성의 루트 절대경로 치환 (정적 자산: css/js/img/meta/form)
    replacements = {
        'href="/': f'href="{proxy_path}/',
        'src="/': f'src="{proxy_path}/',
        'action="/': f'action="{proxy_path}/',
        'content="/': f'content="{proxy_path}/',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)

    # 2) importmap(JSON) 내부의 루트 절대경로 모듈 URL 치환.
    #    HTML 속성이 아니라 JSON 값(": "/vendor/...")이라 위 속성 치환이 못 잡는다.
    #    importmap 블록 안에서 값 시작 패턴 '"/' 만 치환 → 키('"three/addons/")는 영향 없음.
    def _fix_importmap(match):
        block = match.group(2).replace('"/', f'"{proxy_path}/')
        return match.group(1) + block + match.group(3)

    html = re.sub(
        r'(<script[^>]*type=["\']importmap["\'][^>]*>)(.*?)(</script>)',
        _fix_importmap,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # 3) 런타임 fetch/XHR 절대경로 + pathname 기반 사번 파싱 보정 shim 주입.
    #    app.js(모듈, 문서 하단)보다 먼저 실행되도록 head 끝에 삽입한다.
    shim = _build_subpath_shim(proxy_path)
    if "</head>" in html:
        html = html.replace("</head>", shim + "</head>", 1)
    elif "<head>" in html:
        html = html.replace("<head>", "<head>" + shim, 1)
    else:
        html = shim + html

    return html.encode("utf-8")


async def _proxy_block_weld(request: Request, path: str = ""):
    upstream_origin = BLOCK_WELD_UPSTREAM.rstrip("/")
    proxy_origin = str(request.base_url).rstrip("/")
    proxy_base = f"{proxy_origin}{BLOCK_WELD_PROXY_PATH}"
    target_url = urljoin(BLOCK_WELD_UPSTREAM, path)
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    headers = _filter_headers(request.headers)
    headers["host"] = urlparse(BLOCK_WELD_UPSTREAM).netloc
    client = get_block_weld_client()

    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                target_url,
                content=await request.body(),
                headers=headers,
            ),
            stream=True,
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Block Weld upstream server is unavailable: {exc}",
        ) from exc

    response_headers = _proxy_response_headers(upstream.headers, upstream_origin, proxy_base)
    content_type = upstream.headers.get("content-type", "")
    if "text/html" not in content_type.lower():
        return StreamingResponse(
            upstream.aiter_bytes(),
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=content_type,
            background=BackgroundTask(upstream.aclose),
        )

    try:
        content = _rewrite_html_links(await upstream.aread(), content_type, BLOCK_WELD_PROXY_PATH)
        return Response(
            content=content,
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=content_type,
        )
    finally:
        await upstream.aclose()


@router.api_route("/block-weld", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_block_weld_root(request: Request):
    return await _proxy_block_weld(request)


@router.get("/block-weld/__wb_proxy_health")
async def proxy_block_weld_health():
    target_url = urljoin(BLOCK_WELD_UPSTREAM, "")
    client = get_block_weld_client()
    try:
        upstream = await client.send(client.build_request("GET", target_url), stream=True)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Block Weld upstream server is unavailable: {exc}",
        ) from exc

    try:
        return JSONResponse(
            {"ok": upstream.status_code < 500, "upstreamStatus": upstream.status_code},
            status_code=200 if upstream.status_code < 500 else 502,
        )
    finally:
        await upstream.aclose()


@router.api_route("/block-weld/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_block_weld_path(request: Request, path: str):
    return await _proxy_block_weld(request, path)
