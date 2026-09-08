"""Mooring Fitting 진단(mooring_diagnosis) — 케이스 단위 / 부재 단위 규칙 테스트.

배경: C# 엔진은 사실(부재 출신·경계조건·하중경로 등)만 조인해서 MODEL_EVIDENCE.json 으로
낸다. 이 모듈은 그 사실에 임계값과 문장을 입혀 "왜 이 부재가 과대응력인가"를 사용자에게
근거 수치와 함께 설명한다. 임계값·문구가 자주 바뀌므로 판정을 엔진이 아니라 여기에 둔다.
"""
from app.services.mooring_diagnosis import (
    CONFIDENCE_CONFIRMED,
    CONFIDENCE_LIKELY,
    CONFIDENCE_REFERENCE,
    SECTION_PEER_MIN,
    diagnose,
)


# ══════════════════════════════════════════════════════════════
# 헬퍼 — 최소 유효 evidence / result / equilibrium 골격
# ══════════════════════════════════════════════════════════════

def _evidence(**overrides) -> dict:
    base = {
        "meta": {
            "schemaVersion": "1.0",
            "elementCount": 10,
            "elementsWithOrigin": 10,
            "fabricatedCount": 0,
        },
        "caseFacts": {
            "substantiveSkips": 0,
            "mfInputCount": 8,
            "winchInputCount": 2,
            "forceLoadCount": 10,
            "spcNodeCount": 82,
            "rbe2Count": 8,
            "loadCaseCount": 11,
        },
        "elements": [],
    }
    for key, val in overrides.items():
        if isinstance(val, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **val}
        else:
            base[key] = val
    return base


def _equilibrium(**overrides) -> dict:
    base = {
        "schemaVersion": "1.0",
        "performed": True,
        "skipReason": None,
        "worstRelResidual": 1.66e-07,
        "failed": False,
        "warned": False,
        "relTolWarn": 0.001,
        "relTolFail": 0.01,
        "subcases": [],
    }
    base.update(overrides)
    return base


def _element_evidence(element_id=2312, kind="derived", **overrides) -> dict:
    base = {
        "elementId": element_id,
        "propertyId": 142,
        "origin": {"kind": kind, "rawKind": "PLATE", "csvLine": 196, "rawId": "FOR-Y3745_2",
                   "chain": ["00_BuildRaw"]},
        "section": {"propertyId": 142, "type": "I", "areaMm2": 17400.0,
                    "iWeakMm4": 352470000.0, "iStrongMm4": 463872586.2},
        "geometry": {"n1": 221, "n2": 1303, "lengthMm": 290.5},
        "loadPath": {"hops": 5},
        "boundary": {"spcHops": 10, "spcSource": "FreeEnd"},
    }
    for key, val in overrides.items():
        if isinstance(val, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **val}
        else:
            base[key] = val
    return base


def _result_element(element_id=2312, ok=False, **overrides) -> dict:
    base = {
        "id": element_id, "n1": 221, "n2": 1303, "propertyId": 142,
        "combined": 410.2, "vonMises": 534.6, "usage": 1.697, "ok": ok,
        "nx": 40.0, "my": 300.0, "mz": 10.0, "mx": 0.0, "qy": 5.0, "qz": 1.0,
        "axial": 12000.0, "bm1": 3.4e6, "bm2": 1.1e5,
    }
    base.update(overrides)
    return base


def _result(elements, load_case_id=8) -> dict:
    return {
        "schemaVersion": "2.0", "quantity": "vonMisesStress", "unit": "MPa",
        "yieldStress": 315.0, "gammaM": 1.0, "allowable": 315.0,
        "globalMaxUsage": 1.697, "ok": False, "caseCount": 1,
        "cases": [{"loadCaseId": load_case_id, "max": 534.6, "maxUsage": 1.697,
                   "elementCount": len(elements), "elements": elements}],
    }


def _codes(findings, code=None):
    if code is None:
        return [f["code"] for f in findings]
    return [f for f in findings if f["code"] == code]


# ══════════════════════════════════════════════════════════════
# Task 12 — 케이스 단위 규칙
# ══════════════════════════════════════════════════════════════

class TestNoIssues:
    def test_clean_evidence_has_no_findings(self):
        report = diagnose(_evidence(), None)
        assert report["findings"] == []
        assert report["elementFindings"] == []

    def test_schema_version_present(self):
        report = diagnose(_evidence(), None)
        assert report["schemaVersion"] == "1.0"


class TestInputRowDropped:
    def test_fires_when_skips_positive(self):
        report = diagnose(_evidence(caseFacts={"substantiveSkips": 7}), None)
        found = _codes(report["findings"], "INPUT_ROW_DROPPED")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_CONFIRMED
        assert "7" in found[0]["message"]
        assert "CSV_Parse_Skips.csv" in found[0]["hint"]

    def test_does_not_fire_when_zero(self):
        report = diagnose(_evidence(caseFacts={"substantiveSkips": 0}), None)
        assert _codes(report["findings"], "INPUT_ROW_DROPPED") == []


class TestLoadNotApplied:
    def test_fires_when_mf_input_present_but_no_force(self):
        report = diagnose(
            _evidence(caseFacts={"mfInputCount": 8, "forceLoadCount": 0}), None,
        )
        found = _codes(report["findings"], "LOAD_NOT_APPLIED")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_CONFIRMED
        assert "8" in found[0]["message"]

    def test_does_not_fire_when_force_present(self):
        report = diagnose(
            _evidence(caseFacts={"mfInputCount": 8, "forceLoadCount": 10}), None,
        )
        assert _codes(report["findings"], "LOAD_NOT_APPLIED") == []


class TestLoadNoneMf:
    def test_fires_when_mf_input_zero(self):
        report = diagnose(_evidence(caseFacts={"mfInputCount": 0}), None)
        confirmed = [f for f in _codes(report["findings"], "LOAD_NONE")
                     if f["confidence"] == CONFIDENCE_CONFIRMED]
        assert len(confirmed) == 1
        assert "MF" in confirmed[0]["message"]

    def test_does_not_fire_when_mf_input_present(self):
        report = diagnose(_evidence(caseFacts={"mfInputCount": 8}), None)
        confirmed = [f for f in _codes(report["findings"], "LOAD_NONE")
                     if f["confidence"] == CONFIDENCE_CONFIRMED]
        assert confirmed == []


class TestLoadNoneWinch:
    def test_fires_when_winch_input_zero(self):
        report = diagnose(_evidence(caseFacts={"winchInputCount": 0}), None)
        ref = [f for f in _codes(report["findings"], "LOAD_NONE")
               if f["confidence"] == CONFIDENCE_REFERENCE]
        assert len(ref) == 1
        assert "Winch" in ref[0]["message"]

    def test_does_not_fire_when_winch_input_present(self):
        report = diagnose(_evidence(caseFacts={"winchInputCount": 2}), None)
        ref = [f for f in _codes(report["findings"], "LOAD_NONE")
               if f["confidence"] == CONFIDENCE_REFERENCE]
        assert ref == []


class TestModelUntraced:
    def test_fires_when_fewer_elements_have_origin(self):
        report = diagnose(
            _evidence(meta={"elementCount": 10, "elementsWithOrigin": 7}), None,
        )
        found = _codes(report["findings"], "MODEL_UNTRACED")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_LIKELY
        assert "3" in found[0]["message"]

    def test_does_not_fire_when_all_traced(self):
        report = diagnose(
            _evidence(meta={"elementCount": 10, "elementsWithOrigin": 10}), None,
        )
        assert _codes(report["findings"], "MODEL_UNTRACED") == []


class TestEquilibriumFail:
    def test_fires_when_failed_flag_set(self):
        report = diagnose(_evidence(), None, equilibrium=_equilibrium(failed=True, worstRelResidual=0.05))
        found = _codes(report["findings"], "EQUILIBRIUM_FAIL")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_CONFIRMED
        assert "5.0" in found[0]["message"]

    def test_fires_when_residual_exceeds_fail_tolerance_even_if_not_flagged(self):
        report = diagnose(
            _evidence(), None,
            equilibrium=_equilibrium(failed=False, worstRelResidual=0.02, relTolFail=0.01),
        )
        assert len(_codes(report["findings"], "EQUILIBRIUM_FAIL")) == 1

    def test_does_not_fire_when_within_tolerance(self):
        report = diagnose(
            _evidence(), None,
            equilibrium=_equilibrium(failed=False, worstRelResidual=1.66e-7),
        )
        assert _codes(report["findings"], "EQUILIBRIUM_FAIL") == []

    def test_skipped_when_equilibrium_none(self):
        report = diagnose(_evidence(), None, equilibrium=None)
        assert _codes(report["findings"], "EQUILIBRIUM_FAIL") == []
        assert _codes(report["findings"], "EQUILIBRIUM_WARN") == []


class TestEquilibriumWarn:
    def test_fires_when_warned_and_not_failed(self):
        report = diagnose(
            _evidence(), None,
            equilibrium=_equilibrium(warned=True, failed=False, worstRelResidual=0.002, relTolWarn=0.001),
        )
        found = _codes(report["findings"], "EQUILIBRIUM_WARN")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_REFERENCE
        assert "0.200" in found[0]["message"]  # 0.002 * 100 = 0.200%

    def test_does_not_fire_when_failed_wins(self):
        """failed 가 함께 서면 FAIL 로 흡수되고 WARN 은 별도로 뜨지 않는다."""
        report = diagnose(
            _evidence(), None,
            equilibrium=_equilibrium(warned=True, failed=True, worstRelResidual=0.05),
        )
        assert _codes(report["findings"], "EQUILIBRIUM_WARN") == []

    def test_does_not_fire_when_not_warned(self):
        report = diagnose(_evidence(), None, equilibrium=_equilibrium(warned=False))
        assert _codes(report["findings"], "EQUILIBRIUM_WARN") == []


class TestSolverUnstable:
    def test_fires_on_mechanism(self):
        report = diagnose(_evidence(), None, f06={"mechanism": True})
        found = _codes(report["findings"], "SOLVER_UNSTABLE")
        assert any(f["confidence"] == CONFIDENCE_CONFIRMED for f in found)
        assert any("메커니즘" in f["message"] for f in found)

    def test_fires_on_high_maxratio(self):
        report = diagnose(_evidence(), None, f06={"maxRatio": 2.5e6})
        found = [f for f in _codes(report["findings"], "SOLVER_UNSTABLE")
                 if f["confidence"] == CONFIDENCE_LIKELY]
        assert len(found) == 1
        assert "2.5e+06" in found[0]["message"]

    def test_does_not_fire_on_healthy_maxratio(self):
        report = diagnose(_evidence(), None, f06={"maxRatio": 900.0, "mechanism": False})
        assert _codes(report["findings"], "SOLVER_UNSTABLE") == []

    def test_skipped_when_f06_none(self):
        report = diagnose(_evidence(), None, f06=None)
        assert _codes(report["findings"], "SOLVER_UNSTABLE") == []


# ══════════════════════════════════════════════════════════════
# Task 13 — 부재 단위 규칙 + 우선순위
# ══════════════════════════════════════════════════════════════

class TestFakeLoadPath:
    def test_fabricated_element_is_flagged(self):
        ev = _evidence(elements=[_element_evidence(
            kind="fabricated",
            origin={"kind": "fabricated", "stage": "04_Connectivity", "operation": "ExtendToBBoxIntersect"},
        )])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        found = _codes(report["elementFindings"], "FAKE_LOAD_PATH")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_CONFIRMED
        assert "04_Connectivity" in found[0]["message"]
        assert "ExtendToBBoxIntersect" in found[0]["message"]
        assert found[0]["primary"] is True

    def test_fake_load_path_wins_primary_over_weak_section(self):
        """가짜 부재이면서 단면도 약할 때 주원인은 여전히 FAKE_LOAD_PATH — 우선순위의 핵심."""
        # 비교군: 같은 I 타입 3개 이상, 이 부재만 극단적으로 약함.
        peers = [
            _element_evidence(element_id=1, section={"propertyId": 1, "iWeakMm4": 1.0e7}),
            _element_evidence(element_id=2, section={"propertyId": 2, "iWeakMm4": 1.2e7}),
            _element_evidence(element_id=3, section={"propertyId": 3, "iWeakMm4": 1.3e7}),
        ]
        weak_fake = _element_evidence(
            element_id=99, kind="fabricated",
            origin={"kind": "fabricated", "stage": "04_Connectivity", "operation": "ExtendToBBoxIntersect"},
            section={"propertyId": 99, "iWeakMm4": 1.0e6},
            boundary={"spcHops": 10, "spcSource": "FreeEnd"},
            loadPath={"hops": 8},
        )
        ev = _evidence(elements=peers + [weak_fake])
        res = _result([_result_element(element_id=99, ok=False, nx=10.0, my=300.0, mz=10.0)])
        report = diagnose(ev, res)

        codes_present = _codes(report["elementFindings"])
        assert "FAKE_LOAD_PATH" in codes_present
        assert "SECTION_WEAK" in codes_present

        primaries = [f for f in report["elementFindings"] if f["primary"]]
        assert len(primaries) == 1
        assert primaries[0]["code"] == "FAKE_LOAD_PATH"


class TestBoundaryArtifact:
    def test_free_end_spc_within_one_hop_is_flagged(self):
        ev = _evidence(elements=[_element_evidence(
            boundary={"spcHops": 1, "spcSource": "FreeEnd"},
            loadPath={"hops": 8},  # LOAD_PROXIMITY 규칙과 섞이지 않게 멀리 둔다
        )])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        found = _codes(report["elementFindings"], "BOUNDARY_ARTIFACT")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_CONFIRMED
        assert "1" in found[0]["message"]
        assert found[0]["primary"] is True

    def test_far_free_end_spc_is_not_flagged(self):
        ev = _evidence(elements=[_element_evidence(
            boundary={"spcHops": 10, "spcSource": "FreeEnd"}, loadPath={"hops": 8},
        )])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "BOUNDARY_ARTIFACT") == []

    def test_non_free_end_spc_is_not_flagged(self):
        ev = _evidence(elements=[_element_evidence(
            boundary={"spcHops": 1, "spcSource": "NormalSpc"}, loadPath={"hops": 8},
        )])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "BOUNDARY_ARTIFACT") == []


class TestLoadProximity:
    def test_hops_within_threshold_is_flagged(self):
        ev = _evidence(elements=[_element_evidence(
            loadPath={"hops": 2}, boundary={"spcHops": 10, "spcSource": "FreeEnd"},
        )])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        found = _codes(report["elementFindings"], "LOAD_PROXIMITY")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_LIKELY
        assert "2" in found[0]["message"]
        assert found[0]["primary"] is True

    def test_hops_beyond_threshold_is_not_flagged(self):
        ev = _evidence(elements=[_element_evidence(
            loadPath={"hops": 5}, boundary={"spcHops": 10, "spcSource": "FreeEnd"},
        )])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "LOAD_PROXIMITY") == []

    def test_unreachable_hops_is_not_flagged(self):
        ev = _evidence(elements=[_element_evidence(loadPath={"hops": -1})])
        res = _result([_result_element(ok=False)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "LOAD_PROXIMITY") == []


class TestSectionWeak:
    def _peer_group(self, weak_i_weak=1.0e6):
        # 비교군 = 같은 "I" 타입 부재 전체(대상 자신도 포함) — 동일 iWeakMm4=1.0e7 인 peer 3개.
        # 대상 포함 4개 중 중앙값은 두 middle 값의 평균이 되도록 peer 를 모두 같은 값으로 둔다:
        #   sorted([weak, 1e7, 1e7, 1e7]) → median = (1e7+1e7)/2 = 1.0e7 (= 10,000,000)
        peers = [
            _element_evidence(element_id=1, section={"propertyId": 1, "iWeakMm4": 1.0e7}),
            _element_evidence(element_id=2, section={"propertyId": 2, "iWeakMm4": 1.0e7}),
            _element_evidence(element_id=3, section={"propertyId": 3, "iWeakMm4": 1.0e7}),
        ]
        target = _element_evidence(
            element_id=99, section={"propertyId": 99, "iWeakMm4": weak_i_weak},
            loadPath={"hops": 8}, boundary={"spcHops": 10, "spcSource": "FreeEnd"},
        )
        return peers, target

    def test_fires_when_far_below_median_and_bending_dominant(self):
        peers, target = self._peer_group(weak_i_weak=1.0e6)  # 중앙값 1.0e7 의 1/3(≈3.33e6) 이하
        ev = _evidence(elements=peers + [target])
        res = _result([_result_element(element_id=99, ok=False, nx=10.0, my=300.0, mz=10.0)])
        report = diagnose(ev, res)

        found = _codes(report["elementFindings"], "SECTION_WEAK")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_LIKELY
        assert found[0]["primary"] is True
        msg = found[0]["message"]
        # 자기 값(1,000,000)과 비교군 중앙값(10,000,000) 이 실제로 문장에 들어가는가.
        assert "1,000,000" in msg
        assert "10,000,000" in msg
        assert "단면 상향" in found[0]["hint"]

    def test_does_not_fire_when_above_ratio_threshold(self):
        peers, target = self._peer_group(weak_i_weak=1.0e7)  # 중앙값과 동일 — 약하지 않음
        ev = _evidence(elements=peers + [target])
        res = _result([_result_element(element_id=99, ok=False, nx=10.0, my=300.0, mz=10.0)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "SECTION_WEAK") == []

    def test_does_not_fire_when_peer_group_too_small(self):
        # 대상 자신을 포함해도 같은 "I" 타입 전체가 2개뿐 (SECTION_PEER_MIN=3 미만).
        peers = [
            _element_evidence(element_id=1, section={"propertyId": 1, "iWeakMm4": 1.0e7}),
        ]
        target = _element_evidence(
            element_id=99, section={"propertyId": 99, "iWeakMm4": 1.0e6},
            loadPath={"hops": 8}, boundary={"spcHops": 10, "spcSource": "FreeEnd"},
        )
        assert len(peers) + 1 < SECTION_PEER_MIN
        ev = _evidence(elements=peers + [target])
        res = _result([_result_element(element_id=99, ok=False, nx=10.0, my=300.0, mz=10.0)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "SECTION_WEAK") == []

    def test_does_not_fire_when_axial_dominant_not_bending(self):
        """약축이 부실해도 굽힘이 지배하지 않으면(축력 지배) 무의미한 판정이라 건너뛴다."""
        peers, target = self._peer_group(weak_i_weak=1.0e6)
        ev = _evidence(elements=peers + [target])
        res = _result([_result_element(element_id=99, ok=False, nx=1000.0, my=1.0, mz=1.0)])
        report = diagnose(ev, res)
        assert _codes(report["elementFindings"], "SECTION_WEAK") == []


class TestNoSpecificCause:
    def test_no_rule_matches_falls_back_to_no_specific_cause(self):
        ev = _evidence(elements=[_element_evidence(
            loadPath={"hops": 8}, boundary={"spcHops": 10, "spcSource": "FreeEnd"},
        )])
        res = _result([_result_element(ok=False, usage=1.05)])
        report = diagnose(ev, res)
        found = _codes(report["elementFindings"], "NO_SPECIFIC_CAUSE")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_REFERENCE
        assert found[0]["primary"] is True
        assert "1.05" in found[0]["message"]


class TestPassingElementsSkipped:
    def test_ok_elements_are_not_diagnosed(self):
        ev = _evidence(elements=[_element_evidence()])
        res = _result([_result_element(ok=True)])
        report = diagnose(ev, res)
        assert report["elementFindings"] == []


class TestUserAdded:
    def test_element_missing_from_evidence_is_flagged(self):
        ev = _evidence(elements=[])  # 증거에 없음
        res = _result([_result_element(element_id=555, ok=False)])
        report = diagnose(ev, res)
        found = _codes(report["elementFindings"], "USER_ADDED")
        assert len(found) == 1
        assert found[0]["confidence"] == CONFIDENCE_CONFIRMED
        assert found[0]["primary"] is True


class TestNoResultYet:
    def test_none_result_yields_empty_element_findings(self):
        ev = _evidence(elements=[_element_evidence()])
        report = diagnose(ev, None)
        assert report["elementFindings"] == []
        # 케이스 단위 규칙은 그대로 평가된다.
        assert isinstance(report["findings"], list)
