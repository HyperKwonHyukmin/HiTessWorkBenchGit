"""러그 치수(파라미터) → 형상(설계 JSON) — 엔진의 lugshell.params 를 그대로 import 해 쓴다 (2026-11-12).

계획 docs/plans/2026-11-12-lug-param-catalogue-plan.md. 엔진 exe 는 기동이 10초라 치수를 고칠 때마다 부를 수 없다.
그래서 엔진의 순수 파이썬 모듈(geom·materials·params, 표준 라이브러리만)을 InHouse 에 복사해 두고 백엔드가 import 한다.

  찾는 순서: 환경 변수 LUGPARAMS_DIR → InHouseProgram/DrawingToAnalysis/lugparams → (개발 PC) WorkBenchSubModule/DrawingToAnalysis/lugshell
  각 폴더 안에 lugshell/ 패키지(geom.py · materials.py · params/)가 있어야 한다.
  ⚠ InHouse 복사본은 git 미추적 — 서버(145)는 수동 교체. 엔진에서 tools/export_lugparams.py 로 만든다.

해석 실행은 이 모듈로 만든 설계 JSON 을 exe `lugshell --design` 에 넘긴다(기존 '이 값으로 다시 만들기'와 같은 작업).
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import threading
from typing import Optional

from .analysis_runner import get_backend_dir

_LOCK = threading.Lock()
_MOD = None


class LugParamsUnavailable(RuntimeError):
    pass


def _candidates() -> list[str]:
    backend = get_backend_dir()
    out = []
    if os.environ.get("LUGPARAMS_DIR"):
        out.append(os.environ["LUGPARAMS_DIR"])
    out.append(os.path.join(backend, "InHouseProgram", "DrawingToAnalysis", "lugparams"))
    out.append(os.path.normpath(os.path.join(backend, "..", "..", "WorkBenchSubModule", "DrawingToAnalysis", "lugshell")))
    return out


def module():
    """lugshell.params 모듈(처음 한 번 import). 없으면 LugParamsUnavailable."""
    global _MOD
    with _LOCK:
        if _MOD is not None:
            return _MOD
        for root in _candidates():
            if os.path.isfile(os.path.join(root, "lugshell", "params", "__init__.py")):
                if root not in sys.path:
                    sys.path.insert(0, root)
                try:
                    mod = importlib.import_module("lugshell.params")
                except Exception as e:  # noqa: BLE001 — 덜 복사된 폴더(SyntaxError·ImportError)도 원인을 알려 준다
                    raise LugParamsUnavailable(f"러그 치수 모듈(lugparams)을 불러오지 못했습니다({root}): {e}") from e
                setattr(mod, "LOADED_FROM", root)
                _MOD = mod
                return _MOD
        raise LugParamsUnavailable(
            "러그 치수 모듈(lugparams)이 서버에 없습니다 — InHouseProgram/DrawingToAnalysis/lugparams 를 넣어 주세요.")


def params_dir() -> str:
    return os.path.join(get_backend_dir(), "DrawingBook", "params")


def load_params(code: str) -> Optional[dict]:
    """표준집 미리 변환본 치수 파일(DrawingBook/params/<기호>.json). 없으면 None."""
    safe = "".join(ch for ch in code if ch.isalnum() or ch in "-_.")
    if not safe or safe != code:
        return None
    path = os.path.join(params_dir(), f"{safe}.json")
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as fh:  # read() 바이트 — DRM 이 감쌌으면 json 이 깨진다
        raw = fh.read()
    try:
        pf = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise LugParamsUnavailable(f"치수 파일을 읽지 못했습니다({safe}.json): {e}") from e
    if not isinstance(pf, dict) or "form" not in pf:
        raise LugParamsUnavailable(f"치수 파일 형식이 맞지 않습니다({safe}.json): form 이 없음")
    return pf


def build(form: str, values: dict, code: str = "lug", review: Optional[list] = None) -> tuple[dict, dict]:
    """치수 → (설계 JSON, {mass_kg, marks}). 치수 모순이면 ValueError(사람이 읽을 이유).
    marks = 치수 칸 이름 → {plates, lines}(화면에서 칸을 누르면 그 판과 치수선을 강조). 옛 모듈이면 빈 dict."""
    mod = module()
    # 재질은 자유 입력 칸이다. 엔진은 모르는 이름을 SWS400B 로 조용히 바꾸므로 여기서 막는다(입력한 재질로 계산했다고 오해하지 않게).
    mat = values.get("material")
    if mat not in (None, ""):
        materials = importlib.import_module("lugshell.materials")
        if materials.material(str(mat)) is None:
            raise ValueError(f"모르는 재질 '{mat}' — 쓸 수 있는 재질: {', '.join(materials.LIBRARY)}")
    design, info = mod.build(form, values, {"id": code, "drawing_no": code, "title": f"치수: {code}"})
    design["review"] = list(review or [])
    return design, {"mass_kg": round(float(info["mass_kg"]), 2), "marks": info.get("marks") or {}}


def fields(form: str) -> list[dict]:
    return module().fields(form)


def version() -> str:
    return getattr(module(), "VERSION", "")
