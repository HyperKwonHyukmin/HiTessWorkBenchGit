"""호선 번호 — Model Builder BDF 주석으로 남기고, 이후 단계(권상·LogBook)가 BDF 에서 다시 읽는다.

Model Builder(Cmb.Cli `--hull-no`)가 BDF 첫 줄에 `$ HiTessModelBuilder: HullNo=3454` 를 쓴다(2026-10-20).
BDF 에는 호선이 필요 없지만, 권상 해석에 올라온 BDF 를 LogBook 으로 보낼 때 호선을 알아내는 통로가 이 주석뿐이다.

규칙은 세 곳이 같아야 한다 — C# `FeModel.NormalizeHullNo` · nastran_bridge `normalize_hull_no` · 이 모듈.
프런트 파일명 제안 규칙은 `frontend/src/utils/hullNo.js` 에 같은 내용의 사본이 있다.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

HULL_NO_VALUE_RE = re.compile(r"^[A-Z0-9_-]{1,20}$")
HULL_NO_COMMENT_RE = re.compile(r"^\s*\$\s*HiTessModelBuilder:\s*.*?\bHullNo\s*=\s*(\S+)", re.IGNORECASE)
# 사내 CSV/BDF 파일명은 '3454-35020-struData-A505080_20251021.csv' 처럼 4자리 호선으로 시작한다.
# '5PPP_-struData-…' 같은 예외도 있어 4자리 숫자로 시작할 때만 제안한다(나머지는 사용자 입력).
FILENAME_HULL_RE = re.compile(r"^(\d{4})(?=[-_ .]|$)")


def normalize_hull_no(raw: object) -> Optional[str]:
    """공백 제거·대문자. 영문·숫자·'-'·'_' 1~20자만 허용하고 그 밖은 None(BDF 주석 한 줄에 그대로 들어간다)."""
    if raw is None:
        return None
    value = str(raw).strip().upper()
    return value if HULL_NO_VALUE_RE.match(value) else None


def suggest_hull_no_from_filename(path_or_name: Optional[str]) -> Optional[str]:
    """파일명 앞 4자리 숫자를 호선으로 제안한다. 없으면 None."""
    if not path_or_name:
        return None
    match = FILENAME_HULL_RE.match(os.path.basename(str(path_or_name)).strip())
    return match.group(1) if match else None


def read_hull_no_from_bdf(path: Optional[str]) -> Optional[str]:
    """BDF 의 '$ HiTessModelBuilder: HullNo=...' 주석을 읽는다. 첫 일치에서 멈춘다. 없거나 못 읽으면 None."""
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "HullNo" not in line:
                    continue
                match = HULL_NO_COMMENT_RE.match(line)
                if match:
                    return normalize_hull_no(match.group(1))
    except OSError as exc:
        logger.warning("[HullNo] BDF 읽기 실패 %s: %s", path, exc)
    return None


def resolve_bdf_hull_no(path: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """BDF 의 호선과 출처를 돌려준다 — 주석('comment') → 파일명 앞 4자리('filename') → (None, None)."""
    hull_no = read_hull_no_from_bdf(path)
    if hull_no:
        return hull_no, "comment"
    hull_no = suggest_hull_no_from_filename(path)
    if hull_no:
        return hull_no, "filename"
    return None, None


# exe 경로·수정 시각별로 '--hull-no 지원 여부'를 기억한다(exe 를 교체하면 다시 확인).
_HULL_FLAG_CACHE: dict[tuple[str, float], bool] = {}


def engine_supports_hull_no(exe_path: str) -> bool:
    """Cmb.Cli.exe 가 build-full --hull-no 를 아는지 `--help` 로 확인한다.

    옛 엔진에 모르는 옵션을 넘기면 System.CommandLine 이 인자 오류로 모델 생성 자체를 실패시킨다.
    서버(145)는 백엔드(git pull)와 엔진(수동 교체)이 따로 반영되므로 어느 쪽이 먼저 와도 깨지지 않게 한다.
    """
    try:
        key = (os.path.abspath(exe_path), os.path.getmtime(exe_path))
    except OSError:
        return False
    cached = _HULL_FLAG_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        proc = subprocess.run([exe_path, "build-full", "--help"], capture_output=True, timeout=30)
        text = (proc.stdout or b"") + (proc.stderr or b"")
        supported = b"--hull-no" in text
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("[HullNo] 엔진 옵션 확인 실패 %s: %s", exe_path, exc)
        return False
    _HULL_FLAG_CACHE[key] = supported
    return supported
