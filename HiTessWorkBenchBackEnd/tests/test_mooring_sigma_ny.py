"""recompute_sigma_ny() — 판정 정응력은 '축력 + 강축(연직면) 굽힘' 하나로 한다.

DNV 3D Beam(Nauticus Hull)의 Sig-Ny 를 그대로 옮긴 것이다. 다만 두 문서의 국부축
규약이 정반대라 성분 이름이 바뀐다:

    DNV 3D Beam : local z = up = 웹 방향  →  My 가 강축 → Sig-Ny = Nx + My
    NASTRAN     : local y = up = 웹 방향  →  Mz 가 강축 → 판정값 = |σNx + σMz|

근거: 3D Beam User Manual p.16/17/83/99 + AxisTest.bdf/f06 실측(BeamAxisConventionTests).

이름이 같다는 이유로 NASTRAN 의 My(약축)에 대응시킨 것이 종전 오류였다. 그 결과 실제
파괴 모드인 상하 굽힘이 판정에서 빠져 전 부재 Pass 가 나왔다.

보고서(ReportStressEvaluator)와 같은 기준이어야 화면과 보고서의 Usage 가 일치한다.
"""
import pytest

from app.services.mooring_fitting_service import recompute_sigma_ny


def _payload(**elem):
    base = {"nx": 0, "my": 0, "mz": 0, "mx": 0, "qy": 0, "qz": 0}
    base.update(elem)
    return {"yieldStress": 315.0, "gammaM": 1.0,
            "cases": [{"subcaseId": 1, "loadSetId": 1001, "elements": [dict(base, id=1)]}]}


def test_uses_exe_supplied_sigma_n_strong():
    """exe 가 sigmaNStrong 을 실어 보내면 그 값을 그대로 쓴다(최악 station 선정 결과)."""
    p = recompute_sigma_ny(_payload(sigmaNStrong=157.5, nx=10, mz=20, my=999))
    e = p["cases"][0]["elements"][0]
    assert e["sigmaN"] == 157.5
    assert e["usage"] == 0.5           # 157.5 / 315


def test_falls_back_to_nx_plus_mz_for_old_results():
    """구버전 결과 JSON 에는 sigmaNStrong 이 없다 — 성분에서 σNx+σMz 로 되계산한다."""
    p = recompute_sigma_ny(_payload(nx=100, mz=-40, my=300))
    e = p["cases"][0]["elements"][0]
    assert e["sigmaN"] == 60.0         # |100 + (-40)|, my(약축) 는 무시
    assert e["usage"] == round(60 / 315, 4)


def test_weak_axis_bending_never_governs():
    """약축 굽힘(σMy)이 아무리 커도 판정에 들어가지 않는다 — 표에는 그대로 실린다.

    상판 판구조를 1D 보로 이상화하며 생긴 값이라 실제 파괴 모드가 아니다.
    """
    small = recompute_sigma_ny(_payload(nx=10, mz=10, my=0))
    huge = recompute_sigma_ny(_payload(nx=10, mz=10, my=10_000))
    assert (small["cases"][0]["elements"][0]["usage"]
            == huge["cases"][0]["elements"][0]["usage"])


def _member(sigma, tau=0.0, yield_mpa=235.0, grade="A", known=True):
    return {
        "yieldStress": 315.0, "gammaM": 1.0,
        "cases": [{"subcaseId": 1, "loadSetId": 1001, "elements": [{
            "id": 1, "nx": 0, "my": 0, "mz": 0, "mx": 0, "qy": tau, "qz": 0,
            "sigmaNStrong": sigma, "yieldMPa": yield_mpa, "grade": grade, "gradeKnown": known,
        }]}],
    }


@pytest.mark.parametrize("sigma,tau,yield_mpa,expected", [
    (200, 0, 235, "OK"),
    (235, 0, 235, "OK"),                 # 정확히 한계면 통과
    (250, 0, 235, "MATERIAL_CHANGE"),    # mild 가 315 기준이면 만족
    (315, 0, 235, "MATERIAL_CHANGE"),
    (316, 0, 235, "NOT_OK"),
    (0, 150, 235, "MATERIAL_CHANGE"),    # 전단 허용 141 초과, 189 이내
    (0, 190, 235, "NOT_OK"),
    (320, 0, 315, "NOT_OK"),             # 315 -> 355 변경은 NOT OK (사용자 결정)
    (320, 0, 355, "OK"),
])
def test_member_verdict_matches_engine_rule(sigma, tau, yield_mpa, expected):
    """엔진 SteelGrade.Judge(MemberMaterialTests.Judge_ThreeLevels)와 같은 표다."""
    p = recompute_sigma_ny(_member(sigma, tau, yield_mpa))
    assert p["cases"][0]["elements"][0]["verdict"] == expected


def test_usage_uses_members_own_yield_not_payload_default():
    e = recompute_sigma_ny(_member(235.0))["cases"][0]["elements"][0]
    assert e["usage"] == 1.0              # 315 일괄이면 0.746 이었다
    assert e["allowable"] == 235.0
    assert e["allowableShear"] == 141.0


def test_material_change_is_not_ok_overall_and_counted_per_member():
    p = recompute_sigma_ny(_member(250.0))
    assert p["cases"][0]["elements"][0]["ok"] is False
    assert p["ok"] is False
    assert p["verdictCounts"] == {"OK": 0, "MATERIAL_CHANGE": 1, "NOT_OK": 0}


def test_counts_use_worst_load_case_of_each_member():
    p = _member(100.0)
    p["cases"].append({"subcaseId": 2, "loadSetId": 1002, "elements": [
        dict(p["cases"][0]["elements"][0], sigmaNStrong=400.0)]})
    assert recompute_sigma_ny(p)["verdictCounts"] == {"OK": 0, "MATERIAL_CHANGE": 0, "NOT_OK": 1}


def test_unknown_grade_members_are_counted():
    p = recompute_sigma_ny(_member(10.0, grade="", known=False))
    assert p["unknownGradeCount"] == 1


def test_old_result_without_member_yield_uses_uniform_allowable():
    """재질표 이전 결과 - 예전처럼 일괄 항복강도로 평가하고 판정만 붙인다."""
    p = recompute_sigma_ny(_payload(sigmaNStrong=157.5))
    e = p["cases"][0]["elements"][0]
    assert e["usage"] == 0.5
    assert e["verdict"] == "OK"


def test_strong_axis_bending_does_govern():
    """반대로 강축 굽힘은 판정을 직접 움직인다 — 종전 기준이면 이 값이 무시됐다."""
    p = recompute_sigma_ny(_payload(nx=15, mz=300))
    e = p["cases"][0]["elements"][0]
    assert e["sigmaN"] == 315.0
    assert e["usage"] == 1.0
    assert e["ok"] is True             # 정확히 한계면 통과(≤ 1.0)


def test_shear_still_governs_when_larger():
    """전단은 여전히 판정 대상 — 허용은 0.6·(σy/γM)=189."""
    p = recompute_sigma_ny(_payload(sigmaNStrong=10, qy=189.0))
    e = p["cases"][0]["elements"][0]
    assert e["usageShear"] == 1.0
    assert e["usage"] == 1.0
    assert p["allowableShear"] == 189.0


def test_allowable_is_yield_over_gamma():
    """정응력 허용 = σy/γM. 0.8σy(252) 가 아니다.

    252 는 매뉴얼 p.101 의 룰 체크(Cs·ReH)에서 온 값인데, 그 체크는 선체거더 응력 σhg 가
    들어가는 PSM 검토라 계선의장품 기초에는 해당하지 않는다. 우리가 쓰는 σy/γM 은
    매뉴얼 p.100 Combined stresses 의 Usage = σeff/(σyield/γM) 이 근거다.
    """
    p = recompute_sigma_ny(_payload(sigmaNStrong=315.0))
    assert p["allowable"] == 315.0
    assert p["cases"][0]["elements"][0]["usage"] == 1.0
    assert p["cases"][0]["elements"][0]["ok"] is True


def test_per_fiber_grades_match_engine_rule():
    """면별 판정(2026-11-03): AH 보강재 + A 갑판. 하면 300 MPa 는 보강재 315 기준 OK(예전 규칙은 235 로 실패)."""
    from app.services.mooring_fitting_service import judge_member_fibers, recompute_sigma_ny
    assert judge_member_fibers(200, 300, 100, 235, 315, 1.0) == "OK"
    assert judge_member_fibers(250, 100, 0, 235, 315, 1.0) == "MATERIAL_CHANGE"
    assert judge_member_fibers(100, 320, 0, 235, 315, 1.0) == "NOT_OK"
    payload = {"yieldStress": 315, "gammaM": 1.0, "cases": [{"elements": [
        {"id": 1, "sigmaNStrong": 300, "sigmaNTop": -200, "sigmaNBottom": 300, "qy": 10,
         "yieldMPa": 315, "plateYieldMPa": 235},
        {"id": 2, "sigmaNStrong": 250, "sigmaNTop": 250, "sigmaNBottom": -100,
         "yieldMPa": 315, "plateYieldMPa": 235},
    ]}]}
    out = recompute_sigma_ny(payload)["cases"][0]["elements"]
    assert out[0]["verdict"] == "OK" and out[0]["governingFiber"] == "bottom" and out[0]["allowable"] == 315
    assert out[1]["verdict"] == "MATERIAL_CHANGE" and out[1]["governingFiber"] == "top" and out[1]["allowable"] == 235


def test_member_count_takes_worst_verdict_not_largest_usage():
    """면별 등급이 다르면 Usage 최대 LC 와 판정 최악 LC 가 다를 수 있다(커밋 전 리뷰 2026-11-03).

    A 갑판(235) + AH32 보강재(315):
      LC1 상면 280 → Usage 1.19, 갑판만 315 로 올리면 만족 → 재질 변경
      LC2 하면 340 → Usage 1.08, 보강재가 이미 315 → NOT OK
    부재 집계는 NOT OK 여야 한다(Usage 가 큰 LC1 을 따르면 '등급만 올리면 된다' 로 잘못 안내).
    """
    elem = {"id": 7, "qy": 0, "yieldMPa": 315, "plateYieldMPa": 235}
    payload = {"yieldStress": 315, "gammaM": 1.0, "cases": [
        {"subcaseId": 1, "elements": [dict(elem, sigmaNStrong=280, sigmaNTop=280, sigmaNBottom=0)]},
        {"subcaseId": 2, "elements": [dict(elem, sigmaNStrong=340, sigmaNTop=0, sigmaNBottom=340)]},
    ]}
    out = recompute_sigma_ny(payload)
    assert [c["elements"][0]["verdict"] for c in out["cases"]] == ["MATERIAL_CHANGE", "NOT_OK"]
    assert out["verdictCounts"] == {"OK": 0, "MATERIAL_CHANGE": 0, "NOT_OK": 1}
