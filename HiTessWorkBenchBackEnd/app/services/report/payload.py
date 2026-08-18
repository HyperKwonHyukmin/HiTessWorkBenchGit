"""Analysis 레코드에서 어댑터가 쓸 평평한 payload 를 만든다.

어댑터가 레코드가 아니라 dict 를 받아야 같은 어댑터를 이력 기반 경로와
레거시 POST 경로(2단계) 양쪽에 쓸 수 있다.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# result_info 에서 결과 본문 경로로 쓰이는 키 (서비스마다 이름이 조금씩 다르다).
_OUTPUT_KEYS: tuple[str, ...] = ("output_json", "result_json")

_MAX_OUTPUT_BYTES = 8 * 1024 * 1024


def _is_within(base: str, candidate: str) -> bool:
    base_real = os.path.realpath(os.path.abspath(base))
    cand_real = os.path.realpath(os.path.abspath(candidate))
    return os.path.commonpath([base_real, cand_real]) == base_real


def _load_json_if_allowed(path: str, user_connection_base: str) -> Any | None:
    try:
        if not _is_within(user_connection_base, path):
            logger.warning("리포트: userConnection 밖 결과 경로를 건너뜁니다")
            return None
        if not os.path.isfile(path):
            return None
        if os.path.getsize(path) > _MAX_OUTPUT_BYTES:
            logger.warning("리포트: 결과 JSON 이 너무 커 로드를 건너뜁니다 (%s bytes 초과)", _MAX_OUTPUT_BYTES)
            return None
        with open(path, encoding="utf-8-sig") as fp:
            return json.load(fp)
    except (OSError, ValueError):
        # 파일 유실·깨진 JSON 은 리포트 실패 사유가 아니다. 근거 섹션이 상태를 대신 보여 준다.
        logger.info("리포트: 결과 JSON 로드 실패 — 요약만으로 생성합니다", exc_info=True)
        return None


def collect_payload(record, *, user_connection_base: str) -> dict[str, Any]:
    """레코드 → {"input", "result", "output"} 평평한 dict."""
    input_info = record.input_info if isinstance(record.input_info, dict) else {}
    result_info = record.result_info if isinstance(record.result_info, dict) else {}

    output: Any | None = None
    for key in _OUTPUT_KEYS:
        candidate = result_info.get(key)
        if isinstance(candidate, str) and candidate:
            output = _load_json_if_allowed(candidate, user_connection_base)
            if output is not None:
                break

    return {"input": input_info, "result": result_info, "output": output}
