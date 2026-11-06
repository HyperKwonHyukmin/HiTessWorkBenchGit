"""관리자 All Projects — 해석 1건의 작업 폴더 찾기·파일 목록·Hi-TESS LogBook 보내기.

- 작업 폴더 = input_info/result_info 안의 userConnection 경로(중첩 dict·list 포함)가 가리키는 최상위 폴더.
  권상 부모(GroupModuleUnit/SidePassage)는 세부 검토 자식(parent_analysis_id)의 폴더도 함께 본다.
- LogBook 보내기는 서버끼리 전송이다. LogBook `/api/integration/uploads*`(19)에 공유 비밀키로
  시작 → 8MB 조각 → 마치기를 부르고, 묶음은 보낸 관리자 이름의 '정리 대기'로 들어간다.
  계약 원본: LogBook 저장소 `backend/app/routers/integration.py` 의 'WorkBench → LogBook 보내기'.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from typing import Iterable, Optional

import httpx

from .. import models
from . import logbook_integration as lb

logger = logging.getLogger(__name__)

MAX_LIST_FILES = 5000           # 폴더 하나가 이보다 많으면 목록을 자른다(truncated)
MAX_EXPORT_FILES = 1000
MAX_EXPORT_BYTES = 4 * 1024 ** 3
CHUNK_SIZE = 8 * 1024 * 1024    # LogBook MAX_CHUNK(8MB + 여유)와 맞춘다
DRM_MAGIC = b"HHIDRMC"
EXPORT_TIMEOUT = httpx.Timeout(120.0, connect=10.0)

# 테스트가 httpx.MockTransport 를 끼워 넣는 자리(운영에서는 None = 실제 네트워크).
_http_transport: Optional[httpx.BaseTransport] = None


# ── 해석 여권 요약(Hi-TESS Core 1단계) ────────────────────────────────────────────
PASSPORT_MAX_ARTIFACTS = 500   # LogBook wb_origin.MAX_ARTIFACTS 와 같다


def passport_summary(record: models.Analysis, user_connection_base: str) -> Optional[dict]:
    """LogBook 으로 보낼 여권 요약 {artifacts: [{role, name, sha256, size}]} — 검증된(verified) 산출물만.
    여권을 만들지 못하거나 검증된 산출물이 없으면 None(보내기는 여권 없이 계속한다)."""
    from .analysis_passport import build_analysis_passport

    try:
        passport = build_analysis_passport(record, user_connection_base=user_connection_base)
    except Exception:  # noqa: BLE001 — 여권은 덧붙이는 정보다. 실패가 보내기를 막지 않는다
        logger.warning("해석 여권 생성 실패 — 여권 없이 보냄: analysis=%s", record.id, exc_info=True)
        return None
    out = [{"role": a.get("role"), "name": a.get("name"), "sha256": a.get("sha256"), "size": a.get("sizeBytes")}
           for a in passport.get("artifacts") or []
           if a.get("status") == "verified" and a.get("sha256")][:PASSPORT_MAX_ARTIFACTS]
    return {"artifacts": out} if out else None


# ── 작업 폴더 ──────────────────────────────────────────────────────────────────

def _iter_strings(value) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _iter_strings(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _iter_strings(v)


def _under(base_abs: str, value: str) -> Optional[str]:
    """userConnection 아래 경로면 정규화한 절대 경로, 아니면 None."""
    if not value or len(value) > 1024:
        return None
    try:
        path_abs = os.path.abspath(value)
    except (TypeError, ValueError):
        return None
    base_norm = os.path.normcase(base_abs)
    if not os.path.normcase(path_abs).startswith(base_norm + os.sep):
        return None
    return path_abs


def _folder_of(base_abs: str, path_abs: str) -> Optional[str]:
    try:
        first = os.path.relpath(path_abs, base_abs).split(os.sep, 1)[0]
    except ValueError:   # 다른 드라이브·장치 경로(\\.\nul 등) — 작업 폴더가 아니다
        return None
    return first if first and first not in (".", "..") else None


def _info_paths(record: models.Analysis, base_abs: str) -> tuple[set[str], set[str], set[str]]:
    """(입력 경로, 결과 경로, 작업 폴더 이름) — 경로는 normcase 한 절대 경로, 폴더는 원래 대소문자."""
    out = []
    folders: set[str] = set()
    for info in (record.input_info, record.result_info):
        found = set()
        for value in _iter_strings(info or {}):
            path_abs = _under(base_abs, value)
            if path_abs:
                found.add(os.path.normcase(path_abs))
                name = _folder_of(base_abs, path_abs)
                if name:
                    folders.add(name)
        out.append(found)
    return out[0], out[1], folders


def related_records(db, record: models.Analysis, substep_programs: Iterable[str]) -> list[models.Analysis]:
    """이 해석 + 세부 검토 자식(input_info.parent_analysis_id == id). 자식은 같은 사번·이후 시각만 본다."""
    rows = [record]
    programs = list(substep_programs)
    if not programs:
        return rows
    q = db.query(models.Analysis).filter(
        models.Analysis.program_name.in_(programs),
        models.Analysis.employee_id == record.employee_id,
    )
    if record.created_at is not None:
        q = q.filter(models.Analysis.created_at >= record.created_at)
    for child in q.all():
        info = child.input_info if isinstance(child.input_info, dict) else {}
        try:
            if int(info.get("parent_analysis_id")) == int(record.id):
                rows.append(child)
        except (TypeError, ValueError):
            continue
    return rows


def resolve(records: list[models.Analysis], base_dir: str) -> dict:
    """작업 폴더(이름 → 절대 경로)와 입력/결과 경로 집합."""
    base_abs = os.path.abspath(base_dir)
    inputs: set[str] = set()
    results: set[str] = set()
    folders: dict[str, str] = {}
    for r in records:
        i, o, names = _info_paths(r, base_abs)
        inputs |= i
        results |= o
        for name in sorted(names):
            # Windows 는 대소문자를 가리지 않는다 — 같은 폴더를 두 번 넣지 않는다
            if not any(os.path.normcase(n) == os.path.normcase(name) for n in folders):
                folders[name] = os.path.join(base_abs, name)
    return {"base": base_abs, "folders": folders, "inputs": inputs, "results": results}


# Windows 예약 장치 이름(nul·con·aux·prn·com1~9·lpt1~9, 확장자가 붙어도 같다). 셸의 '> nul' 이 실수로
# 만든 파일 등 — Python 3.13+ 는 이 경로를 \\.\nul 장치로 바꿔 relpath 가 ValueError 를 낸다(145 에서 목록 전체 500).
# 읽어도 장치를 읽게 되므로 목록·보내기에서 뺀다.
_WIN_RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", re.IGNORECASE)


def _is_drm(path: str) -> bool:
    try:
        with open(path, "rb") as fh:
            return fh.read(len(DRM_MAGIC)) == DRM_MAGIC
    except OSError:
        return False


def list_files(resolved: dict) -> dict:
    files = []
    truncated = False
    for name, full in resolved["folders"].items():
        if not os.path.isdir(full):
            continue
        count = 0
        for dirpath, dirnames, filenames in os.walk(full):
            dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
            for fn in sorted(filenames):
                if count >= MAX_LIST_FILES:
                    truncated = True
                    break
                if _WIN_RESERVED.match(fn):
                    continue
                path = os.path.join(dirpath, fn)
                try:
                    st = os.stat(path)
                    rel = os.path.relpath(path, full).replace(os.sep, "/")
                    modified = datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")
                except (OSError, ValueError, OverflowError):
                    # 파일 하나가 이상해도(경로 계산·수정 시각) 목록 전체를 실패시키지 않는다
                    logger.warning("작업 폴더 파일을 목록에서 뺌: %s", path, exc_info=True)
                    continue
                norm = os.path.normcase(os.path.abspath(path))
                role = "input" if norm in resolved["inputs"] else "result" if norm in resolved["results"] else "other"
                files.append({
                    "path": path,
                    "folder": name,
                    "rel": rel,
                    "size": st.st_size,
                    "modified": modified,
                    "role": role,
                    "drm": _is_drm(path),
                })
                count += 1
            if count >= MAX_LIST_FILES:
                break
    return {
        "folders": [{"name": n, "exists": os.path.isdir(p)} for n, p in resolved["folders"].items()],
        "files": files,
        "truncated": truncated,
    }


# LogBook 49 — 권상(Module Unit) 해석은 Wire 를 설치한 모델과 권상 위치 JSON 을 늘 함께 보낸다.
# 나중에 Module Unit Studio 등에서 이전 실적의 권상 위치(lug·apex·wire)를 찾으려면 모델만으로는 모자란다.
LIFTING_PROGRAMS = ("GroupModuleUnit", "SidePassage")
LIFTING_SUFFIXES = ("_lifting.bdf", "_lifting_meta.json", "_posture.json")


def lifting_paths(resolved: dict) -> list[str]:
    """작업 폴더(부모 + Unit 구조 해석 자식) 바로 아래의 Wire 모델·권상 위치 JSON(최종본) 경로.
    하위 폴더(`lifting_reviews/<해시>/03_…` 등 Studio 검토 때마다 남는 중간본)는 자동으로 더하지 않는다 — 같은 Wire 모델이
    여러 벌 LogBook 에 들어갔다(2026-11-04). 관리자가 직접 고른 파일은 그대로 보낸다. DRM 파일은 뺀다(LogBook 이 받지 않는다)."""
    return [f["path"] for f in list_files(resolved)["files"]
            if "/" not in f["rel"] and f["rel"].lower().endswith(LIFTING_SUFFIXES) and not f["drm"]]


def with_lifting(program: str, resolved: dict, requested: list[str]) -> tuple[list[str], list[str]]:
    """권상 해석이면 고르지 않은 Wire 파일을 더한다 → (보낼 경로, 자동으로 더한 파일 이름)."""
    if program not in LIFTING_PROGRAMS:
        return list(requested), []
    chosen = {os.path.normcase(os.path.realpath(os.path.abspath(p))) for p in requested if isinstance(p, str) and p}
    out, added = list(requested), []
    for p in lifting_paths(resolved):
        if os.path.normcase(os.path.realpath(p)) not in chosen:
            out.append(p)
            added.append(os.path.basename(p))
    return out, added


# 2026-11-06 — Wire 모델을 보낼 때 함께 보내기를 권하는 구조 해석 결과 세트. 나중에 Studio 가 실적을 부르면
# 'Unit 구조 해석 결과 화면' 그대로 띄우려면 결과 JSON 과 그 결과를 낸 모델 JSON 이 함께 있어야 한다(Studio 는 BDF·F06 을 못 읽는다).
# F06 은 원본 증거이자 허용응력을 바꿔 다시 판정할 때 쓴다. 강제로 더하지 않고 화면이 미리 체크만 한다(관리자가 뺄 수 있다).
# 계획: docs/plans/2026-11-06-mu-lifting-reference-stress-check.md
LIFTING_RESULT_SUFFIX = "_lifting_nastranResult.json"


def _mtime(path: str) -> float:
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def lifting_recommendation(program: str, listing: dict) -> dict | None:
    """권상 해석이면 함께 보내기를 권하는 파일 → {wire: [경로], result: [경로], missing: [사유]}. 권상 해석이 아니면 None.
    대상은 폴더 바로 아래 파일만(`lifting_paths` 와 같은 기준). 결과 세트는 결과 JSON 이 있는 stem 마다
    결과 JSON + `<stem>_lifting.f06`(Nastran 이 소문자로 씀) + 해석에 쓴 모델 JSON(`<stem>_edited.json`, 없으면 `<stem>.json`
    — unit_structural_service 가 Wire BDF 를 만들 때와 같은 우선순위)."""
    if program not in LIFTING_PROGRAMS:
        return None
    top_all = [f for f in listing.get("files", []) if "/" not in f["rel"]]
    top = [f for f in top_all if not f["drm"]]
    by_name = {(f["folder"], f["rel"].lower()): f["path"] for f in top}
    wire = [f["path"] for f in top if f["rel"].lower().endswith(LIFTING_SUFFIXES)]
    result: list[str] = []
    missing: list[str] = []
    # DRM 에 감싸진 결과 JSON 은 LogBook 이 받지 않는다 — '결과 없음' 이 아니라 DRM 이라고 알린다
    for f in top_all:
        if f["drm"] and f["rel"].lower().endswith(LIFTING_RESULT_SUFFIX.lower()):
            missing.append(f"{f['rel']} 이 DRM 으로 암호화됨")
    for f in top:
        name = f["rel"].lower()
        if not name.endswith(LIFTING_RESULT_SUFFIX.lower()):
            continue
        stem = name[: -len(LIFTING_RESULT_SUFFIX)]
        result.append(f["path"])
        f06 = by_name.get((f["folder"], f"{stem}_lifting.f06"))
        model = by_name.get((f["folder"], f"{stem}_edited.json")) or by_name.get((f["folder"], f"{stem}.json"))
        if f06:
            result.append(f06)
        else:
            missing.append(f"{f['rel']} 의 F06 없음")
        if model:
            result.append(model)
            # 구조 해석 뒤 Studio 에서 더 편집하고 자세안정성만 다시 돌리면 _edited.json 만 새것이 된다 —
            # 결과(elementId)와 모델이 어긋나 실적 보기에서 색이 빠진다. 보내기 전에 알린다.
            if _mtime(model) > _mtime(f["path"]) + 1:
                missing.append(f"{os.path.basename(model)} 이 구조 해석 뒤에 바뀜 — 결과와 모델이 어긋날 수 있으니 구조 해석을 다시 돌린 뒤 보내세요")
        else:
            missing.append(f"{f['rel']} 의 모델 JSON 없음")
    if wire and not any(p.lower().endswith(LIFTING_RESULT_SUFFIX.lower()) for p in result)             and not any("DRM" in m for m in missing):
        missing.append("구조 해석 결과 JSON 없음")
    return {"wire": wire, "result": result, "missing": missing}


# 2026-11-06 — 여러 건 보내기(All Projects '여러 건 보내기'). 기록마다 보낼 파일을 규칙 하나로 정한다:
# 입력 BDF(작업 폴더 바로 아래 input 역할 BDF) + Wire 세트 + 결과 세트. 계획: docs/plans/2026-11-06-all-projects-bulk-logbook-send.md
MAX_BULK_PLAN = 50
_BDF_EXTS = (".bdf", ".dat", ".nas", ".blk", ".bulk")


def _bulk_hull(record, model_path: str | None) -> str | None:
    from . import hull_no as hull_service
    info = record.input_info if isinstance(record.input_info, dict) else {}
    return hull_service.normalize_hull_no(info.get("hull_no")) or hull_service.suggest_hull_no_from_filename(model_path)


def bulk_title(record, model_path: str | None) -> str:
    """묶음 이름 — '<호선> <모델 이름> 권상 · WB #<id>'. LogBook 정리 대기 목록에서 Unit 을 구분하게."""
    stem = os.path.splitext(os.path.basename(model_path))[0] if model_path else (record.project_name or record.program_name)
    hull = _bulk_hull(record, model_path)
    label = f"{hull} {stem}" if hull and not stem.upper().startswith(hull) else stem
    return f"{label} 권상 · WB #{record.id}"[:200]


def bulk_plan_item(record, resolved: dict, files_available: bool) -> dict:
    """기록 1건의 보내기 계획 → {id, ok, reason, title, model, files:[{path,size}], totalBytes, hasResult, warnings}."""
    base = {"id": record.id, "ok": False, "reason": None, "title": None, "model": None,
            "files": [], "totalBytes": 0, "hasResult": False, "warnings": []}
    if record.program_name not in LIFTING_PROGRAMS:
        return {**base, "reason": "권상 해석이 아닙니다"}
    if record.status != "Success":
        return {**base, "reason": "성공하지 않은 해석입니다"}
    if not files_available:
        return {**base, "reason": "파일 보관 기간이 지났습니다"}
    listing = list_files(resolved)
    rec = lifting_recommendation(record.program_name, listing) or {"wire": [], "result": [], "missing": []}
    if not rec["wire"]:
        return {**base, "reason": "Wire 모델이 없습니다(구조 해석 전)"}
    sizes = {f["path"]: f["size"] for f in listing["files"]}
    models_ = [f["path"] for f in listing["files"]
               if f["role"] == "input" and "/" not in f["rel"] and not f["drm"] and f["rel"].lower().endswith(_BDF_EXTS)]
    model = models_[0] if models_ else None
    paths = list(dict.fromkeys(([model] if model else []) + rec["wire"] + rec["result"]))
    total = sum(sizes.get(p, 0) for p in paths)
    # 1건 보내기 API 의 한도를 미리 본다 — 넘으면 보낼 때 422/413 으로 실패한다
    if len(paths) > MAX_EXPORT_FILES or total > MAX_EXPORT_BYTES:
        return {**base, "reason": "한 번에 보낼 수 있는 파일 수·크기를 넘습니다(상세 창에서 골라 보내세요)"}
    # 옛 실행 판정 키 — 파일 이름만 보면 다른 사용자·호선의 같은 이름(M05.bdf 등)이 한 모델로 묶인다
    run_key = "|".join([str(record.employee_id or "").upper(), _bulk_hull(record, model) or "",
                        os.path.basename(model).lower()]) if model else None
    return {**base, "ok": True, "runKey": run_key, "title": bulk_title(record, model), "model": os.path.basename(model) if model else None,
            "files": [{"path": p, "size": sizes.get(p, 0)} for p in paths],
            "totalBytes": total,
            "hasResult": any(p.lower().endswith(LIFTING_RESULT_SUFFIX.lower()) for p in rec["result"]),
            "warnings": rec["missing"]}


def mark_older_runs(items: list[dict], created: dict[int, object]) -> None:
    """같은 사용자·호선·입력 BDF 이름(runKey)을 여러 번 돌린 기록 — 가장 최근 1건만 두고 나머지에 olderRunOf(최신 id)를 단다(화면이 체크 해제).
    실행마다 Wire·결과 JSON 이 달라 모두 보내면 LogBook 에 같은 모델 자료가 여러 개 생긴다."""
    groups: dict[str, list[dict]] = {}
    for it in items:
        if it["ok"] and it.get("runKey"):
            groups.setdefault(it["runKey"], []).append(it)
    for group in groups.values():
        group.sort(key=lambda it: (created.get(it["id"]) is not None, created.get(it["id"]) or 0, it["id"]), reverse=True)
        for it in group[1:]:
            it["olderRunOf"] = group[0]["id"]


def select_paths(resolved: dict, requested: list[str]) -> list[tuple[str, str, str]]:
    """요청 경로를 작업 폴더 안의 실제 파일로 확인한다 → [(절대 경로, 폴더 이름, 폴더 기준 posix 상대 경로)].
    폴더 밖·없는 파일·중복은 ValueError(사유)."""
    roots = {os.path.normcase(os.path.realpath(full)): (name, os.path.realpath(full))
             for name, full in resolved["folders"].items()}
    picked: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for raw in requested:
        if not isinstance(raw, str) or not raw:
            raise ValueError("잘못된 파일 경로가 있습니다.")
        real = os.path.realpath(os.path.abspath(raw))
        norm = os.path.normcase(real)
        owner = next(((n, r) for key, (n, r) in roots.items() if norm.startswith(key + os.sep)), None)
        if owner is None:
            raise ValueError(f"이 해석의 작업 폴더 밖 파일입니다: {os.path.basename(raw)}")
        if not os.path.isfile(real):
            raise ValueError(f"파일이 없습니다(보관 기간 만료?): {os.path.basename(raw)}")
        if norm in seen:
            continue
        seen.add(norm)
        name, root = owner
        picked.append((real, name, os.path.relpath(real, root).replace(os.sep, "/")))
    return picked


# ── LogBook 보내기 ─────────────────────────────────────────────────────────────

class ExportError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


_LB_MESSAGES = {
    "sender_not_admin": "LogBook 이 이 계정을 WorkBench 관리자로 확인하지 못했습니다.",
    "sender_inactive": "LogBook 에서 이 계정이 비활성 상태입니다. LogBook 관리자에게 문의하세요.",
    "wb_unavailable": "LogBook 이 WorkBench 사용자 정보를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
    "storage_unreachable": "LogBook 저장소(공유 폴더)에 연결할 수 없습니다. 잠시 뒤 다시 시도하세요.",
    "integration_unauthorized": "LogBook 연동 비밀키가 맞지 않습니다(두 서버의 설정 확인).",
    "not_found": "LogBook 서버에 보내기 기능이 없거나 연동이 꺼져 있습니다(LogBook 업데이트·설정 확인).",
}


def _lb_detail(resp: httpx.Response):
    try:
        body = resp.json()
    except ValueError:
        return None
    return body.get("detail") if isinstance(body, dict) else None


def _raise_for(resp: httpx.Response, what: str) -> None:
    if resp.status_code < 400:
        return
    detail = _lb_detail(resp)
    code = detail if isinstance(detail, str) else (detail or {}).get("code") if isinstance(detail, dict) else None
    message = _LB_MESSAGES.get(code or "") or f"LogBook {what} 실패 (HTTP {resp.status_code}{', ' + code if code else ''})"
    raise ExportError(502, message)


def send_to_logbook(*, sender: str, name: str, origin: dict,
                    picked: list[tuple[str, str, str]]) -> dict:
    """선택한 파일을 LogBook 정리 대기로 보낸다. DRM 으로 암호화된 파일은 LogBook 이 받지 않아 rejected 로 넘긴다.
    돌려주는 것: {key, state, blocked, rejected, file_count, total_bytes}."""
    secret = lb.integration_secret()
    if not secret:
        raise ExportError(503, "LogBook 연동이 꺼져 있습니다(서버 LOGBOOK_INTEGRATION_SECRET 미설정).")
    base = lb.internal_url()
    headers = {lb.INTEGRATION_HEADER: secret}
    params = {"as": sender}
    declared, rejected = [], []
    total = 0
    try:
        with httpx.Client(timeout=EXPORT_TIMEOUT, transport=_http_transport) as client:
            r = client.post(f"{base}/api/integration/uploads", params=params, headers=headers,
                            json={"name": name[:255], "origin": origin})
            _raise_for(r, "묶음 시작")
            key = r.json()["key"]
            try:
                for real, folder, rel in picked:
                    lb_rel = f"{folder}/{rel}"
                    sent = 0
                    with open(real, "rb") as fh:
                        first = True
                        while True:
                            data = fh.read(CHUNK_SIZE)
                            if not data and not first:
                                break
                            r = client.put(f"{base}/api/integration/uploads/{key}/chunk",
                                           params={**params, "path": lb_rel, "offset": sent},
                                           headers={**headers, "Content-Type": "application/octet-stream"},
                                           content=data)
                            if first and r.status_code == 422 and _lb_detail(r) == "drm_encrypted":
                                rejected.append({"rel_path": lb_rel, "reason": "drm"})
                                sent = -1
                                break
                            _raise_for(r, f"파일 전송({rel})")
                            sent += len(data)
                            first = False
                            if not data:
                                break
                    if sent >= 0:
                        declared.append({"rel_path": lb_rel, "size": sent})
                        total += sent
                if not declared:
                    raise ExportError(422, "보낼 수 있는 파일이 없습니다(모두 회사 DRM 으로 암호화됨).")
                r = client.post(f"{base}/api/integration/uploads/{key}/finish", params=params, headers=headers,
                                json={"files": declared, "rejected": rejected})
                _raise_for(r, "묶음 마치기")
                body = r.json()
            except Exception:
                # 반쯤 올라간 묶음을 지운다(실패해도 LogBook 이 24시간 뒤 스스로 정리한다)
                try:
                    client.delete(f"{base}/api/integration/uploads/{key}", params=params, headers=headers)
                except httpx.HTTPError:
                    pass
                raise
    except httpx.HTTPError as exc:
        logger.warning("LogBook 보내기 연결 실패: %s", exc)
        raise ExportError(502, "LogBook 서버에 연결할 수 없습니다. 잠시 뒤 다시 시도하세요.") from None
    return {
        "key": body.get("key"),
        "state": body.get("state") or "staged",
        "blocked": body.get("blocked") or [],
        "rejected": rejected,
        "file_count": len(declared),
        "total_bytes": total,
    }
