"""지난 Unit 구조 해석 결과를 Studio 로 다시 볼 때 쓸 파일(모델 JSON + 결과 JSON)을 고른다.

계획: docs/plans/2026-11-11-mu-past-structural-result-view.md
결과의 elementId 는 '해석에 쓴 편집 모델' 기준이라, 모델은 그 실행이 실제로 쓴 것이어야 한다.
작업 폴더의 `<stem>_edited.json` 은 다음 해석 때 덮어써지므로 실행별 사본(lifting_reviews manifest)을 먼저 쓴다.
"""
import json
import os
from typing import Any, Optional

# 보관 도입 전 기록처럼 실행별 사본이 없어 작업 폴더 파일로 대신 열 때 붙이는 경고.
WORKDIR_MODEL_WARNING = "이 해석의 모델 사본이 없어 작업 폴더의 모델로 엽니다 — 해석 뒤 모델을 고쳤다면 응력 색이 어긋날 수 있습니다."


def _manifest(path: Optional[str]) -> Optional[dict]:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _archived(manifest: Optional[dict], manifest_path: Optional[str], key: str) -> Optional[str]:
    """manifest 의 key 항목 사본 경로(있고 파일이 남아 있을 때만)."""
    if not manifest or not manifest_path:
        return None
    entry = (manifest.get("artifacts") or {}).get(key) or {}
    name = entry.get("file")
    if not entry.get("available") or not name:
        return None
    # 파일명만 받아 manifest 폴더 안으로 묶는다(경로 조작 방지).
    path = os.path.join(os.path.dirname(manifest_path), os.path.basename(str(name)))
    return path if os.path.isfile(path) else None


def choose_result_set_files(result_info: dict) -> dict:
    """다시 보기에 쓸 파일 경로를 고른다.

    반환: {model, modelSource, result, stability, f06, warnings}
      modelSource = 'archive-edited' | 'workdir-original' | 'workdir-edited' | None
      model·result 가 None 이면 열 수 없다(호출자가 404).
    """
    info = result_info or {}
    warnings: list[str] = []
    bdf = info.get("bdf")
    bdf_dir = os.path.dirname(os.path.abspath(bdf)) if bdf else None
    stem = os.path.splitext(os.path.basename(bdf))[0] if bdf else None
    original = os.path.join(bdf_dir, f"{stem}.json") if bdf_dir else None
    workdir_edited = os.path.join(bdf_dir, f"{stem}_edited.json") if bdf_dir else None

    manifest_path = info.get("reviewManifestJson")
    manifest = _manifest(manifest_path)

    model, source = None, None
    if manifest is not None:
        model = _archived(manifest, manifest_path, "editedModel")
        if model:
            source = "archive-edited"
        else:
            entry = (manifest.get("artifacts") or {}).get("editedModel") or {}
            if entry.get("available"):
                # 편집 모델로 해석했는데 사본이 지워졌다 — 원본으로 열면 가서포트 등이 빠진다.
                warnings.append(WORKDIR_MODEL_WARNING)
            if original and os.path.isfile(original):
                model, source = original, "workdir-original"
    else:
        if workdir_edited and os.path.isfile(workdir_edited):
            model, source = workdir_edited, "workdir-edited"
        elif original and os.path.isfile(original):
            model, source = original, "workdir-original"
        if model:
            warnings.append(WORKDIR_MODEL_WARNING)

    result = _archived(manifest, manifest_path, "result")
    if not result:
        path = info.get("nastranResultJson")
        result = path if path and os.path.isfile(path) else None
    # 자세안정성 결과 — Studio 가 Wire·훅(apex) 위치를 여기서 그린다(없으면 Wire 없이 부재 응력만 보임).
    stability = _archived(manifest, manifest_path, "stability")
    if not stability:
        path = info.get("stabilityJson")
        stability = path if path and os.path.isfile(path) else None
    f06 = _archived(manifest, manifest_path, "f06") or (info.get("f06") if info.get("f06") and os.path.isfile(info["f06"]) else None)

    return {"model": model, "modelSource": source, "result": result, "stability": stability,
            "f06": f06, "warnings": warnings}


DRM_MAGIC = b"HHIDRMC"


def parse_json_bytes(data: bytes, label: str) -> Any:
    """read() 한 바이트를 JSON 으로. DRM 암호문·형식 오류는 ValueError(사용자 문구)."""
    if data[:7] == DRM_MAGIC:
        raise ValueError(f"{label} 파일이 회사 보안 암호화(DRM)로 잠겨 있어 읽을 수 없습니다.")
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise ValueError(f"{label} 파일 형식을 읽을 수 없습니다.")
