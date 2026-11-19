"""권상 구조 해석에 쓴 자세안정성 결과의 판정과 평가 모드 — '자세안정성 미충족으로 진행(Advisory)' 기록.

MU Studio 의 평가 모드(2026-11-18): strict / standard / advisory. Advisory 는 자세안정성이 fail 이어도 구조 해석을
진행한다. 엔진 판정은 바꾸지 않으므로 stability JSON 의 overall 은 그대로 fail 이다.
이 모듈은 그 사실을 결과(result_info.stabilityGate)에 남겨 WorkBench 판정과 보고서가 알릴 수 있게 한다.

- 판정 = stability JSON ``overall.status``.
- 모드 = 같은 폴더의 posture JSON(``meta.sourceFiles.posture``) ``evaluationMode``. 없으면 ``strictEvaluation`` 으로
  strict/standard 를 짐작한다(이 기능 이전 Studio).
- 규칙 원본 = MU Studio ``data/evaluationMode.js``. 계획: docs/plans/2026-11-18-mu-evaluation-mode-rbe-swap-group-bulk.md
"""
from __future__ import annotations

import json
import os
from typing import Any

EVALUATION_MODES = ("strict", "standard", "advisory")


def _read_json(path: str) -> dict | None:
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        data = json.loads(raw.decode("utf-8-sig"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def _posture_path(stability_path: str, stability: dict) -> str | None:
    name = ((stability.get("meta") or {}).get("sourceFiles") or {}).get("posture")
    folder = os.path.dirname(stability_path)
    if isinstance(name, str) and name and os.path.basename(name) == name:
        candidate = os.path.join(folder, name)
        if os.path.isfile(candidate):
            return candidate
    stem = os.path.basename(stability_path)
    if stem.endswith("_stability.json"):
        candidate = os.path.join(folder, stem[: -len("_stability.json")] + "_posture.json")
        if os.path.isfile(candidate):
            return candidate
    return None


def _mode_from_posture(posture: dict | None) -> str | None:
    if not posture:
        return None
    mode = posture.get("evaluationMode")
    if mode in EVALUATION_MODES:
        return mode
    if "strictEvaluation" in posture:
        return "strict" if posture.get("strictEvaluation") is True else "standard"
    return None


def read_stability_gate(stability_path: str | None) -> dict[str, Any] | None:
    """stability JSON 경로 → {overall, evaluationMode, failingStages, tippingFail, unmet}. 읽지 못하면 None.

    unmet = 자세안정성 fail 인 결과로 구조 해석을 돌렸다(Studio 는 Advisory 모드에서만 허용한다).
    """
    if not stability_path or not os.path.isfile(stability_path):
        return None
    stability = _read_json(stability_path)
    if stability is None:
        return None
    ov = stability.get("overall")
    overall = ov.get("status") if isinstance(ov, dict) else None
    raw_stages = stability.get("stages")
    stages: list = raw_stages if isinstance(raw_stages, list) else []
    failing = [
        str(s.get("displayLabel") or s.get("name") or f"Stage {s.get('stage')}")
        for s in stages
        if isinstance(s, dict) and s.get("displayPolicy") != "internal" and s.get("status") == "fail"
    ]
    tipping = any(isinstance(s, dict) and s.get("stage") == 6 and s.get("status") == "fail" for s in stages)
    posture_path = _posture_path(stability_path, stability)
    mode = _mode_from_posture(_read_json(posture_path) if posture_path else None)
    # FAIL 인데 구조 해석까지 왔다면 Advisory 로 진행한 것이다 — Standard 에서 평가하고 Advisory 로 바꿔 바로 해석하면
    # posture 파일에는 'standard' 가 남는다(평가 입력이 같아 다시 평가하지 않음, 2026-11-19 리뷰). 보고서 collector 와 같은 규칙.
    if overall == "fail":
        mode = "advisory"
    return {
        "overall": overall,
        "evaluationMode": mode,
        "failingStages": failing,
        "tippingFail": tipping,
        "unmet": overall == "fail",
    }
