"""Viewer 다운로드/배포 라우터.

ViewerProgram/ 디렉터리에 보관된 viewer zip 패키지를 사내 클라이언트(Workbench)에
배포한다. Workbench는 viewer 미설치 상태에서 manifest 로 메타데이터/해시를 받아
무결성 검증 후 download 엔드포인트로 zip 본체를 받아 자동 압축 해제한다.

엔드포인트:
- GET /api/viewers/manifest/{viewer_id}  : zip 내부 manifest.json + sha256 + size 반환
- GET /api/viewers/download/{viewer_id}  : zip 본체 스트리밍 다운로드
"""
import hashlib
import json
import os
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(prefix="/api/viewers", tags=["viewers"])

# 회사 DRM 이 로컬 zip 을 자동 변형하는 문제를 우회하기 위해 사내 스토리지(UNC) 경로 사용.
# 환경변수 VIEWER_DIR 로 오버라이드 가능. 미설정 시 권혁민 책임의 사내 스토리지 폴더 사용.
# 2026-04-30: ModelBuilderStudio 재구성에 따라 ViewerProgram → StudioProgram 폴더로 이전.
_DEFAULT_VIEWER_DIR = (
    r"\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44"
    r"\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram"
)
VIEWER_DIR = os.environ.get("VIEWER_DIR", _DEFAULT_VIEWER_DIR)


def _find_zip(viewer_id: str) -> str | None:
    """viewer_id 로 시작하는 zip 파일 중 가장 최신 버전을 반환한다."""
    if not os.path.isdir(VIEWER_DIR):
        return None
    candidates = [
        f for f in os.listdir(VIEWER_DIR)
        if f.startswith(viewer_id) and f.lower().endswith(".zip")
    ]
    if not candidates:
        return None
    # 파일명에 버전이 포함되어 있어 단순 역정렬로 최신 우선
    candidates.sort(reverse=True)
    return os.path.join(VIEWER_DIR, candidates[0])


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


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
        raise HTTPException(status_code=404, detail=f"viewer not found: {viewer_id}")

    manifest = _read_manifest_from_zip(zip_path)
    if not manifest:
        raise HTTPException(status_code=500, detail="manifest.json missing in zip")

    return JSONResponse({
        "manifest": manifest,
        "downloadUrl": f"/api/viewers/download/{viewer_id}",
        # 사내 storage UNC 절대경로. 사용자 PC 도 이 경로에 직접 접근 가능하므로
        # DRM/프록시가 HTTP 다운로드를 변조하는 환경에서 fs.copyFile 로 우회 가능.
        "uncPath": zip_path,
        "sha256": _sha256(zip_path),
        "size": os.path.getsize(zip_path),
        "fileName": os.path.basename(zip_path),
    })


@router.get("/download/{viewer_id}")
def download_viewer(viewer_id: str):
    """zip 본체 다운로드. Content-Disposition 으로 파일명 명시."""
    zip_path = _find_zip(viewer_id)
    if not zip_path:
        raise HTTPException(status_code=404, detail=f"viewer not found: {viewer_id}")

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=os.path.basename(zip_path),
    )
