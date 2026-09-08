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
