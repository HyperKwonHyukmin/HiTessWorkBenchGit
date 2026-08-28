"""openpyxl MergedCell 쓰기 안전 shim.

병합영역의 비-앵커 셀(`MergedCell`)에 값을 쓰면 openpyxl 이
    AttributeError: 'MergedCell' object attribute 'value' is read-only
로 죽는다. 엔진의 보고서 생성기(`FuelLine_PSA_Report.make_report`)는 셀 '범위'를 훑으며
초기화/기입하므로 병합 헤더를 스치는 순간 보고서 생성이 통째로 실패한다.

MergedCell 은 `__slots__ = ('row', 'column')` + 클래스 속성 `value = None` 구조라
인스턴스 대입이 막혀 있다. 클래스에 데이터 디스크립터(property)를 얹으면 대입이 세터로
흘러가므로, 세터를 no-op 으로 두어 조용히 무시하게 한다.

(엔진 FuelLine_PSA_Report.py 에 직접 넣어 두었던 `_set_cell()` + 호출부 5곳 개조를 대체한다.)
"""

_installed = False


def install():
    global _installed
    if _installed:
        return
    from openpyxl.cell.cell import MergedCell

    if getattr(MergedCell, "_hitess_merged_shim", False):
        _installed = True
        return

    def _get(self):
        # 원래 거동: MergedCell 의 값은 항상 None.
        return None

    def _set(self, value):
        # 병합 비앵커 셀 쓰기는 무시한다(크래시 방지).
        return None

    MergedCell.value = property(_get, _set)
    MergedCell._hitess_merged_shim = True
    _installed = True
