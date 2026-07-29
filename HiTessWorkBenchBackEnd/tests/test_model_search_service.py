"""Model Library — 설명 가능한 유사 모델 검색 테스트.

지켜야 할 계약:
1. **근거 없는 차원은 평균에서 뺀다.** 0 으로 채우면 '완전히 다르다', 1 로 채우면
   '완전히 같다'가 된다. 둘 다 거짓말이다.
2. 길이 단위가 다르면 **치수 차원만** 빼고 나머지는 비교한다(개수·구성은 단위와 무관).
3. 총점만 주지 않는다 — 차원별 기여를 항상 함께 낸다.
4. 정렬은 결정적이다(같은 입력 → 같은 순서).
"""
import pytest

from app.services.model_search_service import (
    DIMENSIONS_BY_KEY,
    compare,
    descriptor,
    find_similar,
)


def _rev(uid, *, nodes=100, elements=120, breakdown=None, unit="mm",
         span=(0, 1000, 0, 500, 0, 200), model_type="module-unit", title=None):
    bbox = None
    if span is not None:
        bbox = {
            "xMin": span[0], "xMax": span[1],
            "yMin": span[2], "yMax": span[3],
            "zMin": span[4], "zMax": span[5],
        }
    return {
        "model_uid": uid,
        "title": title or f"모델 {uid}",
        "revision_no": 1,
        "schema_version": "1.1",
        "model_type": model_type,
        "source_program_name": "HiTessModelBuilder",
        "quality_level": "Q2",
        "design_outcome": "pass",
        "node_count": nodes,
        "element_count": elements,
        "summary_json": {
            "units": {"length": unit} if unit else {},
            "geometry": {
                "nodeCount": nodes,
                "elementCount": elements,
                "boundingBox": bbox,
                "elementBreakdown": breakdown if breakdown is not None else {"BEAM": 100, "RBE2": 20},
            },
        },
    }


# --------------------------------------------------------------------------- #
# compare — 근거를 함께 낸다
# --------------------------------------------------------------------------- #

def test_identical_models_score_one_with_full_basis():
    a, b = descriptor(_rev("A")), descriptor(_rev("B"))
    result = compare(a, b)

    assert result["score"] == pytest.approx(1.0)
    assert result["basisWeight"] == pytest.approx(1.0), "모든 차원에 근거가 있어야 한다"
    assert result["skipped"] == []


def test_every_scored_dimension_reports_its_contribution():
    result = compare(descriptor(_rev("A")), descriptor(_rev("B", nodes=50)))
    keys = {d["key"] for d in result["basis"]}
    assert keys == set(DIMENSIONS_BY_KEY)
    for entry in result["basis"]:
        assert 0.0 <= entry["similarity"] <= 1.0
        assert entry["weight"] > 0
        assert entry["label"]


def test_missing_dimension_is_skipped_not_zeroed():
    """치수를 모르는 모델을 '치수가 완전히 다르다'로 처리하면 순위가 뒤집힌다."""
    a = descriptor(_rev("A"))
    b = descriptor(_rev("B", span=None))
    result = compare(a, b)

    skipped = {s["key"] for s in result["skipped"]}
    assert "modelSpan" in skipped
    assert result["basisWeight"] < 1.0
    # 나머지가 전부 같으므로 점수는 여전히 1.0 이어야 한다(0 으로 깎이면 안 된다).
    assert result["score"] == pytest.approx(1.0)


def test_unit_mismatch_drops_only_the_size_dimension():
    """mm 와 m 을 환산해 비교하지 않되, 개수·구성은 단위와 무관하므로 계속 비교한다."""
    a = descriptor(_rev("A", unit="mm"))
    b = descriptor(_rev("B", unit="m"))
    result = compare(a, b)

    assert result["unitMismatch"] is True
    skipped = {s["key"] for s in result["skipped"]}
    assert skipped == {"modelSpan"}
    assert {d["key"] for d in result["basis"]} == set(DIMENSIONS_BY_KEY) - {"modelSpan"}


def test_unit_mismatch_reason_names_both_units():
    result = compare(descriptor(_rev("A", unit="mm")), descriptor(_rev("B", unit="m")))
    reason = next(s["reason"] for s in result["skipped"] if s["key"] == "modelSpan")
    assert "mm" in reason and "m" in reason


def test_composition_dominates_when_shapes_differ():
    """개수가 같아도 부재 종류가 다르면 같은 모델이라 부를 수 없다."""
    a = descriptor(_rev("A", breakdown={"BEAM": 100}))
    b = descriptor(_rev("B", breakdown={"QUAD4": 100}))
    result = compare(a, b)
    composition = next(d for d in result["basis"] if d["key"] == "elementBreakdown")
    assert composition["similarity"] == pytest.approx(0.0)
    assert result["score"] < 0.75


def test_score_is_none_when_nothing_can_be_compared():
    bare = {"model_uid": "X", "lengthUnit": None}
    result = compare(bare, bare)
    assert result["score"] is None
    assert result["basisWeight"] == 0


# --------------------------------------------------------------------------- #
# find_similar — 순위와 자기 제외
# --------------------------------------------------------------------------- #

def test_similar_excludes_the_target_itself():
    target = _rev("A")
    result = find_similar(target, [target, _rev("B")])
    assert [i["model_uid"] for i in result["items"]] == ["B"]


def test_similar_ranks_closer_models_first():
    target = _rev("T", nodes=100, elements=120)
    near = _rev("near", nodes=105, elements=125)
    far = _rev("far", nodes=900, elements=1100)

    result = find_similar(target, [far, near])
    assert [i["model_uid"] for i in result["items"]] == ["near", "far"]
    assert result["items"][0]["score"] > result["items"][1]["score"]


def test_similar_respects_the_limit():
    target = _rev("T")
    candidates = [_rev(f"c{i}", nodes=100 + i) for i in range(12)]
    assert len(find_similar(target, candidates, limit=3)["items"]) == 3


def test_similar_drops_candidates_with_too_thin_a_basis():
    """근거 차원 하나로 나온 0.99 를 1위에 올리면 추천 전체의 신뢰가 무너진다."""
    target = _rev("T")
    thin = {
        "model_uid": "thin", "title": "근거 부족", "revision_no": 1,
        "model_type": None, "source_program_name": None,
        "quality_level": None, "design_outcome": None,
        "node_count": None, "element_count": None,
        "summary_json": {"units": {}, "geometry": {}},
    }
    result = find_similar(target, [thin, _rev("solid")])

    assert [i["model_uid"] for i in result["items"]] == ["solid"]
    assert result["skippedThinBasis"] == 1
    assert result["comparedCount"] == 2, "걸러진 것도 비교 시도에는 포함해 숫자를 숨기지 않는다"


def test_similar_is_deterministic_for_ties():
    target = _rev("T")
    twins = [_rev("b"), _rev("a"), _rev("c")]
    first = [i["model_uid"] for i in find_similar(target, twins)["items"]]
    second = [i["model_uid"] for i in find_similar(target, list(reversed(twins)))["items"]]
    assert first == second == ["a", "b", "c"]


def test_similar_returns_the_same_shape_when_there_are_no_candidates():
    result = find_similar(_rev("T"), [])
    assert result["items"] == []
    assert result["comparedCount"] == 0
    assert result["dimensions"], "빈 결과에서도 가중치 설명은 나가야 한다"


def test_similar_explains_its_method_and_limits():
    result = find_similar(_rev("T"), [_rev("B")])
    assert result["method"] == "weighted-ratio"
    # '같은 모양'과 '같은 용도'를 혼동하지 않게 하는 문구는 계약이다.
    assert "모양" in result["note"]
    assert result["extractorVersion"]


def test_similar_never_leaks_summary_or_paths():
    result = find_similar(_rev("T"), [_rev("B")])
    blob = str(result)
    assert "summary_json" not in blob
    assert "storage_relative_path" not in blob
