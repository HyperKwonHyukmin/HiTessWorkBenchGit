"""Group/Module Unit lifting 해석 산출물(다운로드 대상) 파일 스캔 헬퍼.

unit_structural_service.py 가 parent BDF 와 같은 폴더(`userConnection/<ts>_<사번>_
GroupModuleUnit/`)에 생성하는 산출물 중 사용자에게 다운로드로 노출할 파일만,
디스크에 실제로 존재하는 것만 메타와 함께 반환한다.

파일은 보통 `<원본BDF stem>_lifting.bdf` 처럼 parent BDF 의 stem 을 따르지만,
업로드/편집 변환 과정에서 stem 이 어긋날 수 있다. 그래서 stem 정확 매칭을 우선하되,
없으면 접미사(`_lifting.bdf` 등) 글롭으로 폴더를 탐색해 존재하면 노출한다.

순수 함수라 FastAPI/DB 의존 없이 단위 테스트 가능(test_lifting_artifacts.py).
"""
from __future__ import annotations

import glob
import os
from typing import Optional

# (kind, 파일명 접미사, 라벨) — unit_structural_service.py 의 산출 파일명과 반드시 일치.
#   파일명 = <stem><suffix> (예: 'model' + '_lifting.bdf').
ARTIFACT_SPECS = [
    ("liftingBdf", "_lifting.bdf", "최종 모델 BDF (Wire 포함)"),
    ("editedBdf",  "_edited.bdf",  "편집 구조 모델 BDF"),
    ("f06",        "_lifting.f06", "Nastran F06"),
    ("op2",        "_lifting.op2", "Nastran OP2"),
]


def _find_artifact(folder: str, suffix: str, stem: Optional[str]) -> Optional[str]:
    """folder 안에서 suffix 로 끝나는 산출물 경로를 찾는다.

    1) stem 이 주어지면 정확히 '<stem><suffix>' 를 우선 사용.
    2) 없으면 '*<suffix>' 글롭의 첫 매치(정렬)로 폴백 — stem 이 달라도 파일이 있으면 찾는다.
    """
    if stem:
        exact = os.path.join(folder, f"{stem}{suffix}")
        if os.path.isfile(exact):
            return exact
    matches = sorted(
        p for p in glob.glob(os.path.join(glob.escape(folder), f"*{suffix}"))
        if os.path.isfile(p)
    )
    return matches[0] if matches else None


def scan_lifting_artifacts(folder: str, stem: Optional[str] = None) -> list[dict]:
    """folder 안에서 알려진 lifting 산출물을 존재하는 것만 메타와 함께 반환.

    Args:
        folder: 산출물이 위치한 폴더(절대경로).
        stem:   원본 BDF 파일명 stem (예: 'model'). 정확 매칭 우선용. 없으면 글롭만 사용.

    Returns:
        [{ kind, label, fileName, path(abs), sizeBytes(int|None) }, ...]
        존재하지 않는 파일은 제외(없으면 빈 리스트).
    """
    out: list[dict] = []
    for kind, suffix, label in ARTIFACT_SPECS:
        path = _find_artifact(folder, suffix, stem)
        if not path:
            continue
        try:
            size: Optional[int] = os.path.getsize(path)
        except OSError:
            size = None
        out.append({
            "kind": kind,
            "label": label,
            "fileName": os.path.basename(path),
            "path": os.path.abspath(path),
            "sizeBytes": size,
        })
    return out
