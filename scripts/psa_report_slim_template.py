"""PSA 보고서 서식을 가볍게 만든다(한 번만 실행).

원본 = 사내 R2 보고서(Word). 6장에는 3441 해석 값 8,500줄이 들어 있는데 생성기는 그 값을 쓰지 않고
첫 Line 절을 '견본'으로만 쓴다. 그대로 두면 보고서를 만들 때마다 그 줄을 지우느라 25초쯤 걸린다.
그래서 6장은 첫 절만 남기고, 표는 머리 줄 + 한 줄만 남긴 파일을 서식으로 둔다.

사용:  python scripts/psa_report_slim_template.py <원본 R2 docx> [<결과 .bin>]
       결과 기본값 = HiTessWorkBenchBackEnd/app/templates/psa_report/report_template.bin
주의:  원본 docx 는 회사 DRM 에 감싸지지 않은 평문이어야 한다(UNC 'UnLock' 폴더의 사본).
       결과 확장자는 .bin(.docx 로 두면 DRM 이 다시 감싼다).
"""
from __future__ import annotations

import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(HERE), "HiTessWorkBenchBackEnd")
sys.path.insert(0, BACKEND)

from docx import Document  # noqa: E402

from app.services import psa_report_docops as ops  # noqa: E402
from app.services.psa_report_docx import _Proto, _stress_sections  # noqa: E402


def slim(src_bytes: bytes) -> bytes:
    if not src_bytes.startswith(b"PK"):
        raise SystemExit("원본이 docx(zip)가 아닙니다. 회사 DRM 에 감싸진 파일이면 UNC 'UnLock' 폴더의 평문 사본을 쓰세요.")
    doc = Document(io.BytesIO(src_bytes))
    sections = _stress_sections(doc)
    if not sections:
        raise SystemExit("6장(STRESS ANALYSIS)의 Line 절을 찾지 못했습니다.")
    proto = _Proto(sections[0]["elements"])
    if not proto.ok():
        raise SystemExit("6장 첫 절의 구성이 예상과 다릅니다(제목, 그림, 표 2개, 문장).")
    ops.trim_table(proto.tables[0], 3)  # 최대 반력: 머리 2줄 + 1줄
    ops.trim_table(proto.tables[1], 2)  # 응력 요약: 머리 1줄 + 1줄
    removed = 0
    for sec in sections[1:]:
        for el in sec["elements"]:
            if ops.tag_of(el) == "p" and ops.has_sectpr(el):  # 구역 나눔 문단은 남긴다
                for child in list(el):
                    if ops.tag_of(child) != "pPr":
                        el.remove(child)
                continue
            el.getparent().remove(el)
            removed += 1
    out = io.BytesIO()
    doc.save(out)
    print(f"6장 절 {len(sections)}개 중 첫 절만 남김, 요소 {removed}개 삭제")
    return out.getvalue()


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BACKEND, "app", "templates", "psa_report", "report_template.bin")
    with open(src, "rb") as f:
        data = f.read()
    result = slim(data)
    with open(dst, "wb") as f:
        f.write(result)
    print(f"{len(data):,} → {len(result):,} 바이트: {dst}")


if __name__ == "__main__":
    main()
