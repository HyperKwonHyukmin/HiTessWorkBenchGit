"""Model Library — 설명 가능한 유사 모델 검색.

**왜 지금 이걸 만드나.**
현재 검색은 제목·설명 텍스트와 필터뿐이다. 그런데 사용자가 라이브러리에 오는 이유는
"예전에 비슷한 걸 했었나?"이고, 그 질문은 **제목으로 답할 수 없다.** 같은 형상을 담은
모델이 `3454-35020-A505080` 과 `기준모델_4점권상` 이라는 이름으로 각각 등록돼 있으면
텍스트 검색으로는 영원히 못 만난다.

**왜 vector DB 를 쓰지 않나.**
지금 필요한 건 수십~수백 건에서의 최근접 탐색이다. SQL 로 후보를 좁히고 파이썬으로
거리를 재면 충분하고, 무엇보다 **왜 비슷하다고 했는지 설명할 수 있다.** 임베딩은
'비슷하다'는 결론만 주고 근거를 주지 않는데, 구조 해석에서 근거 없는 추천은 쓰이지 않는다.
표본이 수천 건을 넘어 이 방식이 느려지면 그때 두 번째 어댑터를 넣을 자리(seam)가
`find_similar()` 의 시그니처로 이미 남아 있다.

**정직성 규칙**
- 근거가 없는 차원은 **평균에서 빼고 뺐다고 말한다.** 0 으로 채우면 "완전히 다르다"가 되고,
  1 로 채우면 "완전히 같다"가 된다. 둘 다 거짓말이다.
- 길이 단위가 다르면 치수 차원만 빼고 나머지는 그대로 비교한다(개수·구성은 단위와 무관).
  후보를 통째로 버리지 않는다.
- 점수는 항상 **차원별 기여와 함께** 반환한다. 총점만 주는 API 는 만들지 않는다.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .model_feature_service import (
    FEATURE_EXTRACTOR_VERSION,
    categorical_similarity,
    composition_similarity,
    element_breakdown,
    length_unit,
    model_span,
    ratio_similarity,
)

DEFAULT_LIMIT = 8
MAX_LIMIT = 30

# 후보를 SQL 로 좁힐 때 쓰는 규모 밴드. 노드 수가 10배 이상 차이 나면 사실상 다른 모델이라
# 파이썬까지 끌고 오지 않는다. (넉넉하게 잡는다 — 좁히기는 최적화이지 판정이 아니다.)
CANDIDATE_SCALE_BAND = 10


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    weight: float
    unit_sensitive: bool = False
    hint: str = ""


# 가중치의 근거: '무엇이 같아야 같은 모델이라 부를 수 있나'.
# 요소 구성이 가장 무겁다 — 개수는 같아도 부재 종류가 다르면 다른 모델이다.
DIMENSIONS: tuple[Dimension, ...] = (
    Dimension("elementBreakdown", "요소 구성", 0.30,
              hint="부재 종류의 비율. 규모가 달라도 같은 방식으로 지어졌는지를 본다."),
    Dimension("nodeCount", "노드 수", 0.20, hint="모델 규모"),
    Dimension("elementCount", "요소 수", 0.20, hint="모델 규모"),
    Dimension("modelSpan", "모델 치수", 0.20, unit_sensitive=True,
              hint="실제 크기. 길이 단위가 같을 때만 비교한다."),
    Dimension("modelType", "모델 종류", 0.10, hint="등록자가 지정한 분류"),
)

DIMENSIONS_BY_KEY = {d.key: d for d in DIMENSIONS}


def descriptor(revision: dict) -> dict:
    """비교에 필요한 값만 뽑은 가벼운 표현.

    revision dict 전체를 들고 다니면 summary_json 까지 매번 훑게 된다.
    후보가 수백 건이면 그 차이가 눈에 띈다.
    """
    return {
        "model_uid": revision.get("model_uid"),
        "revision_no": revision.get("revision_no"),
        "title": revision.get("title"),
        "modelType": revision.get("model_type"),
        "sourceProgram": revision.get("source_program_name"),
        "qualityLevel": revision.get("quality_level"),
        "designOutcome": revision.get("design_outcome"),
        "nodeCount": revision.get("node_count"),
        "elementCount": revision.get("element_count"),
        "modelSpan": model_span(revision),
        "lengthUnit": length_unit(revision),
        "elementBreakdown": element_breakdown(revision),
    }


def _similarity_for(dim: Dimension, a: dict, b: dict) -> Optional[float]:
    if dim.key == "elementBreakdown":
        return composition_similarity(a.get("elementBreakdown"), b.get("elementBreakdown"))
    if dim.key == "modelType":
        return categorical_similarity(a.get("modelType"), b.get("modelType"))
    return ratio_similarity(_num(a.get(dim.key)), _num(b.get(dim.key)))


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def compare(target: dict, candidate: dict) -> dict:
    """두 모델의 유사도 + **왜 그렇게 나왔는지**.

    근거가 있는 차원만 가중 평균한다. 근거 없는 차원은 `skipped` 로 사유와 함께 나간다.
    """
    unit_mismatch = bool(
        target.get("lengthUnit") and candidate.get("lengthUnit")
        and target["lengthUnit"] != candidate["lengthUnit"]
    )

    basis: list[dict] = []
    skipped: list[dict] = []
    weighted_sum = 0.0
    weight_total = 0.0

    for dim in DIMENSIONS:
        if dim.unit_sensitive and unit_mismatch:
            skipped.append({
                "key": dim.key,
                "label": dim.label,
                "reason": f"길이 단위가 다릅니다 ({target.get('lengthUnit')} vs {candidate.get('lengthUnit')}) — 환산하지 않고 제외합니다.",
            })
            continue

        similarity = _similarity_for(dim, target, candidate)
        if similarity is None:
            skipped.append({
                "key": dim.key,
                "label": dim.label,
                "reason": "한쪽 이상에 값이 없어 비교할 수 없습니다.",
            })
            continue

        basis.append({
            "key": dim.key,
            "label": dim.label,
            "similarity": similarity,
            "weight": dim.weight,
            "hint": dim.hint,
        })
        weighted_sum += similarity * dim.weight
        weight_total += dim.weight

    score = (weighted_sum / weight_total) if weight_total else None
    return {
        "score": score,
        # 총점을 얼마나 믿을 수 있는지 — 근거 차원이 1개뿐인 0.99 와 5개짜리 0.80 은 다르다.
        "basisWeight": weight_total,
        "basis": basis,
        "skipped": skipped,
        "unitMismatch": unit_mismatch,
    }


def find_similar(
    target_revision: dict,
    candidate_revisions: list[dict],
    *,
    limit: int = DEFAULT_LIMIT,
    min_basis_weight: float = 0.3,
) -> dict:
    """유사한 모델을 점수 순으로 돌려준다.

    `min_basis_weight` 미만은 **근거가 너무 얇아** 순위에 넣지 않는다. 요소 구성 하나만 겹쳐
    0.95 가 나온 후보를 1위로 올리면 추천 전체의 신뢰가 무너진다. 걸러진 것도 숫자로 밝힌다.
    """
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    target = descriptor(target_revision)

    scored: list[dict] = []
    thin_basis = 0
    for revision in candidate_revisions:
        if revision.get("model_uid") == target["model_uid"]:
            continue   # 자기 자신은 유사 모델이 아니다
        candidate = descriptor(revision)
        result = compare(target, candidate)
        # 근거가 아예 없는 경우(basisWeight == 0)도 '근거 부족'이다 — 조용히 사라지게 두면
        # comparedCount 가 실제 시도 횟수보다 작아져 숫자가 거짓말을 한다.
        if result["basisWeight"] < min_basis_weight or result["score"] is None:
            thin_basis += 1
            continue
        scored.append({
            "model_uid": candidate["model_uid"],
            "title": candidate["title"],
            "revision": candidate["revision_no"],
            "qualityLevel": candidate["qualityLevel"],
            "designOutcome": candidate["designOutcome"],
            "sourceProgram": candidate["sourceProgram"],
            "nodeCount": candidate["nodeCount"],
            "elementCount": candidate["elementCount"],
            **result,
        })

    # 동점이면 근거가 두꺼운 쪽, 그다음 uid — 결정적 정렬(같은 입력 → 같은 순서)
    scored.sort(key=lambda x: (-x["score"], -x["basisWeight"], x["model_uid"] or ""))

    return {
        "target": {
            "model_uid": target["model_uid"],
            "title": target["title"],
            "lengthUnit": target["lengthUnit"],
        },
        "items": scored[:limit],
        "comparedCount": len(scored) + thin_basis,
        "skippedThinBasis": thin_basis,
        "dimensions": [
            {"key": d.key, "label": d.label, "weight": d.weight, "hint": d.hint}
            for d in DIMENSIONS
        ],
        "extractorVersion": FEATURE_EXTRACTOR_VERSION,
        "method": "weighted-ratio",
        "note": (
            "형상 지표의 가중 평균입니다. 값이 없는 항목은 평균에서 제외했으며, "
            "'같은 용도'가 아니라 '같은 모양'을 뜻합니다."
        ),
    }
