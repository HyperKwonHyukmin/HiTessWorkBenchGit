"""Group/Module Unit lifting 해석 산출물(다운로드 대상) 파일 스캔 헬퍼.

unit_structural_service.py 가 parent BDF 와 같은 폴더(`userConnection/<ts>_<사번>_
GroupModuleUnit/`)에 생성하는 산출물 중 사용자에게 다운로드로 노출할 파일만,
디스크에 실제로 존재하는 것만 메타와 함께 반환한다.

순수 함수라 FastAPI/DB 의존 없이 단위 테스트 가능(test_lifting_artifacts.py).
"""
from __future__ import annotations

import os
from typing import Optional

# (kind, 파일명 패턴, 라벨) — unit_structural_service.py 의 산출 파일명과 반드시 일치.
#   <stem> = 업로드된 원본 BDF 파일명의 stem.
ARTIFACT_SPECS = [
    ("liftingBdf", "{stem}_lifting.bdf", "최종 모델 BDF (Wire 포함)"),
    ("editedBdf",  "{stem}_edited.bdf",  "편집 구조 모델 BDF"),
    ("f06",        "{stem}_lifting.f06", "Nastran F06"),
    ("op2",        "{stem}_lifting.op2", "Nastran OP2"),
]


def scan_lifting_artifacts(folder: str, stem: str) -> list[dict]:
    """folder 안에서 알려진 lifting 산출물을 존재하는 것만 메타와 함께 반환.

    Args:
        folder: 산출물이 위치한 폴더(절대경로).
        stem:   원본 BDF 파일명 stem (예: 'model').

    Returns:
        [{ kind, label, fileName, path(abs), sizeBytes(int|None) }, ...]
        존재하지 않는 파일은 제외(없으면 빈 리스트).
    """
    out: list[dict] = []
    for kind, pattern, label in ARTIFACT_SPECS:
        name = pattern.format(stem=stem)
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            try:
                size: Optional[int] = os.path.getsize(path)
            except OSError:
                size = None
            out.append({
                "kind": kind,
                "label": label,
                "fileName": name,
                "path": os.path.abspath(path),
                "sizeBytes": size,
            })
    return out
