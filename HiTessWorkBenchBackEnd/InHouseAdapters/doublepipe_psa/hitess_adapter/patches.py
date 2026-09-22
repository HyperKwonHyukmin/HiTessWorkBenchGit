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
    Patch(
        file="FuelLine_F06Format.py",
        why=(
            "부분 LC 실행 시 unrun LC 의 *_displacement.txt 가 없어 open() 이 FileNotFoundError 를 "
            "던지고 exe 가 returncode 1 로 종료(백엔드는 '해석 실패' 로 판정). 과거 버전에는 "
            "os.path.exists 가드가 있었으나 최신 엔진에서 회귀됐다. 없는 파일은 건너뛴다."
        ),
        anchor=(
            "        # Displacement 파일 처리\n"
            "        for i, file in enumerate(file_displacement):\n"
            "            self.write_displacement(file, i)"
        ),
        replace=(
            "        # Displacement 파일 처리 (부분 해석 시 없는 파일은 건너뜀)\n"
            "        for i, file in enumerate(file_displacement):\n"
            "            if os.path.exists(file):\n"
            "                self.write_displacement(file, i)"
        ),
        expect=1,
    ),
    Patch(
        file="FuelLine_F06Format.py",
        why=(
            "부분 LC 실행 시 unrun LC 의 *_stress.txt 가 없어 open() 이 FileNotFoundError 를 던진다. "
            "displacement 가드와 짝을 이루는 stress 가드 — 없는 파일은 건너뛴다."
        ),
        anchor=(
            "        # Stress 파일 처리\n"
            "        for i, file in enumerate(file_stress):\n"
            "            self.write_stress(file, i)"
        ),
        replace=(
            "        # Stress 파일 처리 (부분 해석 시 없는 파일은 건너뜀)\n"
            "        for i, file in enumerate(file_stress):\n"
            "            if os.path.exists(file):\n"
            "                self.write_stress(file, i)"
        ),
        expect=1,
    ),
    Patch(
        file="FuelLine_PSA_Report.py",
        why=(
            "부분 LC 실행 지원을 위해 (a) BadZipFile 임포트 (b) 모든 LC/Summary 결과 셀을 프레임 "
            "보존하며 비우는 _clear_all_results 헬퍼가 필요하다. 최신 엔진에서 통째로 회귀됐다."
        ),
        anchor=(
            "import os\n"
            "import math\n"
            "import openpyxl\n"
            "from openpyxl.styles import Font, Border, Side, Alignment\n"
            "\n"
            "def make_report():"
        ),
        replace=(
            "import os\n"
            "import math\n"
            "import openpyxl\n"
            "from openpyxl.styles import Font, Border, Side, Alignment\n"
            "from zipfile import BadZipFile\n"
            "\n"
            "\n"
            "def _clear_all_results(wb):\n"
            "    \"\"\"모든 LoadCase 시트(L1~L29)와 Summary 의 '결과 값' 셀만 비운다.\n"
            "       프레임/서식/정적 라벨/헤더는 그대로 유지된다.\n"
            "       → 이후 fill 단계가 '결과 txt 가 존재하는' LoadCase 만 채우므로,\n"
            "         사용자가 요청하지 않은 LoadCase 시트와 Summary 행은 비어 있게 된다.\"\"\"\n"
            "    def clear(ws, rng):\n"
            "        for row in ws[rng]:\n"
            "            for c in row:\n"
            "                c.value = None\n"
            "\n"
            "    # Summary-1: 결과 값 열(E=Stress, G=Allowable, I=Ratio, J=Check) 44~56행(L17~L29)\n"
            "    if 'Summary-1' in wb.sheetnames:\n"
            "        s = wb['Summary-1']\n"
            "        for r in range(44, 57):\n"
            "            for col in ('E', 'G', 'I', 'J'):\n"
            "                s[col + str(r)].value = None\n"
            "    # Summary-2: 결과표(16행 이하). 헤더는 그 위에 있으므로 보존됨.\n"
            "    if 'Summary-2' in wb.sheetnames:\n"
            "        clear(wb['Summary-2'], 'B16:N400')\n"
            "    # LoadCase 시트\n"
            "    for i in range(1, 30):\n"
            "        nm = 'L' + str(i)\n"
            "        if nm not in wb.sheetnames:\n"
            "            continue\n"
            "        ws = wb[nm]\n"
            "        if i <= 16:\n"
            "            # OPE(L1~L16): restraint/flex 표(데이터 행9~). 헤더 행8은 보존.\n"
            "            clear(ws, 'B9:N2000')\n"
            "        else:\n"
            "            # SUS/OCC/EXP(L17~L29): Highest(D7~D13 값) + stress 표(데이터 행18~). 헤더 행17 보존.\n"
            "            for r in range(7, 14):\n"
            "                ws['D' + str(r)].value = None\n"
            "            clear(ws, 'B18:L2000')\n"
            "\n"
            "\n"
            "def make_report():"
        ),
        expect=1,
    ),
    Patch(
        file="FuelLine_PSA_Report.py",
        why=(
            "부분 LC 실행 시 서식 로드 실패에 대비한 try/except 폴백 + _clear_all_results 호출. "
            "이 두 개가 있어야 이어지는 fill 단계가 '결과 있는 LC 만' 채우고 나머지는 프레임만 남긴다."
        ),
        anchor=(
            "    # 엑셀 작업 시작\n"
            "    if os.path.exists(excel_file_path):\n"
            "        wb = openpyxl.load_workbook(excel_file_path) # 기존 엑셀 파일을 열거나 새로 생성\n"
            "    else:\n"
            "        wb = openpyxl.Workbook()\n"
            "\n"
            "    # 원하는 sheet 열기 (없으면 생성)"
        ),
        replace=(
            "    # 엑셀 작업 시작 — 폴더의 기존 \"Report for PSA.xlsx\"(서식 템플릿)를 '제자리'에서 연다.\n"
            "    # 사내 DRM 환경 호환: 파일을 복사하면 DRM 컨테이너가 풀리지 않아 손상되므로\n"
            "    # 복사/번들 없이 원본을 직접 로드한다. 손상/부재 시에는 빈 워크북으로 대체(크래시 방지).\n"
            "    try:\n"
            "        if os.path.exists(excel_file_path):\n"
            "            wb = openpyxl.load_workbook(excel_file_path)\n"
            "        else:\n"
            "            wb = openpyxl.Workbook()\n"
            "    except (BadZipFile, OSError, KeyError):\n"
            "        print(\"[경고] 'Report for PSA.xlsx'를 열 수 없어 빈 워크북으로 작성합니다(서식 미적용).\")\n"
            "        wb = openpyxl.Workbook()\n"
            "\n"
            "    # 채우기 전, 모든 LoadCase/Summary 결과 값을 비운다(프레임/서식 유지).\n"
            "    # → 선택한 LoadCase 만 이후 단계에서 다시 채워지고, 나머지는 빈 상태로 유지된다.\n"
            "    _clear_all_results(wb)\n"
            "\n"
            "    # 원하는 sheet 열기 (없으면 생성)"
        ),
        expect=1,
    ),
    Patch(
        file="FuelLine_PSA_Report.py",
        why=(
            "Summary-1 의 idx 를 '루프 순번'에서 'StressFile 리스트 내 위치'로 바꾼다. "
            "부분 LC 실행 시 순번 기반이면 L17만 채워야 할 행 44 옆 45번째 행에 L24 결과가 들어가는 "
            "행 밀림 버그가 발생한다. StressFile.index(key) 로 각 LC 를 항상 자신의 고정 행에 쓴다."
        ),
        anchor=(
            "    # 데이터 확인\n"
            "    idx = 44\n"
            "    for key, content in data_contents.items(): # StressFile\n"
            "        # print(f\"=== {key}.txt 내용 ===\")\n"
            "        # print(content)"
        ),
        replace=(
            "    # 데이터 확인 — 각 StressFile 을 '고정 행'(44 + StressFile 내 위치)에 기입한다.\n"
            "    # 존재하는 파일만 채워지므로, 부분 해석 시에도 Summary 행이 어긋나지 않는다.\n"
            "    for key, content in data_contents.items(): # StressFile\n"
            "        idx = 44 + StressFile.index(key)\n"
            "        # print(f\"=== {key}.txt 내용 ===\")\n"
            "        # print(content)"
        ),
        expect=1,
    ),
    Patch(
        file="FuelLine_PSA_Report.py",
        why=(
            "위 idx 위치기반 계산과 짝. 루프 마지막의 idx += 1 은 순번 기반 잔재이며 위치기반 "
            "방식에서는 오히려 다음 반복의 idx 를 오염시키므로 제거한다."
        ),
        anchor=(
            "        if ratio > 100.0:\n"
            "            cell_01 = sheet[check_cell + str(idx)]\n"
            "            cell_01.value = \"Not OK\"\n"
            "            cell_01.font = Font(color=\"FF0000\")\n"
            "        idx += 1"
        ),
        replace=(
            "        if ratio > 100.0:\n"
            "            cell_01 = sheet[check_cell + str(idx)]\n"
            "            cell_01.value = \"Not OK\"\n"
            "            cell_01.font = Font(color=\"FF0000\")\n"
            "        # idx 는 StressFile 위치로 매 반복 산출되므로 증가시키지 않는다."
        ),
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
