"""
ModuleUnit_HiTESS.exe 래퍼 스크립트
--------------------------------------
사용법:
    ModuleUnit_HiTESS.exe <input_bdf> <output_bdf> <programName>

인수:
    input_bdf    : 입력 BDF 파일 경로
    output_bdf   : 출력 BDF 파일 경로 (_r.bdf)
    programName  : "ModuleUnit" 또는 "GroupUnit"

종료 코드:
    0  : 성공
    1  : 오류 (stderr에 상세 메시지)
"""

import sys
import traceback


def _inforget_mode(bdf_path: str):
    """BDF에서 $$Hydro/$$Goliat 마커를 파싱하여 해석 파라미터를 반환합니다."""
    ModulePoint_idx_list = []
    lifting_method = None

    with open(bdf_path, "r", encoding="utf8") as f:
        lines = f.readlines()

    for line_idx, line in enumerate(lines):
        if "$$Hydro" in line or "$$Goliat" in line:
            lifting_method = 0 if "$$Hydro" in line else 1
            ModulePoint_idx_list.append(line_idx + 1)
        if "$$------------------------------------------------------------------------------$" in line:
            ModulePoint_idx_list.append(line_idx)
            break

    if len(ModulePoint_idx_list) < 2:
        raise ValueError(
            "BDF 분석 실패: '$$Hydro' 또는 '$$Goliat' 시작/종료 마커를 찾지 못했습니다."
        )

    ModuleInfo_text = lines[ModulePoint_idx_list[0]:ModulePoint_idx_list[1]]
    ModuleInfo_dict = {}
    lineLength_list = []

    for line in ModuleInfo_text:
        clean_item = line.replace("$$", "").strip()
        parts = clean_item.split()
        if len(parts) < 3:
            continue
        try:
            category = int(parts[0].split("-")[0])
            val1 = int(parts[1])
            val2 = int(parts[2])
            if category not in ModuleInfo_dict:
                ModuleInfo_dict[category] = [val1]
                lineLength_list.append(val2)
            else:
                ModuleInfo_dict[category].append(val1)
        except ValueError:
            continue

    ModuleInfo_list = list(ModuleInfo_dict.values())
    return bdf_path, ModuleInfo_list, lineLength_list, lifting_method


def main():
    if len(sys.argv) != 4:
        print(
            "사용법: ModuleUnit_HiTESS.exe <input_bdf> <output_bdf> <programName>",
            file=sys.stderr,
        )
        sys.exit(1)

    input_bdf = sys.argv[1]
    output_bdf = sys.argv[2]
    prog = sys.argv[3]

    if prog not in ("ModuleUnit", "GroupUnit"):
        print(
            f"오류: programName은 'ModuleUnit' 또는 'GroupUnit' 이어야 합니다. 입력값: '{prog}'",
            file=sys.stderr,
        )
        sys.exit(1)

    # BDF 마커 파싱
    bdf, HookTrolley_list, lineLength, lifting_method = _inforget_mode(input_bdf)

    # HookTrolley 실행 — 평면 배치 폴더이므로 상대 import 없이 직접 import
    if prog == "ModuleUnit":
        from HookTrolley import HookTrolley
        instance = HookTrolley(
            bdf, output_bdf, HookTrolley_list, lineLength,
            Safety_Factor=1.2, lifting_method=lifting_method,
            analysis=True, debugPrint=True,
        )
    else:
        from HookTrolley_GU import HookTrolley_GU
        instance = HookTrolley_GU(
            bdf, output_bdf, HookTrolley_list, lineLength,
            Safety_Factor=1.2, lifting_method=lifting_method,
            analysis=True, debugPrint=True,
        )

    instance.HookTrolleyRun()


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
