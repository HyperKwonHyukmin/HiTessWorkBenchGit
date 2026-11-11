"""Model Builder 입력 CSV 보관 — userConnection 은 30일 뒤 지워지므로 원본 CSV 를 따로 모은다.

보관 위치: DataStorage/ModelBuilderCsv/ (환경변수 MB_CSV_ARCHIVE_DIR 로 바꿀 수 있음, git·30일 정리 대상 아님)
  <호선>/<원래 파일명>          — 호선 = 파일명 앞 4자리(hull_no.suggest_hull_no_from_filename), 없으면 _unknown
  manifest.csv                  — 본 자리마다 한 줄(해시·저장 경로·원래 폴더·사번·실행 시각·종류)

규칙
- 내용(sha256)이 같은 파일은 한 번만 저장한다. 같은 CSV 로 여러 번 실행하는 일이 많다(70 실측 81개 중 9개).
- 같은 호선 폴더에 같은 파일명이 이미 있으면 내용이 달라도 저장하지 않는다(먼저 본 것 하나만, 사용자 결정 2026-11-12).
  수집 스크립트는 폴더 이름(=실행 시각) 순으로 훑으므로 가장 오래된 실행의 파일이 남는다.
- 같은 원래 경로·같은 해시는 manifest 에 다시 적지 않는다 → 수집 스크립트를 여러 번 돌려도 안전하다.
- 회사 DRM 암호문(HHIDRMC 머리)은 저장하지 않는다(암호문은 쓸모가 없다).
- 원본은 읽기만 한다.

쓰는 곳: hitess_modelflow_service.task_execute_modelflow(새 실행마다, MB·AM 연동 공통) ·
scripts/collect_mb_csv.py(이미 쌓인 작업 폴더 일괄 수집). 끄기: MB_CSV_ARCHIVE=0(테스트 conftest 가 끈다).
"""
from __future__ import annotations

import csv
import hashlib
import logging
import os
import re
import threading
from datetime import datetime
from typing import Dict, Iterable, List, Optional

from .hull_no import suggest_hull_no_from_filename

logger = logging.getLogger(__name__)

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))

# Model Builder 입력이 있는 작업 폴더 — 이름 끝 프로그램 이름(<ts>_<사번>_<프로그램>)
MB_FOLDER_MARKERS = ("HiTessModelBuilder", "AmToModelBuilder")
_FOLDER_RE = re.compile(r"^(\d{8})_(\d{6})_([^_]+)_(.+)$")
_DRM_MAGIC = b"HHIDRMC"
MANIFEST_NAME = "manifest.csv"
MANIFEST_FIELDS = [
    "sha256", "stored_path", "kind", "hull_no", "original_name",
    "source_folder", "employee_id", "run_at", "size_bytes", "archived_at",
]
UNKNOWN_HULL = "_unknown"

_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("MB_CSV_ARCHIVE", "1") != "0"


def archive_root() -> str:
    return os.path.abspath(
        os.environ.get("MB_CSV_ARCHIVE_DIR")
        or os.path.join(_BACKEND_DIR, "DataStorage", "ModelBuilderCsv")
    )


def guess_kind(name: str) -> str:
    """파일명으로 종류를 짐작한다(stru/pipe/equip). 모르면 빈 문자열."""
    low = name.lower()
    if "stru" in low:
        return "stru"
    if "pipe" in low:
        return "pipe"
    if "equ" in low:
        return "equip"
    return ""


def parse_folder_name(folder_name: str) -> Dict[str, str]:
    """'<yyyyMMdd>_<HHmmss>_<사번>_<프로그램>' → 사번·실행 시각. 모양이 다르면 빈 값."""
    m = _FOLDER_RE.match(folder_name or "")
    if not m:
        return {"employee_id": "", "run_at": ""}
    try:
        run_at = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").isoformat(sep=" ")
    except ValueError:
        run_at = ""
    return {"employee_id": m.group(3), "run_at": run_at}


def is_mb_folder(folder_name: str) -> bool:
    return any(folder_name.endswith(marker) for marker in MB_FOLDER_MARKERS)


def _read_manifest(root: str) -> List[Dict[str, str]]:
    path = os.path.join(root, MANIFEST_NAME)
    if not os.path.isfile(path):
        return []
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _append_manifest(root: str, row: Dict[str, str]) -> None:
    path = os.path.join(root, MANIFEST_NAME)
    new_file = not os.path.isfile(path)
    with open(path, "a", encoding="utf-8-sig" if new_file else "utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=MANIFEST_FIELDS)
        if new_file:
            writer.writeheader()
        writer.writerow(row)


def archive_csv(
    src_path: Optional[str],
    *,
    kind: str = "",
    source_folder: str = "",
    employee_id: str = "",
    run_at: str = "",
    root: Optional[str] = None,
) -> str:
    """CSV 하나를 보관한다. 결과: 'stored' | 'duplicate' | 'same_name' | 'seen' | 'drm' | 'missing'.

    stored    = 새 내용이라 복사함
    duplicate = 같은 내용이 이미 있음(manifest 에 이번 자리만 적음)
    same_name = 같은 파일명이 이미 있어 저장하지 않음(내용은 다름, manifest 에 stored_path 빈 줄)
    seen      = 같은 원래 폴더·같은 내용이 이미 manifest 에 있음(아무것도 안 함)
    """
    if not src_path or not os.path.isfile(src_path):
        return "missing"
    root = root or archive_root()
    with open(src_path, "rb") as fh:
        data = fh.read()
    if data.startswith(_DRM_MAGIC):
        logger.warning("[MbCsvArchive] DRM 암호문이라 보관하지 않음: %s", src_path)
        return "drm"
    sha = hashlib.sha256(data).hexdigest()
    name = os.path.basename(src_path)
    hull = suggest_hull_no_from_filename(name) or UNKNOWN_HULL

    with _lock:
        os.makedirs(root, exist_ok=True)
        rows = _read_manifest(root)
        if any(r.get("sha256") == sha and r.get("source_folder") == source_folder for r in rows):
            return "seen"
        existing = next((r["stored_path"] for r in rows
                         if r.get("sha256") == sha and os.path.isfile(os.path.join(root, r.get("stored_path", "")))),
                        None)
        if existing:
            stored_rel, result = existing, "duplicate"
        elif os.path.exists(os.path.join(root, hull, name)):
            # 같은 파일명이 이미 있으면 내용이 달라도 저장하지 않는다(사용자 결정 2026-11-12, 먼저 본 것 하나만).
            # manifest 에는 stored_path 를 비워 '어느 실행이 다른 내용을 썼는지' 만 남긴다.
            stored_rel, result = "", "same_name"
        else:
            stored_rel = os.path.join(hull, name)
            target = os.path.join(root, stored_rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            tmp = target + ".tmp"
            with open(tmp, "wb") as out:
                out.write(data)
            os.replace(tmp, target)
            result = "stored"
        try:
            _write_row(root, stored_rel, sha, kind, hull, name, source_folder, employee_id, run_at, len(data))
        except OSError:
            # manifest 가 잠겨 있으면(예: Excel 로 열어 둠) 방금 저장한 본문을 지운다 —
            # 기록 없는 파일이 남으면 다음 실행이 그 파일을 '같은 파일명' 으로 보고 기록 없이 건너뛴다.
            if result == "stored":
                try:
                    os.remove(os.path.join(root, stored_rel))
                except OSError:
                    pass
            raise
    return result


def _write_row(root, stored_rel, sha, kind, hull, name, source_folder, employee_id, run_at, size) -> None:
    _append_manifest(root, {
        "sha256": sha,
        "stored_path": stored_rel.replace("\\", "/"),
        "kind": kind or guess_kind(name),
        "hull_no": "" if hull == UNKNOWN_HULL else hull,
        "original_name": name,
        "source_folder": source_folder,
        "employee_id": employee_id,
        "run_at": run_at,
        "size_bytes": str(size),
        "archived_at": datetime.now().isoformat(sep=" ", timespec="seconds"),
    })


def archive_run_inputs(paths: Dict[str, Optional[str]], work_dir: str, employee_id: str = "") -> Dict[str, str]:
    """Model Builder 실행 한 번의 입력 CSV(stru/pipe/equip)를 보관한다. 실패해도 해석에 영향 없게 예외를 삼킨다."""
    results: Dict[str, str] = {}
    if not enabled():
        return results
    folder = os.path.basename(os.path.normpath(work_dir or ""))
    meta = parse_folder_name(folder)
    for kind, path in paths.items():
        if not path:
            continue
        try:
            results[kind] = archive_csv(
                path, kind=kind, source_folder=folder,
                employee_id=employee_id or meta["employee_id"], run_at=meta["run_at"],
            )
        except Exception:  # noqa: BLE001 — 보관 실패가 모델 생성을 막으면 안 된다
            logger.exception("[MbCsvArchive] 보관 실패: %s", path)
            results[kind] = "error"
    return results


def iter_mb_csvs(user_connection_dir: Optional[str] = None) -> Iterable[Dict[str, str]]:
    """userConnection 의 MB 작업 폴더 맨 위 CSV 를 차례로 낸다(하위 산출 폴더는 보지 않는다)."""
    base = user_connection_dir or USER_CONNECTION_DIR
    if not os.path.isdir(base):
        return
    for entry in sorted(os.scandir(base), key=lambda e: e.name):
        if not entry.is_dir() or not is_mb_folder(entry.name):
            continue
        meta = parse_folder_name(entry.name)
        try:
            files = sorted(os.scandir(entry.path), key=lambda e: e.name)
        except OSError:
            continue
        for f in files:
            if f.is_file() and f.name.lower().endswith(".csv"):
                yield {"path": f.path, "folder": entry.name, **meta}


def collect_existing(user_connection_dir: Optional[str] = None, root: Optional[str] = None,
                     dry_run: bool = False) -> Dict[str, int]:
    """이미 쌓인 작업 폴더의 CSV 를 한꺼번에 보관한다. 결과별 건수를 돌려준다."""
    counts: Dict[str, int] = {}
    for item in iter_mb_csvs(user_connection_dir):
        if dry_run:
            result = "found"
        else:
            try:
                result = archive_csv(item["path"], source_folder=item["folder"],
                                     employee_id=item["employee_id"], run_at=item["run_at"], root=root)
            except Exception:  # noqa: BLE001
                logger.exception("[MbCsvArchive] 보관 실패: %s", item["path"])
                result = "error"
        counts[result] = counts.get(result, 0) + 1
    return counts
