"""Model Library — 피처 / 코호트 / 분할 모듈.

**왜 집계에서 떼어냈나.**

피처의 '의미'가 `model_insight_service.aggregate_registry_insights()` 안에 박혀 있었다.
그래서 세 가지가 한꺼번에 깨졌다.

1. **이종 스키마를 함께 셌다.** summary schema 1.0 으로 등록된 revision 에는
   `physicalProperties.totalMassKg` 가 **구조적으로 없다**(그 시절 추출기가 항상 None 을 넣었다).
   이걸 1.1 revision 의 결측과 같은 칸에 세면 "질량 커버리지 40%" 같은 숫자가 나오는데,
   실제로는 "1.1 로 등록된 것 중에서는 100%" 일 수 있다. **없는 것과 못 뽑은 것은 다르다.**
2. **cohort 개념이 없었다.** "단위가 선언된 모델만", "해석까지 끝난 모델만" 같은 부분집합을
   만들 때마다 호출부가 각자 필터를 짰다. 제외 사유를 세는 곳도, 안 세는 곳도 있었다.
3. **분할 규칙이 문서에만 있었다.** "model_uid 기준 GroupKFold" 는 ML 로드맵 문서에만 적혀
   있고 코드에는 없었다. 문서에만 있는 규칙은 지켜지지 않는다.

검색·통계·ML 이 **같은 인터페이스**를 쓰게 하려고 여기로 모았다.
순수 함수라 DB/파일 없이 테스트된다(입력은 평범한 dict 리스트).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

# 이 파일의 추출 규칙이 바뀌면 올린다. 저장된 피처를 재계산해야 하는지 판단하는 근거이며,
# 학습 데이터셋에 반드시 함께 기록한다(같은 버전끼리만 비교할 수 있다).
FEATURE_EXTRACTOR_VERSION = "1.0"


def _as_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if f != f else f   # NaN 제거


def _schema_tuple(version: Optional[str]) -> tuple[int, ...]:
    """'1.10' > '1.9' 가 되도록 문자열이 아니라 숫자 튜플로 비교한다."""
    if not version:
        return (0,)
    parts = []
    for chunk in str(version).split("."):
        try:
            parts.append(int(chunk))
        except ValueError:
            parts.append(0)
    return tuple(parts) or (0,)


def _summary(revision: dict) -> dict:
    return revision.get("summary_json") or {}


def _schema_version(revision: dict) -> str:
    """revision 이 어느 추출 계약으로 만들어졌는지.

    DB 컬럼을 우선 믿고, 없으면 summary 안의 선언을 본다. 둘 다 없으면 1.0 으로 본다
    (최초 배포 버전이라 그 시절 데이터는 전부 1.0 이다).
    """
    return (
        revision.get("schema_version")
        or _summary(revision).get("schemaVersion")
        or "1.0"
    )


# --------------------------------------------------------------------------- #
# 피처 정의 — 의미가 한곳에 모인다
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class FeatureSpec:
    """학습 입력 후보 하나의 '의미'.

    `since_schema` 가 핵심이다. 이 버전보다 낮은 스키마로 등록된 revision 에서 이 피처는
    **결측이 아니라 '해당 없음'** 이다. 커버리지 분모에서 빼야 통계가 정직해진다.
    """

    key: str
    label: str
    kind: str                 # scalar | derived | categorical | vector
    since_schema: str
    extract: Callable[[dict], Any]
    unit_sensitive: bool = False
    description: str = ""

    def applies_to(self, revision: dict) -> bool:
        return _schema_tuple(_schema_version(revision)) >= _schema_tuple(self.since_schema)


def _geometry(revision: dict) -> dict:
    return _summary(revision).get("geometry") or {}


def length_unit(revision: dict) -> Optional[str]:
    return (_summary(revision).get("units") or {}).get("length") or None


def model_span(revision: dict) -> Optional[float]:
    """bounding box 의 최대 변. 단위에 종속되므로 단독 비교 금지."""
    bbox = _geometry(revision).get("boundingBox") or {}
    dims = []
    for lo, hi in (("xMin", "xMax"), ("yMin", "yMax"), ("zMin", "zMax")):
        a, b = _as_float(bbox.get(lo)), _as_float(bbox.get(hi))
        if a is None or b is None:
            return None
        dims.append(abs(b - a))
    return max(dims) if dims else None


def element_breakdown(revision: dict) -> Optional[dict]:
    value = _geometry(revision).get("elementBreakdown") or None
    return value if isinstance(value, dict) and value else None


def _input_conversion_rate(revision: dict) -> Optional[float]:
    audit = _summary(revision).get("inputAudit") or {}
    return _as_float(audit.get("conversionRate"))


def _stage_count(revision: dict) -> Optional[int]:
    stages = _summary(revision).get("buildStages") or {}
    value = stages.get("stageCount")
    return int(value) if isinstance(value, int) else None


def _warning_count(revision: dict) -> Optional[int]:
    diagnostics = _summary(revision).get("diagnostics") or {}
    value = (diagnostics.get("counts") or {}).get("warning")
    return int(value) if isinstance(value, int) else None


def _total_mass(revision: dict) -> Optional[float]:
    # 1.0 시절 추출기는 이 값을 **항상 None** 으로 넣었다. 그래서 since_schema 가 1.1 이다.
    return _as_float(
        revision.get("total_mass_kg")
        or (_summary(revision).get("physicalProperties") or {}).get("totalMassKg")
    )


FEATURE_SPECS: tuple[FeatureSpec, ...] = (
    FeatureSpec("node_count", "노드 수", "scalar", "1.0",
                lambda r: _as_float(r.get("node_count") or _geometry(r).get("nodeCount"))),
    FeatureSpec("element_count", "요소 수", "scalar", "1.0",
                lambda r: _as_float(r.get("element_count") or _geometry(r).get("elementCount"))),
    FeatureSpec("rigid_count", "강체 요소 수", "scalar", "1.0",
                lambda r: _as_float(_geometry(r).get("rigidElementCount"))),
    FeatureSpec("point_mass_count", "집중 질량 수", "scalar", "1.0",
                lambda r: _as_float(_geometry(r).get("pointMassCount"))),
    FeatureSpec("model_span", "모델 최대 치수", "derived", "1.0", model_span,
                unit_sensitive=True,
                description="길이 단위가 다른 모델끼리 그대로 비교하면 안 된다."),
    FeatureSpec("length_unit", "길이 단위", "categorical", "1.0", length_unit),
    FeatureSpec("element_breakdown", "요소 구성", "vector", "1.0", element_breakdown,
                description="요소 종류별 개수. 비율로 정규화해 쓰면 규모와 무관한 형태 지표가 된다."),
    FeatureSpec("source_program", "원 프로그램", "categorical", "1.0",
                lambda r: r.get("source_program_name")),
    FeatureSpec("model_type", "모델 종류", "categorical", "1.0",
                lambda r: r.get("model_type")),
    # ── 스키마 1.1 이후에만 존재 ──
    FeatureSpec("total_mass_kg", "총 질량", "scalar", "1.1", _total_mass,
                description="1.0 추출기는 이 값을 항상 비워 뒀다 — 그 시절 데이터에서는 '해당 없음'이다."),
    FeatureSpec("input_conversion_rate", "입력 변환율", "scalar", "1.1", _input_conversion_rate,
                description="원본 CSV 중 실제로 모델이 된 비율. 낮으면 형상이 원본과 다르다."),
    FeatureSpec("stage_count", "생성 단계 수", "scalar", "1.1", _stage_count),
    FeatureSpec("warning_count", "엔진 경고 수", "scalar", "1.1", _warning_count),
)

FEATURES_BY_KEY = {spec.key: spec for spec in FEATURE_SPECS}


def _is_present(value: Any) -> bool:
    return value not in (None, "", {}, [])


def feature_row(revision: dict) -> dict:
    """revision 하나의 피처 값 + 어느 추출 계약으로 뽑았는지.

    해당 없음(스키마 미달)은 값 자체를 넣지 않는다 — None 으로 넣으면 결측과 구분되지 않는다.
    """
    values: dict[str, Any] = {}
    not_applicable: list[str] = []
    for spec in FEATURE_SPECS:
        if not spec.applies_to(revision):
            not_applicable.append(spec.key)
            continue
        values[spec.key] = spec.extract(revision)
    return {
        "model_uid": revision.get("model_uid"),
        "revision_no": revision.get("revision_no"),
        "schemaVersion": _schema_version(revision),
        "extractorVersion": FEATURE_EXTRACTOR_VERSION,
        "values": values,
        "notApplicable": not_applicable,
    }


def feature_coverage(revisions: list[dict]) -> list[dict]:
    """피처별 채움 비율.

    ★ 분모는 **그 피처가 적용되는 revision 수** 다(전체가 아니다).
    스키마가 낮아 애초에 못 뽑는 것을 결측으로 세면 "데이터를 더 모으면 채워진다"는
    잘못된 결론이 나온다. 실제로 필요한 조치는 재등록(스키마 갱신)이다.
    """
    out = []
    for spec in FEATURE_SPECS:
        applicable = [r for r in revisions if spec.applies_to(r)]
        present = sum(1 for r in applicable if _is_present(spec.extract(r)))
        out.append({
            "key": spec.key,
            "label": spec.label,
            "kind": spec.kind,
            "sinceSchema": spec.since_schema,
            "applicable": len(applicable),
            "notApplicable": len(revisions) - len(applicable),
            "present": present,
            "missing": len(applicable) - present,
            # 적용 대상이 0 이면 비율은 0% 가 아니라 정의되지 않음이다.
            "coverage": (present / len(applicable)) if applicable else None,
            "description": spec.description,
        })
    return out


# --------------------------------------------------------------------------- #
# 코호트 — "어떤 부분집합으로 계산했나"를 결과와 함께 들고 다닌다
# --------------------------------------------------------------------------- #

@dataclass
class Cohort:
    """분석 대상 부분집합 + **왜 빠졌는지**.

    제외 사유를 같이 들고 다니지 않으면, 화면에 뜬 n 이 왜 그 숫자인지 아무도 설명하지 못한다.
    """

    rows: list[dict]
    excluded: list[dict] = field(default_factory=list)
    filters: dict = field(default_factory=dict)

    @property
    def size(self) -> int:
        return len(self.rows)

    def to_dict(self) -> dict:
        return {
            "size": self.size,
            "excluded": self.excluded,
            "filters": self.filters,
            "extractorVersion": FEATURE_EXTRACTOR_VERSION,
        }


def build_cohort(
    revisions: list[dict],
    *,
    min_schema: Optional[str] = None,
    require_length_unit: bool = False,
    require_solver_run: bool = False,
    require_design_label: bool = False,
    dominant_unit_only: bool = False,
) -> Cohort:
    """조건을 만족하는 revision 만 남기고, 빠진 것을 사유별로 센다."""
    rows = list(revisions)
    excluded: list[dict] = []

    def _drop(predicate, reason: str) -> None:
        nonlocal rows
        kept, dropped = [], 0
        for r in rows:
            if predicate(r):
                kept.append(r)
            else:
                dropped += 1
        if dropped:
            excluded.append({"reason": reason, "count": dropped})
        rows = kept

    if min_schema:
        _drop(
            lambda r: _schema_tuple(_schema_version(r)) >= _schema_tuple(min_schema),
            f"summary 스키마 {min_schema} 미만 — 재등록해야 채워집니다",
        )
    if require_length_unit:
        _drop(lambda r: bool(length_unit(r)), "길이 단위 미선언")
    if require_solver_run:
        _drop(
            lambda r: bool((_summary(r).get("modelQuality") or {}).get("solverRan")),
            "Nastran 해석 미수행",
        )
    if require_design_label:
        _drop(
            lambda r: (r.get("design_outcome") or "unknown") != "unknown",
            "설계 결과 라벨 없음(미해석)",
        )
    if dominant_unit_only:
        units = [length_unit(r) for r in rows if length_unit(r)]
        dominant = max(set(units), key=units.count) if units else None
        if dominant:
            _drop(
                lambda r: length_unit(r) == dominant,
                f"길이 단위가 지배 단위({dominant})와 다름",
            )

    return Cohort(
        rows=rows,
        excluded=excluded,
        filters={
            "minSchema": min_schema,
            "requireLengthUnit": require_length_unit,
            "requireSolverRun": require_solver_run,
            "requireDesignLabel": require_design_label,
            "dominantUnitOnly": dominant_unit_only,
        },
    )


# --------------------------------------------------------------------------- #
# 분할 — 같은 모델이 학습/검증 양쪽에 들어가면 성능이 부풀려진다
# --------------------------------------------------------------------------- #

def group_kfold(revisions: list[dict], k: int = 5) -> list[list[int]]:
    """`model_uid` 를 그룹으로 묶어 fold 를 만든다.

    같은 모델의 revision 은 형상이 거의 같으므로, 하나가 학습에 들어가고 다른 하나가 검증에
    들어가면 **답을 보고 시험을 치는 것**이 된다. 이 규칙이 문서에만 있으면 지켜지지 않아
    코드로 옮겼다.

    난수를 쓰지 않는다 — 같은 입력이면 항상 같은 분할이라야 실험을 재현할 수 있다.
    큰 그룹부터 가장 작은 fold 에 넣는 greedy 방식(그룹 크기 균형).

    Returns: fold 마다 `revisions` 의 인덱스 리스트
    """
    if k < 2:
        raise ValueError("fold 는 2 이상이어야 합니다.")

    groups: dict[str, list[int]] = {}
    for idx, rev in enumerate(revisions):
        # uid 가 없으면 그 행만의 고유 그룹으로 둔다(다른 행과 섞이지 않게).
        uid = rev.get("model_uid") or f"__row_{idx}"
        groups.setdefault(uid, []).append(idx)

    # 큰 그룹 먼저, 동률이면 uid 사전순 — 결정적 순서
    ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    folds: list[list[int]] = [[] for _ in range(k)]
    for uid, indices in ordered:
        target = min(range(k), key=lambda i: (len(folds[i]), i))
        folds[target].extend(indices)
    return folds


def split_report(revisions: list[dict], k: int = 5) -> dict:
    """분할 결과 요약 — 누수가 없다는 것을 **증명 가능한 형태**로 낸다."""
    folds = group_kfold(revisions, k)
    uid_by_fold = [
        {revisions[i].get("model_uid") for i in fold if revisions[i].get("model_uid")}
        for fold in folds
    ]
    overlaps = 0
    for i in range(len(uid_by_fold)):
        for j in range(i + 1, len(uid_by_fold)):
            overlaps += len(uid_by_fold[i] & uid_by_fold[j])

    return {
        "folds": k,
        "sizes": [len(f) for f in folds],
        "distinctModels": len({r.get("model_uid") for r in revisions if r.get("model_uid")}),
        "groupOverlap": overlaps,          # 0 이어야 한다
        "leakageFree": overlaps == 0,
        "note": "같은 model_uid 의 revision 은 반드시 같은 fold 에 있어야 합니다.",
    }


# --------------------------------------------------------------------------- #
# 유사도 계산에 쓰는 기본 연산 (검색 모듈이 재사용)
# --------------------------------------------------------------------------- #

def ratio_similarity(a: Optional[float], b: Optional[float]) -> Optional[float]:
    """두 양수의 비율 유사도 = min/max.

    거리(距離)가 아니라 비율을 쓰는 이유는 **설명 가능하기 때문**이다.
    "노드 수가 0.92" 는 "8% 차이"로 바로 읽히지만, 정규화된 유클리드 거리는 읽을 수 없다.
    규모에 무관하고 항상 [0, 1] 이라 가중 평균에 그대로 넣을 수 있다.
    """
    if a is None or b is None:
        return None
    if a < 0 or b < 0:
        return None
    if a == 0 and b == 0:
        return 1.0
    hi = max(a, b)
    if hi == 0:
        return 1.0
    return min(a, b) / hi


def composition_similarity(a: Optional[dict], b: Optional[dict]) -> Optional[float]:
    """요소 구성(종류별 개수)의 코사인 유사도.

    개수를 **비율로 정규화한 뒤** 비교하므로 모델 규모가 달라도 '같은 종류로 이루어졌는가'를
    본다. 작은 시험 모델과 큰 실물 모델이 같은 부재 구성이면 높은 값이 나온다.
    """
    if not a or not b:
        return None
    keys = set(a) | set(b)
    if not keys:
        return None

    def _normalized(d: dict) -> dict[str, float]:
        total = sum(v for v in d.values() if isinstance(v, (int, float)) and v > 0)
        if total <= 0:
            return {}
        return {k: (v / total) for k, v in d.items() if isinstance(v, (int, float)) and v > 0}

    na, nb = _normalized(a), _normalized(b)
    if not na or not nb:
        return None

    dot = sum(na.get(k, 0.0) * nb.get(k, 0.0) for k in keys)
    mag_a = math.sqrt(sum(v * v for v in na.values()))
    mag_b = math.sqrt(sum(v * v for v in nb.values()))
    if mag_a == 0 or mag_b == 0:
        return None
    return max(0.0, min(1.0, dot / (mag_a * mag_b)))


def categorical_similarity(a: Any, b: Any) -> Optional[float]:
    """같으면 1, 다르면 0. **한쪽이라도 없으면 None** — 모른다는 것을 0 으로 쓰지 않는다."""
    if a in (None, "") or b in (None, ""):
        return None
    return 1.0 if a == b else 0.0
