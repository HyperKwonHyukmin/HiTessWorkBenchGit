"""Tier-2 — shim 으로 뚫을 수 없는 엔진 로직 fix 의 선언적 목록.

원칙:
  * 연구원 원본 폴더는 **절대** 수정하지 않는다. `prep.py` 가 만든 빌드 스테이징 사본에만 적용한다.
  * 앵커가 기대한 횟수만큼 매치되지 않으면 **빌드를 중단**한다. 조용한 통과는 없다.
  * 이미 치환된 형태(`replace`)가 발견되면 idempotent 로 통과시킨다
    (연구원이 upstream 에 반영한 경우 — 그때는 이 항목을 지우면 된다).

여기에 항목이 늘어나면 그만큼 엔진과 결합이 강해진다는 뜻이다. 새 항목을 넣기 전에
"shim 으로 못 하나?"를 먼저 검토할 것.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Patch:
    file: str        # 엔진 폴더 기준 상대 경로
    why: str         # 왜 필요한가 (실패 메시지에 그대로 노출된다)
    anchor: str      # 찾을 문자열 (정규식 아님 — 정확 일치)
    replace: str     # 바꿀 문자열
    expect: int = 1  # 기대 매치 횟수


PATCHES = (
    Patch(
        file="FuelLine_PSA_Report.py",
        why=(
            "Summary-2 결과표 초기화가 앞 restraint 루프의 지역변수 idx 를 재사용한다. "
            "OPE(L1~L16)를 하나도 선택하지 않은 실행에서는 그 루프가 돌지 않아 idx 가 정의되지 "
            "않고 UnboundLocalError 로 보고서 생성이 통째로 실패한다. 데이터 시작행 16 으로 고정한다."
        ),
        anchor="for row in sheet_ope[max_node_cell+str(idx) : max_dzm_cell + str(idx+999)]:",
        replace='for row in sheet_ope[max_node_cell + "16" : max_dzm_cell + "1015"]:',
        expect=1,
    ),
)


class PatchError(RuntimeError):
    """앵커 불일치 등 — 사람이 판단해야 하는 상황."""


def apply_to_text(text, patch):
    """patch 를 text 에 적용한 결과와 상태를 돌려준다.

    반환: (새 텍스트, 상태) — 상태는 'applied' | 'already'
    앵커가 expect 회 매치되지 않고 치환 결과도 없으면 PatchError.
    """
    found = text.count(patch.anchor)
    if found == patch.expect:
        return text.replace(patch.anchor, patch.replace), "applied"

    already = text.count(patch.replace)
    if found == 0 and already >= 1:
        return text, "already"

    raise PatchError(
        f"[패치 실패] {patch.file}\n"
        f"  이유: {patch.why}\n"
        f"  앵커 매치 {found}회 (기대 {patch.expect}회), 치환본 매치 {already}회.\n"
        f"  앵커: {patch.anchor}\n"
        f"  → 연구원이 이 부분을 바꿨습니다. 새 엔진 소스를 열어 patches.py 를 갱신하거나, "
        f"수정이 이미 반영됐다면 이 항목을 제거하세요."
    )
