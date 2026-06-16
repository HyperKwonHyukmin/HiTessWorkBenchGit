"""Viewer 다운로드/배포 라우터.

viewer zip 패키지(예: model-studio-0.0.2.zip)를 사내 클라이언트(Workbench)에
배포한다. Workbench는 viewer 미설치 상태에서 manifest 로 메타데이터/해시를 받아
무결성 검증 후 download 엔드포인트로 zip 본체를 받아 자동 압축 해제한다.

엔드포인트:
- GET /api/viewers/manifest/{viewer_id}  : zip 내부 manifest.json + sha256 + size 반환
- GET /api/viewers/download/{viewer_id}  : zip 본체 스트리밍 다운로드

zip 검색 디렉터리 우선순위 (먼저 발견되는 곳 사용):
  1) VIEWER_DIRS  — 콤마 구분 다중 경로 (운영 환경 추천)
  2) VIEWER_DIR   — 단일 경로 (레거시 호환)
  3) <백엔드>/StudioProgram/   — 백엔드 옆 로컬 폴더 (운영 표준)
  4) 사내 storage UNC          — 개발 환경 기본값
"""
import hashlib
import json
import logging
import os
import re
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/viewers", tags=["viewers"])

# ── viewer zip 탐색 ──────────────────────────────────────────────────────────
_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_LOCAL_VIEWER_DIR = os.path.join(_BACKEND_ROOT, "StudioProgram")

# 운영 표준은 사내 storage UNC 이지만, 개발/단독 서버 배포에서는 백엔드 옆
# StudioProgram 폴더를 같이 스캔한다. 사용자 PC가 UNC에 직접 접근 가능한 경우에는
# uncPath를 내려 DRM/프록시 변조를 우회하고, 로컬 디스크 zip은 HTTP 다운로드로 폴백한다.
_DEFAULT_VIEWER_DIR = (
    r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44"
    r"\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram"
)


def _candidate_dirs() -> list[str]:
    """zip 검색 후보 디렉터리를 우선순위 순으로 반환 (중복 제거, 순서 보존).

    우선순위:
      1) VIEWER_DIRS env (콤마 구분 다중 경로) — 테스트 override
      2) VIEWER_DIR env (단일 경로) — 테스트 override
      3) <백엔드>/StudioProgram — 개발/단독 서버 배포
      4) 사내 storage UNC — 운영 표준
    """
    cands: list[str] = []

    multi = os.environ.get("VIEWER_DIRS", "")
    if multi:
        cands.extend(p.strip() for p in multi.split(",") if p.strip())

    single = os.environ.get("VIEWER_DIR", "")
    if single:
        cands.append(single)

    cands.append(_LOCAL_VIEWER_DIR)
    cands.append(_DEFAULT_VIEWER_DIR)

    seen: set[str] = set()
    out: list[str] = []
    for c in cands:
        norm = os.path.normpath(c)
        if norm in seen:
            continue
        seen.add(norm)
        out.append(c)
    return out


def _is_valid_zip_with_manifest(zip_path: str) -> bool:
    """zip 이 정상이고 루트에 manifest.json 이 있는지 검사.

    UNC 업로드 중 DRM/네트워크로 변조되어 EOCD 가 깨진 zip 을 거르기 위해 사용.
    True 인 zip 만 _find_zip() 의 fallback 후보로 채택한다.
    """
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            return "manifest.json" in zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return False


def _find_zip(viewer_id: str) -> str | None:
    """viewer_id 로 시작하는 zip 파일 중 가장 최신 *정상* 버전을 반환한다.

    여러 후보 디렉터리를 순서대로 탐색하며, 각 디렉터리 내에서는
    버전 내림차순으로 zip 무결성을 검사해 첫 정상 zip 을 반환한다.
    최상위 버전이 손상된 경우(EOCD 깨짐 등) 자동으로 다음 버전으로 폴백한다.
    """
    for d in _candidate_dirs():
        if not os.path.isdir(d):
            continue
        try:
            files = os.listdir(d)
        except OSError as e:
            logger.warning("[viewers] listdir(%s) 실패: %s", d, e)
            continue
        candidates = [
            f for f in files
            if f.startswith(viewer_id) and f.lower().endswith(".zip")
        ]
        if not candidates:
            continue
        # 버전 숫자 자연 정렬 (lex 정렬 시 0.0.9 > 0.0.11 로 잘못 비교되는 문제 회피).
        # 파일명에서 정수 시퀀스를 모두 추출해 튜플 비교 — semver 0.0.x 부터 1.2.3 까지 일관 동작.
        candidates.sort(key=_version_key, reverse=True)
        for name in candidates:
            full = os.path.join(d, name)
            if _is_valid_zip_with_manifest(full):
                return full
            logger.warning(
                "[viewers] zip 무결성 실패, 다음 버전으로 폴백 — %s", full
            )
    return None


def _version_key(filename: str) -> tuple[int, ...]:
    """파일명의 정수 시퀀스를 튜플로 반환. 비교 키로 사용."""
    return tuple(int(n) for n in re.findall(r"\d+", filename))


def _diagnostic_search(viewer_id: str) -> list[dict]:
    """404 응답에 포함될 진단 정보 — 어느 후보가 어떻게 실패했는지 기록.

    각 matching zip 의 유효성(valid)을 함께 보고해 손상 zip 을 즉시 식별할 수 있게 한다.
    """
    diags: list[dict] = []
    for d in _candidate_dirs():
        info: dict = {"dir": d, "exists": os.path.isdir(d)}
        if info["exists"]:
            try:
                files = os.listdir(d)
                info["fileCount"] = len(files)
                matching = [
                    f for f in files
                    if f.startswith(viewer_id) and f.lower().endswith(".zip")
                ]
                info["matchingZips"] = [
                    {
                        "name": name,
                        "valid": _is_valid_zip_with_manifest(os.path.join(d, name)),
                    }
                    for name in matching
                ]
            except OSError as e:
                info["error"] = str(e)
        diags.append(info)
    return diags


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_zip_bytes(path: str) -> bytes:
    """zip 본문을 통째로 읽어 반환한다.

    회사 DRM 이 로컬 디스크 파일을 at-rest 로 암호화(+패딩)하는 환경에서는
    os.path.getsize(=stat) 가 '암호화된 on-disk 크기'를, read() 는 '복호화된 본문'을
    돌려준다(백엔드는 DRM 화이트리스트). 둘이 다르면 Content-Length 와 실제 전송
    바이트가 어긋나 클라이언트가 ERR_CONTENT_LENGTH_MISMATCH 로 실패한다.
    그래서 size/sha256/다운로드 본문을 모두 '실제 read() 한 바이트' 로 통일한다.
    """
    with open(path, "rb") as f:
        return f.read()


def _read_manifest_from_zip(zip_path: str) -> dict | None:
    """zip 루트의 manifest.json 을 dict 로 반환한다."""
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            try:
                with zf.open("manifest.json") as mf:
                    return json.loads(mf.read().decode("utf-8"))
            except KeyError:
                return None
    except zipfile.BadZipFile:
        return None


@router.get("/manifest/{viewer_id}")
def get_viewer_manifest(viewer_id: str):
    """viewer 메타데이터(manifest + sha256 + size + downloadUrl) 반환.

    Workbench 는 이 정보로 다운로드 진행률/무결성 검증을 처리한다.
    """
    zip_path = _find_zip(viewer_id)
    if not zip_path:
        diag = _diagnostic_search(viewer_id)
        logger.error("[viewers] manifest 404 — viewer_id=%s, searched=%s", viewer_id, diag)
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"viewer not found: {viewer_id}",
                "searched": diag,
                "hint": (
                    "백엔드가 viewer zip 을 못 찾음. 운영 환경에선 "
                    "HiTessWorkBenchBackEnd/StudioProgram/ 에 zip 을 복사하거나 "
                    "VIEWER_DIR/VIEWER_DIRS 환경변수로 zip 폴더를 지정하세요."
                ),
            },
        )

    manifest = _read_manifest_from_zip(zip_path)
    if not manifest:
        raise HTTPException(status_code=500, detail="manifest.json missing in zip")

    # uncPath 는 사용자 PC 가 직접 접근 가능한 UNC 경로(`\\server\...`)일 때만 의미가 있다.
    # 백엔드 로컬 디스크 경로(예: D:\app\...)는 사용자 PC 에서 접근 불가하므로 제외해야
    # Electron 측이 자동으로 HTTP 다운로드 경로로 폴백한다.
    # size/sha256 은 실제 read() 한 바이트 기준 — download_viewer 가 보내는 본문과 1:1 일치.
    # (os.path.getsize 는 DRM at-rest 암호화 환경에서 본문과 어긋날 수 있어 쓰지 않는다.)
    data = _read_zip_bytes(zip_path)
    is_unc = zip_path.startswith("\\\\") or zip_path.startswith("//")
    response_body = {
        "manifest": manifest,
        "downloadUrl": f"/api/viewers/download/{viewer_id}",
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "fileName": os.path.basename(zip_path),
    }
    if is_unc:
        # DRM/프록시가 HTTP 다운로드를 변조하는 환경에서 사용자 PC 가 직접 fs.copyFile 가능
        response_body["uncPath"] = zip_path

    return JSONResponse(response_body)


@router.get("/download/{viewer_id}")
def download_viewer(viewer_id: str):
    """zip 본체 다운로드. Content-Disposition 으로 파일명 명시."""
    zip_path = _find_zip(viewer_id)
    if not zip_path:
        logger.error("[viewers] download 404 — viewer_id=%s", viewer_id)
        raise HTTPException(status_code=404, detail=f"viewer not found: {viewer_id}")

    # FileResponse 는 Content-Length 를 os.stat(=암호화된 on-disk 크기)로 잡아 DRM 환경에서
    # 실제 전송 본문(복호화)과 어긋난다. read() 한 바이트를 직접 보내 Content-Length 를
    # 본문 길이와 일치시킨다(ERR_CONTENT_LENGTH_MISMATCH 방지).
    data = _read_zip_bytes(zip_path)
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{os.path.basename(zip_path)}"',
            "Content-Length": str(len(data)),
        },
    )
