"""Model Registry — Insight 집계.

정직성 원칙(이 파일의 존재 이유):
1. **표본이 없으면 0 이 아니라 null 이다.** 평균 0 은 '측정했더니 0' 을 뜻하므로,
   측정할 값이 없었던 경우와 절대 섞으면 안 된다. 모든 통계는 sampleSize 를 함께 낸다.
2. **단위가 다른 값을 그대로 합산하지 않는다.** 길이 파생 지표는 선언된 단위별로 나누고,
   집계에서 제외된 표본 수를 명시한다.
3. **품질(Q0~Q4)과 설계 결과(pass/fail)를 한 KPI 로 합치지 않는다.** 다른 축이다.
4. 교차표는 관측된 빈도일 뿐 인과가 아니다 — 필드명에 '원인' 같은 말을 쓰지 않는다.

순수 함수라 DB/파일 의존 없이 단위 테스트할 수 있다(usage_report_service 와 같은 패턴).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any, Iterable, Optional

from .model_feature_service import (
    FEATURE_EXTRACTOR_VERSION,
    build_cohort,
    feature_coverage,
    split_report,
)
from .model_family import family_key, family_label

# 품질 지표로 세는 결함 — transform_to_step1 의 어휘를 그대로 쓴다.
# freeEndNodeCount 는 결함이 아니므로 여기 없다(degree=1 일 뿐).
QUALITY_ISSUE_KEYS = (
    "orphanNodeCount",
    "isolatedNodeCount",
    "zeroLengthElementCount",
    "disconnectedGroupCount",
    "shortElementCount",
)

QUALITY_ISSUE_LABELS = {
    "orphanNodeCount": "미참조 GRID",
    "isolatedNodeCount": "고립 GRID",
    "zeroLengthElementCount": "영길이 요소",
    "disconnectedGroupCount": "분리 그룹",
    "shortElementCount": "짧은 요소",
}

QUALITY_LEVELS = ("Q0", "Q1", "Q2", "Q3", "Q4")
DESIGN_OUTCOMES = ("pass", "mixed", "fail", "unknown")

TOP_TAG_LIMIT = 12
TREND_DAY_LIMIT = 30


def _as_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def describe(values: Iterable[Any], *, total: Optional[int] = None) -> dict:
    """기술통계. **표본이 없으면 모든 통계가 null 이고 sampleSize=0 이다.**

    total 을 주면 결측 수(missing)를 함께 보고해 '얼마나 비어 있는지'를 숨기지 않는다.
    """
    nums = sorted(v for v in (_as_float(x) for x in values) if v is not None)
    n = len(nums)
    result = {
        "sampleSize": n,
        "missing": (total - n) if total is not None else None,
        "min": None,
        "max": None,
        "mean": None,
        "median": None,
    }
    if n == 0:
        return result

    result["min"] = nums[0]
    result["max"] = nums[-1]
    result["mean"] = sum(nums) / n
    mid = n // 2
    result["median"] = nums[mid] if n % 2 else (nums[mid - 1] + nums[mid]) / 2
    return result


def _distribution(values: Iterable[Any], *, order: Optional[tuple] = None) -> list[dict]:
    """분포. share 는 '값이 있는 표본' 기준이며 분모(total)를 함께 낸다."""
    counter = Counter(v for v in values if v)
    total = sum(counter.values())
    keys = list(order) if order else [k for k, _ in counter.most_common()]
    if order:
        keys += [k for k in counter if k not in keys]
    out = []
    for key in keys:
        count = counter.get(key, 0)
        if not count and order is None:
            continue
        out.append({
            "key": key,
            "count": count,
            "share": (count / total) if total else None,
        })
    return out


def _summary_of(revision: dict) -> dict:
    return revision.get("summary_json") or {}


def _created_date(revision: dict) -> Optional[date]:
    raw = revision.get("created_at")
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str) and raw:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def _length_unit(revision: dict) -> Optional[str]:
    return ((_summary_of(revision).get("units") or {}).get("length")) or None


def _bounding_span(revision: dict) -> Optional[float]:
    """모델의 최대 변 길이. 단위가 섞이면 안 되므로 호출부에서 단위를 먼저 거른다."""
    bbox = (_summary_of(revision).get("geometry") or {}).get("boundingBox") or {}
    dims = []
    for lo, hi in (("xMin", "xMax"), ("yMin", "yMax"), ("zMin", "zMax")):
        a, b = _as_float(bbox.get(lo)), _as_float(bbox.get(hi))
        if a is None or b is None:
            return None
        dims.append(abs(b - a))
    return max(dims) if dims else None


def aggregate_registry_insights(revisions: list[dict]) -> dict:
    """등록 revision 목록(현재 사용자가 볼 수 있는 것만)으로 Insight 를 만든다.

    입력은 평범한 dict 리스트다 — ORM 을 받지 않아 순수하게 테스트할 수 있다.
    """
    total = len(revisions)

    # ── 총계: 품질(Q4)과 설계 결과(pass)를 절대 한 숫자로 합치지 않는다 ──
    golden = sum(1 for r in revisions if r.get("quality_level") == "Q4")
    review_needed = sum(
        1 for r in revisions if (r.get("review_status") or "unreviewed") == "unreviewed"
    )
    design_pass = sum(1 for r in revisions if r.get("design_outcome") == "pass")
    archived = sum(1 for r in revisions if r.get("status") == "archived")

    totals = {
        "models": len({r.get("model_uid") for r in revisions if r.get("model_uid")}),
        "revisions": total,
        "active": total - archived,
        "archived": archived,
        "goldenApproved": golden,           # 모델 품질 축
        "reviewNeeded": review_needed,      # 모델 품질 축
        "designPass": design_pass,          # 설계 결과 축 — 위와 다른 의미다
    }

    # ── 분포 ──
    distributions = {
        "sourceProgram": _distribution(r.get("source_program_name") for r in revisions),
        "modelType": _distribution(r.get("model_type") for r in revisions),
        "modelRole": _distribution(r.get("model_role") for r in revisions),
        "qualityLevel": _distribution(
            (r.get("quality_level") for r in revisions), order=QUALITY_LEVELS,
        ),
        "designOutcome": _distribution(
            (r.get("design_outcome") for r in revisions), order=DESIGN_OUTCOMES,
        ),
        "lengthUnit": _distribution(_length_unit(r) for r in revisions),
    }

    # ── 기술통계 (단위 없는 지표) ──
    metrics = {
        "nodeCount": {**describe((r.get("node_count") for r in revisions), total=total), "unit": None},
        "elementCount": {**describe((r.get("element_count") for r in revisions), total=total), "unit": None},
        "maxUtilization": {
            **describe((r.get("max_utilization") for r in revisions), total=total),
            "unit": "ratio",
        },
        "totalMassKg": {
            **describe((r.get("total_mass_kg") for r in revisions), total=total),
            "unit": "kg",
        },
    }

    # ── 길이 파생 지표: 단위가 섞이면 합산하지 않는다 ──
    unit_counts = Counter(u for u in (_length_unit(r) for r in revisions) if u)
    dominant_unit = unit_counts.most_common(1)[0][0] if unit_counts else None
    spans, excluded_for_unit = [], 0
    for r in revisions:
        unit = _length_unit(r)
        span = _bounding_span(r)
        if span is None:
            continue
        if dominant_unit and unit != dominant_unit:
            excluded_for_unit += 1
            continue
        spans.append(span)
    metrics["modelSpan"] = {
        **describe(spans, total=total),
        "unit": dominant_unit,
        "excludedForUnitMismatch": excluded_for_unit,
    }

    # ── 품질 이슈 빈도: '이 결함이 있는 모델이 몇 개인가' ──
    quality_issues = []
    for key in QUALITY_ISSUE_KEYS:
        affected = 0
        measured = 0
        for r in revisions:
            value = _as_float((_summary_of(r).get("modelQuality") or {}).get(key))
            if value is None:
                continue
            measured += 1
            if value > 0:
                affected += 1
        quality_issues.append({
            "key": key,
            "label": QUALITY_ISSUE_LABELS.get(key, key),
            "modelsAffected": affected,
            "measured": measured,
            "share": (affected / measured) if measured else None,
        })

    # ── 품질 × 설계 결과 교차표 (관측 빈도일 뿐, 인과가 아니다) ──
    cross = defaultdict(int)
    for r in revisions:
        q = r.get("quality_level") or "-"
        o = r.get("design_outcome") or "unknown"
        cross[(q, o)] += 1
    quality_by_outcome = {
        "rows": QUALITY_LEVELS,
        "columns": DESIGN_OUTCOMES,
        "cells": [
            {"quality": q, "outcome": o, "count": cross.get((q, o), 0)}
            for q in QUALITY_LEVELS
            for o in DESIGN_OUTCOMES
        ],
        "note": "관측된 빈도입니다. 품질 등급이 설계 결과를 유발한다는 뜻이 아닙니다.",
    }

    # ── 태그 ──
    tag_counter = Counter()
    for r in revisions:
        for tag in (r.get("tags") or []):
            if isinstance(tag, str) and tag.strip():
                tag_counter[tag.strip().lower()] += 1
    top_tags = [
        {"tag": tag, "count": count} for tag, count in tag_counter.most_common(TOP_TAG_LIMIT)
    ]

    # ── 최근 등록 추이 ──
    day_counter = Counter()
    for r in revisions:
        d = _created_date(r)
        if d:
            day_counter[d.isoformat()] += 1
    recent_trend = [
        {"date": day, "count": count}
        for day, count in sorted(day_counter.items())[-TREND_DAY_LIMIT:]
    ]

    return {
        "totals": totals,
        "distributions": distributions,
        "metrics": metrics,
        "qualityIssues": quality_issues,
        "qualityByOutcome": quality_by_outcome,
        "topTags": top_tags,
        "recentTrend": recent_trend,
        "datasetReadiness": build_dataset_readiness(revisions),
    }


# --------------------------------------------------------------------------- #
# 데이터셋 준비도 — "이 라이브러리로 지금 학습이 되나?"
# --------------------------------------------------------------------------- #
#
# 이 절의 목적은 기대를 낮추는 것이다. 등록 모델 수십 건으로 딥러닝이 될 것처럼
# 보이게 만들면 안 된다. 그래서 **과제별 최소 표본을 먼저 못박고**, 현재 확보량과
# 나란히 보여 준다. 판단은 사람이 한다.
#
# 임계값은 통계적 보장이 아니라 사내 합의를 위한 출발점이다(문서에 근거를 남긴다).

DATASET_TASKS = (
    {
        "key": "similar-search",
        "label": "유사 모델 검색",
        "kind": "retrieval",
        "minSamples": 30,
        "needsLabel": False,
        "why": "형상·규모 벡터의 최근접 탐색. 학습이 아니라 색인이라 표본이 적어도 쓸모가 있다.",
    },
    {
        "key": "quality-anomaly",
        "label": "품질 이상 탐지",
        "kind": "anomaly",
        "minSamples": 100,
        "needsLabel": False,
        "why": "정상 모델의 분포를 학습해 벗어난 신규 모델을 표시한다. 정답 라벨이 필요 없다.",
    },
    {
        "key": "outcome-classifier",
        "label": "설계 결과 예측(분류)",
        "kind": "classification",
        "minSamples": 200,
        "needsLabel": True,
        "labelField": "design_outcome",
        "why": "해석 전에 통과/미통과를 가늠한다. 소수 클래스가 충분해야 의미가 있다.",
    },
    {
        "key": "utilization-regressor",
        "label": "사용률 예측(회귀)",
        "kind": "regression",
        "minSamples": 300,
        "needsLabel": True,
        "labelField": "max_utilization",
        "why": "해석을 대체하는 surrogate. 연속값이라 분류보다 표본이 더 필요하다.",
    },
)

def build_dataset_readiness(revisions: list[dict]) -> dict:
    """머신러닝 활용 가능성을 **현재 데이터 기준으로** 진단한다.

    '가능/불가능'을 단정하지 않고 (필요 표본, 확보 표본, 부족분)을 나란히 낸다.
    부족분이 있으면 그대로 보여 주는 것이 이 함수의 일이다.

    피처의 '의미'와 커버리지 계산은 `model_feature_service` 가 책임진다 — 여기서 다시
    정의하면 검색·통계·ML 이 서로 다른 피처를 쓰게 된다. 이 함수는 **정책**(최소 표본,
    차단 조건)만 담당한다.
    """
    total = len(revisions)

    # 스키마가 낮아 '애초에 못 뽑는' 피처를 결측으로 세지 않는다(feature_coverage 참조).
    features = feature_coverage(revisions)

    # 라벨 가용성 — 분류는 소수 클래스가 병목이다.
    outcome_counts = Counter(
        r.get("design_outcome") for r in revisions if r.get("design_outcome")
    )
    labeled_outcomes = sum(
        c for o, c in outcome_counts.items() if o and o != "unknown"
    )
    known_classes = {o: c for o, c in outcome_counts.items() if o and o != "unknown"}
    minority_class = min(known_classes.values()) if known_classes else 0

    labeled_utilization = sum(
        1 for r in revisions if _as_float(r.get("max_utilization")) is not None
    )

    tasks = []
    for spec in DATASET_TASKS:
        if not spec["needsLabel"]:
            available = total
        elif spec.get("labelField") == "design_outcome":
            available = labeled_outcomes
        else:
            available = labeled_utilization

        shortfall = max(spec["minSamples"] - available, 0)
        blockers = []
        if spec.get("labelField") == "design_outcome" and known_classes:
            if minority_class < 30:
                blockers.append(
                    f"가장 적은 클래스가 {minority_class}건입니다. "
                    "한쪽으로 치우친 표본으로 학습하면 다수 클래스만 맞히는 모델이 됩니다."
                )
        elif spec.get("labelField") == "design_outcome":
            blockers.append("해석까지 끝난 모델이 없어 정답 라벨이 아직 없습니다.")

        tasks.append({
            "key": spec["key"],
            "label": spec["label"],
            "kind": spec["kind"],
            "why": spec["why"],
            "minSamples": spec["minSamples"],
            "available": available,
            "shortfall": shortfall,
            "ready": shortfall == 0 and not blockers,
            "blockers": blockers,
        })

    # 학습을 방해하는 구조적 문제 — 표본 수와 별개로 먼저 풀어야 하는 것들.
    unit_declared = sum(1 for r in revisions if _length_unit(r))
    solved = sum(
        1 for r in revisions
        if (_summary_of(r).get("modelQuality") or {}).get("solverRan")
    )
    caveats = []
    if total and unit_declared < total:
        caveats.append(
            f"길이 단위가 선언되지 않은 모델 {total - unit_declared}건 — "
            "단위가 섞인 채로 학습하면 치수 피처가 무의미해집니다."
        )
    if total and solved < total:
        caveats.append(
            f"Nastran 해석까지 끝나지 않은 모델 {total - solved}건 — "
            "응력·사용률 라벨을 만들 수 없습니다."
        )
    unique_models = len({r.get("model_uid") for r in revisions if r.get("model_uid")})
    if unique_models and total > unique_models:
        caveats.append(
            f"같은 모델의 revision 이 함께 집계되어 있습니다(모델 {unique_models} / revision {total}) — "
            "학습·검증 분할 시 같은 모델이 양쪽에 들어가면 성능이 부풀려집니다."
        )
    family_keys = {family_key(r.get("model_type")) for r in revisions}
    if len(family_keys) > 1:
        caveats.append(
            f"서로 다른 계열 {len(family_keys)}종이 함께 집계되어 있습니다 — "
            "계열이 다르면 형상·하중 특성이 달라, 한 학습 표본으로 섞으면 "
            "계열을 맞히는 모델이 됩니다."
        )

    # 학습에 실제로 쓸 수 있는 부분집합과, 무엇이 왜 빠졌는지.
    trainable = build_cohort(
        revisions,
        require_length_unit=True,
        require_design_label=True,
    )

    return {
        "sampleSize": total,
        "distinctModels": unique_models,
        "extractorVersion": FEATURE_EXTRACTOR_VERSION,
        # 전체 표본과 '실제로 학습에 넣을 수 있는' 표본은 다르다 — 둘 다 보여 준다.
        "trainableCohort": trainable.to_dict(),
        # 누수 없는 분할이 가능한지(같은 모델이 두 fold 에 걸치지 않는지)를 미리 검증한다.
        "split": split_report(revisions) if unique_models >= 2 else None,
        "features": features,
        "labels": {
            "designOutcome": {
                "labeled": labeled_outcomes,
                "unlabeled": total - labeled_outcomes,
                "classes": [
                    {"key": k, "count": v}
                    for k, v in sorted(known_classes.items(), key=lambda kv: -kv[1])
                ],
                "minorityClass": minority_class if known_classes else None,
            },
            "maxUtilization": {
                "labeled": labeled_utilization,
                "unlabeled": total - labeled_utilization,
            },
        },
        "tasks": tasks,
        "caveats": caveats,
        "note": (
            "최소 표본 수는 통계적 보장이 아니라 착수 판단을 위한 사내 기준값입니다. "
            "표본을 채웠다는 것과 성능이 쓸 만하다는 것은 다른 문제입니다."
        ),
    }


# --------------------------------------------------------------------------- #
# 스코프 투영 — '라이브러리 전체' 와 '이 계열' 은 다른 질문이다
# --------------------------------------------------------------------------- #
#
# 블록마다 올바른 스코프가 하나로 정해진다. 개수·분포·데이터 위생은 전체에서만 의미가 있고
# (계열별로 쪼개면 라이브러리 상태를 볼 수 없다), 연속값의 중심경향·비율·교차표·학습 표본은
# 계열 안에서만 의미가 있다(혼합 모집단에서는 평균이 거짓말을 하고 교차표는 역전된다).
#
# ★ 기존 aggregate_registry_insights() 의 계약은 건드리지 않는다. 두 번 호출해 투영만 한다.
#   대가로 버릴 블록도 계산하지만 전부 순수 파이썬 카운팅이며, 규모가 커지면 여기가 손댈 자리다.

OVERALL_BLOCKS = ("totals", "distributions", "topTags", "recentTrend")
FAMILY_BLOCKS = ("metrics", "qualityIssues", "qualityByOutcome")

# datasetReadiness 에서 전체 스코프로 올려 보내는 키(= 데이터 위생).
HYGIENE_KEYS = ("features", "split")


def family_distribution(revisions: list[dict]) -> list[dict]:
    """계열별 revision 수. **실제 존재하는 계열만** 낸다(0 을 채우지 않는다).

    정렬은 (건수 내림, 키 오름) 으로 결정적이다 — 첫 항목이 기본 선택 계열이 된다.
    """
    counter = Counter(family_key(r.get("model_type")) for r in revisions)
    ordered = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    return [
        {"key": key, "label": family_label(key), "count": count}
        for key, count in ordered
    ]


def build_scoped_overview(
    revisions: list[dict], *, family: Optional[str] = None,
) -> dict:
    """Insight 응답 — 전체 스코프와 계열 스코프를 각각 계산해 나란히 낸다.

    family 를 주지 않으면 **건수 최다 계열**을 고르고, 무엇을 골랐는지 scope.family 로
    항상 되돌려 준다(첫 렌더가 요청 1번으로 끝나고 빈 카드가 생기지 않는다).
    존재하지 않는 계열 키를 주면 오류가 아니라 **빈 계열 스코프**를 낸다 —
    표본 0 을 정직하게 0 으로 내는 기존 태도와 같다.
    """
    families = family_distribution(revisions)
    selected = family if family is not None else (families[0]["key"] if families else None)

    overall_agg = aggregate_registry_insights(revisions)
    overall = {key: overall_agg[key] for key in OVERALL_BLOCKS}
    overall_readiness = overall_agg.get("datasetReadiness") or {}
    overall["dataHygiene"] = {
        "extractorVersion": overall_readiness.get("extractorVersion"),
        "features": overall_readiness.get("features") or [],
        "split": overall_readiness.get("split"),
    }

    family_rows: list[dict] = []
    family_block = None
    if selected is not None:
        family_rows = [r for r in revisions if family_key(r.get("model_type")) == selected]
        family_agg = aggregate_registry_insights(family_rows)
        family_block = {key: family_agg[key] for key in FAMILY_BLOCKS}
        family_readiness = family_agg.get("datasetReadiness") or {}
        family_block["datasetReadiness"] = {
            key: value
            for key, value in family_readiness.items()
            if key not in HYGIENE_KEYS
        }

    return {
        "scope": {
            "family": selected,
            "familyLabel": family_label(selected) if selected else None,
            "familyCount": len(families),
            "sampleSize": {"overall": len(revisions), "family": len(family_rows)},
        },
        "families": families,
        "overall": overall,
        "family": family_block,
    }


# --------------------------------------------------------------------------- #
# export
# --------------------------------------------------------------------------- #

# 기본 export 에서 제외하는 개인 식별 필드.
PII_FIELDS = ("owner_id", "registered_by")


def build_export_rows(revisions: list[dict], *, include_identity: bool = False) -> list[dict]:
    """Insight/데이터셋 export 행. **기본적으로 사번을 포함하지 않는다.**

    등록자·소유자 사번은 분석 목적에 불필요하고 개인 식별 정보라, 명시적으로 요청한
    (그리고 권한이 있는) 경우에만 넣는다.
    """
    rows = []
    for r in revisions:
        summary = _summary_of(r)
        quality = summary.get("modelQuality") or {}
        geometry = summary.get("geometry") or {}
        outcome = summary.get("analysisOutcome") or {}
        row = {
            "model_uid": r.get("model_uid"),
            "revision": r.get("revision_no"),
            "title": r.get("title"),
            "model_type": r.get("model_type"),
            "model_role": r.get("model_role"),
            "tags": r.get("tags") or [],
            "source_program": r.get("source_program_name"),
            "source_artifact_kind": r.get("source_artifact_kind"),
            "quality_level": r.get("quality_level"),
            "review_status": r.get("review_status"),
            "design_outcome": r.get("design_outcome"),
            "node_count": r.get("node_count"),
            "element_count": r.get("element_count"),
            "total_mass_kg": r.get("total_mass_kg"),
            "max_utilization": r.get("max_utilization"),
            "length_unit": _length_unit(r),
            "element_breakdown": geometry.get("elementBreakdown") or {},
            "quality_issues": {k: quality.get(k) for k in QUALITY_ISSUE_KEYS},
            "max_stress_mpa": outcome.get("maxStressMPa"),
            "allowable_stress_mpa": outcome.get("allowableStressMPa"),
            "created_at": r.get("created_at").isoformat()
            if isinstance(r.get("created_at"), (datetime, date))
            else r.get("created_at"),
        }
        if include_identity:
            for field in PII_FIELDS:
                row[field] = r.get(field)
        rows.append(row)
    return rows
