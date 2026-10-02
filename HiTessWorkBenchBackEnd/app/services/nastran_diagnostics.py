"""해석 오류·경고 수집기 — 반복되는 Nastran/엔진 오류를 코드로 막아 가기 위한 근거 자료.

작업이 끝날 때 `analysis_runner.mark_complete()` 가 `schedule_collection(job_id, ...)` 을 부른다.
(17개 서비스가 공유하는 지점이라 App 마다 손대지 않고 전부 잡힌다. C# exe 가 내부에서 Nastran 을
돌리는 Mooring·Truss 도 작업 폴더의 F06 을 읽으므로 같이 잡힌다.)

1. 그 작업의 Analysis 기록(input_info·result_info 경로)으로 작업 폴더를 찾는다.
2. 작업 시작 이후 생긴 F06 에서 FATAL/WARNING 을 읽는다. Nastran 까지 못 가고 실패했으면
   엔진 로그의 마지막 오류 줄을 쓴다(level=engine).
3. 메시지에서 숫자·ID·경로를 지워 '지문'을 만들고 DiagnosticSignature 에 쌓는다(같은 지문 = 횟수만 +1).
4. **처음 보는 오류(또는 처리 후 재발한 오류)일 때만** 입력 BDF·F06 발췌·엔진 로그를
   DataStorage/DiagnosticsArchive/cases/ 에 복사한다 — userConnection 은 30일 뒤 지워지기 때문이다.

수집 실패가 해석 결과에 영향을 주면 안 되므로 전부 백그라운드 스레드 + 예외 삼킴(로그만)이다.
운영 서버(145)는 `git pull` + 백엔드 재시작만으로 동작한다(표는 기동 시 create_all 로 생긴다).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import threading
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.exc import IntegrityError

from .. import database, models

logger = logging.getLogger(__name__)

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))
ARCHIVE_ROOT = os.path.abspath(
    os.environ.get("DIAGNOSTICS_ARCHIVE_DIR")
    or os.path.join(_BACKEND_DIR, "DataStorage", "DiagnosticsArchive")
)

# 끄기: 환경변수 HITESS_DIAGNOSTICS=0 (테스트 conftest 가 끈다 — 수많은 mark_complete 테스트가 스레드를 띄우지 않게).
def enabled() -> bool:
    return os.environ.get("HITESS_DIAGNOSTICS", "1") != "0"

# 재현 자료를 남기는 등급. 경고는 횟수만 센다(사용자 결정: '새로운 오류가 발생한 BDF 만' 모은다).
ARCHIVE_LEVELS = {"fatal", "engine"}
# 재현 자료로 복사할 입력 확장자와 파일당 상한.
INPUT_EXTENSIONS = {".bdf", ".dat", ".nas", ".blk", ".inc", ".csv", ".json"}
MAX_COPY_BYTES = 50 * 1024 * 1024
# 한 F06 에서 읽는 메시지 상한(연쇄 오류 6498 ×160 같은 경우).
MAX_MESSAGES_PER_FILE = 300
# 작업 시작 시각보다 이만큼 이른 F06 까지 이 작업 것으로 본다(시계·파일시스템 오차).
MTIME_SLACK = timedelta(minutes=2)
# 작업 끝 쪽 여유는 짧게 — 같은 폴더에서 몇 초 뒤 이어서 돈 다음 작업(구조 해석)의 F06 을 가져오지 않게(실측).
END_SLACK = timedelta(seconds=10)
# 엔진 실패로 세지 않는 메시지(사용자 취소·서버 재시작).
_IGNORED_ENGINE = ("취소", "cancel", "서버 재시작", "작업 상태가 중단")


def _ignored(line: str) -> bool:
    low = line.lower()
    return any(k in low for k in _IGNORED_ENGINE)

_HEAD = re.compile(r"^\s*\*\*\*\s+(USER|SYSTEM)\s+(FATAL|WARNING)\s+MESSAGE\s+(\d+)\s*(.*)$", re.IGNORECASE)
_PATH = re.compile(r"([A-Za-z]:[\\/]|\\\\|/)[^\s\"']*[\\/][^\s\"']*")
_NUMBER = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:\.\d*)?(?:[EeDd][-+]?\d+)?")


# ── 파싱·정규화 ────────────────────────────────────────────────────────

def parse_f06(path: str) -> List[Dict[str, str]]:
    """F06 의 FATAL/WARNING 메시지 목록 [{level, code, message}]. 머리줄 + 뒤따르는 설명 줄(최대 4줄)."""
    found: List[Dict[str, str]] = []
    current: Optional[Dict[str, Any]] = None

    def close():
        if current is not None:
            found.append({
                "level": current["level"], "code": current["code"], "module": current["module"],
                "message": " ".join(" ".join(current["lines"]).split()),
            })

    with open(path, "r", encoding="latin-1", errors="replace") as f:
        for raw in f:
            head = _HEAD.match(raw)
            if head:
                close()
                if len(found) >= MAX_MESSAGES_PER_FILE:
                    current = None
                    break
                module = re.match(r"\s*(\([^)]*\))", head.group(4))
                current = {"level": head.group(2).lower(), "code": head.group(3),
                           "module": module.group(1) if module else "", "lines": [raw.strip()]}
                continue
            if current is None:
                continue
            text = raw.strip()
            # 빈 줄·페이지 머리('1' 로 시작)·4줄 초과면 메시지 끝
            if not text or raw.startswith("1") or len(current["lines"]) >= 5:
                close()
                current = None
                continue
            current["lines"].append(text)
    close()
    return found


def normalize(message: str) -> str:
    """지문용 메시지 틀 — '*** USER FATAL MESSAGE nnn' 머리, 경로, 숫자(ID·줄번호·값)를 지운다."""
    text = _HEAD.sub(lambda m: m.group(4), message.strip()) if _HEAD.match(message.strip()) else message.strip()
    text = _PATH.sub("<PATH>", text)
    text = _NUMBER.sub("#", text)
    text = " ".join(text.split())
    return text[:500]


def fingerprint(level: str, code: Optional[str], basis: str, program: Optional[str] = None) -> str:
    """유형 지문.

    - Nastran(fatal/warning): basis = 모듈 표기(예 '(IFPDRV)') — **코드 + 모듈**로 묶는다. 본문에는 카드 이름·
      ID·에코 줄이 섞여, 본문으로 묶으면 한 원인이 수십 유형으로 갈라진다(실측: m09 한 건 → 40유형).
      본문은 대표 메시지(template)·발생별 message 로 남긴다.
    - engine: basis = 정규화 본문 + App 이름(엔진 실패 문구는 App 마다 뜻이 다르다).
    """
    scope = program if level == "engine" else ""
    raw = f"{level}|{code or ''}|{scope or ''}|{basis}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


# 앞선 FATAL 때문에 따라 나오는 연쇄 메시지 — 같은 실행에 다른 FATAL 이 있으면 세지 않는다.
# (6498 API 그룹 오류·6624 IFP 요약·9002 BULK 오류 요약·208/102 입력 변환 실패, 경고 285 = 'FATAL 이 있었다')
CASCADE_CODES = {"6498", "6624", "9002", "208", "102", "285"}


def engine_failure(engine_log: str) -> Optional[str]:
    """엔진 로그에서 실패 원인 한 줄. '[Error] …' 를 우선, 없으면 Traceback 마지막 줄·오류 낱말 줄."""
    if not engine_log:
        return None
    lines = [l.strip() for l in engine_log.splitlines() if l.strip()]
    for pattern in (r"^\[Error\]", r"(Error|Exception):", r"(오류|실패|exit code|FATAL)"):
        hits = [l for l in lines if re.search(pattern, l, re.IGNORECASE)]
        if hits:
            line = re.sub(r"^\[Error\]\s*", "", hits[-1])[:1000]
            return None if _ignored(line) else line
    return None


# ── 작업 폴더·파일 찾기 ────────────────────────────────────────────────

def _walk_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _walk_strings(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _walk_strings(v)


def _inside_user_connection(path: str) -> bool:
    try:
        return os.path.commonpath([USER_CONNECTION_DIR, os.path.abspath(path)]) == USER_CONNECTION_DIR
    except ValueError:
        return False


def job_paths(input_info: Any, result_info: Any) -> Dict[str, List[str]]:
    """기록의 경로 값으로 작업 폴더들과 입력 파일들을 고른다(userConnection 안만)."""
    dirs, inputs = set(), []
    for value in _walk_strings(input_info):
        if len(value) < 4 or not _inside_user_connection(value):
            continue
        if os.path.isfile(value):
            dirs.add(os.path.dirname(os.path.abspath(value)))
            if os.path.splitext(value)[1].lower() in INPUT_EXTENSIONS:
                inputs.append(os.path.abspath(value))
        elif os.path.isdir(value):
            dirs.add(os.path.abspath(value))
    for value in _walk_strings(result_info):
        if len(value) < 4 or not _inside_user_connection(value):
            continue
        if os.path.isdir(value):
            dirs.add(os.path.abspath(value))
        elif os.path.isfile(value):
            dirs.add(os.path.dirname(os.path.abspath(value)))
    # 작업 폴더 바로 아래 userConnection 직속 폴더도 포함(Model Builder 처럼 하위 타임스탬프 폴더에 산출).
    roots = set()
    for d in dirs:
        rel = os.path.relpath(d, USER_CONNECTION_DIR).split(os.sep)
        if rel and rel[0] not in ("", ".", ".."):
            roots.add(os.path.join(USER_CONNECTION_DIR, rel[0]))
    return {"dirs": sorted(dirs | roots), "inputs": sorted(set(inputs))}


def record_paths(db, record: Any) -> Dict[str, List[str]]:
    """job_paths + 부모 기록의 경로. 권상 구조 해석(UnitStructural)은 부모 GMU 폴더에서 돌고, 실패 기록에는
    경로 없이 parent_analysis_id 만 남는 경우가 있다(실측) — 부모를 따라가야 F06·입력 BDF 를 찾는다."""
    paths = job_paths(record.input_info, record.result_info)
    parent_id = (record.input_info or {}).get("parent_analysis_id") if isinstance(record.input_info, dict) else None
    if parent_id:
        parent = db.query(models.Analysis).filter(models.Analysis.id == parent_id).first()
        if parent is not None:
            more = job_paths(parent.input_info, parent.result_info)
            paths = {
                "dirs": sorted(set(paths["dirs"]) | set(more["dirs"])),
                "inputs": paths["inputs"] or more["inputs"],
            }
    return paths


def recent_f06(dirs: Iterable[str], since: Optional[datetime], until: Optional[datetime] = None) -> List[str]:
    """작업 시작~끝 사이에 쓰인 F06. 끝(until)이 없으면 상한 없음.

    상한이 필요한 이유: 자세안정성·권상 최적화 작업은 부모 GMU 폴더를 같이 쓴다. 상한이 없으면 나중에
    같은 폴더에서 돈 구조 해석 F06 까지 그 작업 것으로 센다(실측 오귀속).
    """
    found = set()
    threshold = (since - MTIME_SLACK).timestamp() if since else None
    ceiling = (until + END_SLACK).timestamp() if until else None
    for base in dirs:
        base_depth = base.rstrip(os.sep).count(os.sep)
        for root, subdirs, files in os.walk(base):
            if root.count(os.sep) - base_depth >= 2:
                subdirs[:] = []
            for name in files:
                if not name.lower().endswith(".f06"):
                    continue
                full = os.path.join(root, name)
                try:
                    mtime = os.path.getmtime(full)
                    if (threshold is None or mtime >= threshold) and (ceiling is None or mtime <= ceiling):
                        found.add(os.path.abspath(full))
                except OSError:
                    pass
    return sorted(found)


def _sibling_bdf(f06_path: str) -> Optional[str]:
    """Nastran 은 출력명을 소문자로 쓴다 — 같은 폴더의 같은 이름 .bdf/.dat 를 대소문자 무시로 찾는다."""
    folder = os.path.dirname(f06_path)
    stem = os.path.splitext(os.path.basename(f06_path))[0].lower()
    try:
        for name in os.listdir(folder):
            base, ext = os.path.splitext(name)
            if base.lower() == stem and ext.lower() in (".bdf", ".dat", ".nas"):
                return os.path.join(folder, name)
    except OSError:
        pass
    return None


# ── 보관 ──────────────────────────────────────────────────────────────

def _f06_excerpt(path: str, codes: set, context: int = 8) -> str:
    """F06 전체는 크므로 해당 FATAL 주변만 남긴다."""
    try:
        with open(path, "r", encoding="latin-1", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return ""
    keep = set()
    for i, line in enumerate(lines):
        head = _HEAD.match(line)
        if head and head.group(3) in codes:
            keep.update(range(max(0, i - context), min(len(lines), i + context + 1)))
    out, prev = [], None
    for i in sorted(keep):
        if prev is not None and i != prev + 1:
            out.append("...\n")
        out.append(f"{i + 1:7d}: {lines[i]}")
        prev = i
    return "".join(out[:4000])


def _copy_limited(src: str, dst_dir: str, copied: set) -> Optional[str]:
    try:
        if not os.path.isfile(src) or os.path.getsize(src) > MAX_COPY_BYTES:
            return None
        name = os.path.basename(src)
        if name.lower() in copied:
            return name
        shutil.copy2(src, os.path.join(dst_dir, name))
        copied.add(name.lower())
        return name
    except OSError as e:
        logger.warning("[diagnostics] 재현 자료 복사 실패 %s: %s", src, e)
        return None


def archive_case(record: Any, events: List[Dict[str, Any]], inputs: List[str], engine_log: str) -> str:
    """재현 자료 한 묶음을 만든다. 반환 = ARCHIVE_ROOT 기준 상대 경로."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    rel = os.path.join("cases", f"{stamp}_{record.program_name or 'Unknown'}_{record.id}")
    case_dir = os.path.join(ARCHIVE_ROOT, rel)
    os.makedirs(case_dir, exist_ok=True)
    copied: set = set()
    files: List[str] = []
    for src in inputs:
        name = _copy_limited(src, case_dir, copied)
        if name:
            files.append(name)
    f06_codes: Dict[str, set] = {}
    for ev in events:
        if ev.get("f06"):
            f06_codes.setdefault(ev["f06"], set()).add(ev["code"])
    for f06, codes in f06_codes.items():
        bdf = _sibling_bdf(f06)
        if bdf:
            name = _copy_limited(bdf, case_dir, copied)
            if name:
                files.append(name)
        excerpt = _f06_excerpt(f06, codes)
        if excerpt:
            name = os.path.basename(f06) + ".excerpt.txt"
            with open(os.path.join(case_dir, name), "w", encoding="utf-8") as f:
                f.write(excerpt)
            files.append(name)
    if engine_log:
        with open(os.path.join(case_dir, "engine_log_tail.txt"), "w", encoding="utf-8") as f:
            f.write(engine_log[-20000:])
        files.append("engine_log_tail.txt")
    meta = {
        "analysisId": record.id, "jobId": record.job_id, "programName": record.program_name,
        "employeeId": record.employee_id, "status": record.status,
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "inputInfo": record.input_info, "resultInfo": record.result_info,
        "events": [{k: v for k, v in ev.items() if k != "isNew"} for ev in events],
        "files": files,
    }
    with open(os.path.join(case_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2, default=str)
    return rel


# ── 수집 본체 ──────────────────────────────────────────────────────────

# 원인을 담지 못한 고정 실패 문구 — 엔진 로그에서 원인을 못 찾았을 때 대신 쓰지 않는다.
_GENERIC_REASONS = {"analysis failed", "해석 실패", "실패", ""}


def collect_events(record: Any, engine_log: str, paths: Dict[str, List[str]],
                   fallback_reason: Optional[str] = None, *, until: Optional[datetime] = None,
                   status: Optional[str] = None) -> List[Dict[str, Any]]:
    """이 작업의 진단 사건 목록. 한 작업 안의 같은 지문은 한 번만.

    until  : F06 상한. 작업 종료 직후 수집(실시간)은 None(=지금), 과거분 소급은 기록의 updated_at.
             실시간에 updated_at 을 쓰면 안 된다 — 편집 적용처럼 DB 기록이 늦게 갱신되는 작업은 F06 이 잘린다.
    status : 작업 최종 상태. 실시간에는 DB 기록이 아직 Running 일 수 있어 호출자가 넘긴다.
    """
    since = record.started_at or record.created_at
    events: List[Dict[str, Any]] = []
    seen = set()
    has_fatal = False
    for f06 in recent_f06(paths["dirs"], since, until):
        try:
            messages = parse_f06(f06)
        except OSError:
            continue
        root_fatal = any(m["level"] == "fatal" and m["code"] not in CASCADE_CODES for m in messages)
        for msg in messages:
            if root_fatal and msg["code"] in CASCADE_CODES:
                continue
            fp = fingerprint(msg["level"], msg["code"], msg.get("module") or "")
            if fp in seen:
                continue
            seen.add(fp)
            has_fatal = has_fatal or msg["level"] == "fatal"
            events.append({"fingerprint": fp, "level": msg["level"], "code": msg["code"],
                           "template": normalize(msg["message"]), "message": msg["message"], "f06": f06})
    final_status = (status or record.status or "").lower()
    if final_status in ("failed", "failure") and not has_fatal:
        line = engine_failure(engine_log)
        if (not line and fallback_reason and fallback_reason.strip().lower() not in _GENERIC_REASONS
                and not _ignored(fallback_reason)):
            line = fallback_reason.strip()[:1000]
        if line:
            template = normalize(line)
            fp = fingerprint("engine", None, template, record.program_name)
            events.append({"fingerprint": fp, "level": "engine", "code": None,
                           "template": template, "message": line, "f06": None})
    return events


def _upsert_signature(db, ev: Dict[str, Any], program: Optional[str], now: datetime):
    """(signature, needs_archive). 처음 보는 지문·처리 후 재발한 지문만 재현 자료를 남긴다."""
    sig = db.query(models.DiagnosticSignature).filter_by(fingerprint=ev["fingerprint"]).first()
    if sig is None:
        sig = models.DiagnosticSignature(
            fingerprint=ev["fingerprint"], level=ev["level"], code=ev["code"],
            template=ev["template"], sample_message=ev["message"][:4000],
            programs=[program] if program else [], occurrence_count=1,
            first_seen=now, last_seen=now, status="new",
        )
        try:
            # 저장점 — 충돌해도 이 작업의 앞선 사건들은 되돌리지 않는다.
            with db.begin_nested():
                db.add(sig)
                db.flush()
        except IntegrityError:  # 다른 작업이 같은 순간 같은 지문을 만들었다
            return _upsert_signature(db, ev, program, now)
        return sig, ev["level"] in ARCHIVE_LEVELS
    sig.occurrence_count = (sig.occurrence_count or 0) + 1
    sig.last_seen = now
    if program and program not in (sig.programs or []):
        sig.programs = [*(sig.programs or []), program]
    regressed = sig.status == "handled"
    if regressed:
        sig.status = "regressed"
    return sig, regressed and ev["level"] in ARCHIVE_LEVELS


def collect_job_diagnostics(job_id: str, engine_log: str = "", fallback_reason: Optional[str] = None, *,
                            status: Optional[str] = None, extra_dirs: Optional[List[str]] = None,
                            until: Optional[datetime] = None) -> Dict[str, Any]:
    """job_id 의 Analysis 기록으로 진단을 모아 저장한다. 반환 = 요약(테스트·로그용)."""
    db = database.SessionLocal()
    try:
        record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
        if record is None:
            return {"skipped": "no-record"}
        # 같은 작업을 두 번 세지 않는다(mark_complete 중복 호출·과거분 소급 수집 재실행).
        if db.query(models.DiagnosticOccurrence.id).filter_by(job_id=job_id).first():
            return {"skipped": "already-collected"}
        paths = record_paths(db, record)
        if extra_dirs:  # 기록에 경로가 없는 작업(Model Builder 편집 적용)은 호출자가 폴더를 준다
            paths["dirs"] = sorted(set(paths["dirs"]) | {os.path.abspath(d) for d in extra_dirs if d and os.path.isdir(d)})
        events = collect_events(record, engine_log, paths, fallback_reason, until=until, status=status)
        if not events:
            return {"events": 0}
        now = datetime.now()
        pending = []
        for ev in events:
            sig, needs_archive = _upsert_signature(db, ev, record.program_name, now)
            pending.append((ev, sig, needs_archive))
        archive_rel = None
        if any(n for _, _, n in pending):
            try:
                archive_rel = archive_case(record, events, paths["inputs"], engine_log)
            except OSError as e:
                logger.warning("[diagnostics] 재현 자료 보관 실패: %s", e)
        for ev, sig, needs_archive in pending:
            if needs_archive and archive_rel:
                sig.archive_dir = archive_rel
            db.add(models.DiagnosticOccurrence(
                signature_id=sig.id, analysis_id=record.id, job_id=job_id,
                program_name=record.program_name, employee_id=record.employee_id,
                analysis_status=status or record.status, source_file=ev["f06"] or (paths["inputs"][0] if paths["inputs"] else None),
                message=ev["message"][:4000], archived=bool(needs_archive and archive_rel), created_at=now,
            ))
        db.commit()
        return {"events": len(events), "new": sum(1 for _, _, n in pending if n), "archive": archive_rel}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def schedule_collection(job_id: Optional[str], engine_log: str = "", fallback_reason: Optional[str] = None, *,
                        status: Optional[str] = None, extra_dirs: Optional[List[str]] = None) -> None:
    """작업 종료 지점(mark_complete·편집 적용)에서 부른다. 해석 응답을 늦추지 않게 스레드로 돌리고, 실패는 로그만 남긴다."""
    if not job_id or not enabled():
        return

    def run():
        try:
            summary = collect_job_diagnostics(job_id, engine_log or "", fallback_reason,
                                              status=status, extra_dirs=extra_dirs)
            if summary.get("new"):
                logger.info("[diagnostics] job=%s 새 오류 유형 %s건 보관: %s", job_id, summary["new"], summary.get("archive"))
        except Exception as e:  # noqa: BLE001 — 수집 실패가 해석에 영향을 주면 안 된다
            logger.warning("[diagnostics] job=%s 수집 실패: %s", job_id, e)

    threading.Thread(target=run, name=f"diagnostics-{job_id}", daemon=True).start()
