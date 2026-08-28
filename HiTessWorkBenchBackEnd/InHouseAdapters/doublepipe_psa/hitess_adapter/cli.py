"""배관응력 해석(PSA) CLI — WorkBench 정본 진입점.

기본은 전체 29개 Load Case(OPE 16 + SUS 1 + OCC 6 + EXP 6)를 해석한다.
`--load-cases` 로 특정 Load Case 만 골라 해석할 수도 있다(그 경우 L17(SUS)은 항상 자동 포함).

사용법(기존 exe 와 동일한 규약 — 백엔드 호출부 변경 없음):
    PSA_AllLoadCases.exe <csv>                          # 전체 29개 (기본값 All)
    PSA_AllLoadCases.exe <csv> --load-cases L18,L20     # 선택 + L17 자동
    PSA_AllLoadCases.exe <csv> --load-cases L20 L21 L22 # 공백 구분도 허용
    PSA_AllLoadCases.exe                                # csv 생략 시 폴더 최신 CSV 자동

전제 / 규칙:
    1. 입력한 LoadCase 와 무관하게 29개 LoadCase inp 는 항상 '전체' 생성된다(참조 정합 유지).
    2. L17(SUS) 해석은 Allowable Stress 계산의 선행조건이므로, 선택 해석 시 항상 자동으로
       포함되어 가장 먼저 수행된다. (예: L20 만 입력해도 내부적으로 L17 → L20 순서)
    3. 해석 흐름: 비마찰 해석 → 마찰 반복(#1,#2) → ASME B31.3 검토 → 보고서.
    4. 보고서(Report for PSA.xlsx)에는 해석한 LoadCase 결과만 채워지고 나머지는 공백으로 둔다.

⚠️ 백엔드(doublepipe_psa_service.py)는 cwd 를 CSV 가 있는 작업 폴더로 지정하고 csv 절대경로를
   인자로 넘긴다 — 여기서 os.chdir 를 하면 산출물(Report/txt)이 엉뚱한 폴더로 가고 동시 실행이
   충돌하므로 **절대 chdir 하지 않는다.**
"""
import argparse
import os
import re
import sys

from . import engine

TOTAL_LC = 29
MANDATORY = "L17"   # SUS — Allowable Stress 선행을 위해 선택 해석 시 항상 포함


# ----------------------------------------------------------------------------
# CLI 입력 파싱
# ----------------------------------------------------------------------------
def parse_cases(tokens):
    """CLI 토큰들을 LoadCase 태그 집합으로 변환.
       'L20,', 'L21', 'L22' / 'L20,L21,L22' / 'l18' / '18' 모두 허용.
       L17(SUS)은 항상 자동 포함된다."""
    raw = []
    for token in tokens:
        # BOM(U+FEFF)·제로폭 공백(U+200B) 등 보이지 않는 문자 제거 후 분리
        token = re.sub("[﻿​]", "", token)
        raw += [x for x in re.split(r"[\s,]+", token) if x]

    requested = set()
    for tok in raw:
        tok = tok.strip()
        match = re.fullmatch(r"[Ll]?(\d{1,2})", tok)
        if not match:
            raise SystemExit(f"[오류] 인식할 수 없는 LoadCase 입력: '{tok}'  (예: L18 또는 L20,L21,L22)")
        number = int(match.group(1))
        if not (1 <= number <= TOTAL_LC):
            raise SystemExit(f"[오류] LoadCase 범위 초과: 'L{number}'  (허용: L1 ~ L{TOTAL_LC})")
        requested.add(f"L{number}")

    if not requested:
        raise SystemExit("[오류] 해석할 LoadCase를 1개 이상 입력하세요.  예: --load-cases L20 L21 L22")

    requested.add(MANDATORY)   # L17 항상 포함
    return requested


def select_indices(all_names, requested):
    """all_names: ['L1_OPE_...', 'L2_OPE_...', ...] (L1..L29 순서).
       반환: requested 에 해당하는 항목의 인덱스 리스트.
       리스트가 L번호 오름차순이므로 L17이 OCC/EXP 보다 먼저 위치 → 선행 보장."""
    selected = []
    for index, name in enumerate(all_names):
        tag = name.split("_", 1)[0]   # 'L18'
        if tag in requested:
            selected.append(index)
    return selected


# ----------------------------------------------------------------------------
# 마찰 반복 inp 생성 (선택된 LoadCase 만 처리)
# ----------------------------------------------------------------------------
def _build_friction_iter01(sym, datnames, filenames):
    for dat_file, inp_file in zip(datnames, filenames):
        non_fric = sym["Non_fric_inp_parse"](inp_file, dat_file)
        non_fric.solver()
        iter01_inp = dat_file.replace(".dat", "_iter01.inp")
        inp_2nd = sym["ModifyINP"](non_fric, iter01_inp)
        inp_2nd.spring_component()


def _build_friction_iter02(sym, datnames, filenames):
    for dat_file, inp_file in zip(datnames, filenames):
        non_fric = sym["Non_fric_inp_parse"](inp_file, dat_file)
        non_fric.solver()
        iter01_inp = dat_file.replace(".dat", "_iter01.inp")
        iter01_dat = dat_file.replace(".dat", "_iter01.dat")
        iter02_inp = dat_file.replace(".dat", "_iter02.inp")

        inp_2nd = sym["ModifyINP"](non_fric, iter01_inp)
        inp_2nd.spring_component()

        dat_2nd = sym["Parse_dat_file"](iter01_dat, iter01_inp)
        dat_2nd.Solver()

        inp_2nd_filter = sym["Fric_inp_parse"](iter01_inp, iter01_dat)
        inp_2nd_filter.solver()

        inp_3rd = sym["INP"](inp_2nd, inp_2nd_filter, iter02_inp)
        inp_3rd.spring_component()


# ----------------------------------------------------------------------------
# 파이프라인
# ----------------------------------------------------------------------------
def run_pipeline(csv_path, requested=None):
    """requested=None 이면 전체 29개, set 이면 그 LoadCase(+L17)만 해석한다."""
    sym = engine.load()

    inp_file = csv_path.replace(".csv", ".inp")
    bdf_file = csv_path.replace(".csv", ".bdf")
    print(f"INP 파일: {inp_file}")
    if requested is not None:
        ordered = sorted(requested, key=lambda s: int(s[1:]))
        print(f"요청 LoadCase(+L17 자동): {', '.join(ordered)}")

    # 1. FEM 모델 생성 — 29개 LoadCase inp 가 '전체' 생성된다.
    creator = sym["AbaqusModelCreator"](csv_path, inp_file, bdf_file, is_OLET=False)
    creator.AbaqusModelCreatorRun(creator.csvInfo_dict, creator.InnerPipeGroup, creator.OuterPipeGroup)

    head = engine.verify_head_instance(sym["HeadClass_01"](inp_file))  # __init__ 에서 makeLC()

    # 선택 인덱스 (전체면 모든 인덱스, 아니면 L번호 오름차순 → L17 선행 보장)
    if requested is None:
        selected = list(range(len(head.LC_name)))
    else:
        selected = select_indices(head.LC_name, requested)
    sel_lc = [head.LC_name[i] for i in selected]
    sel_iter01 = [head.LC_name_iter01[i] for i in selected]
    sel_iter02 = [head.LC_name_iter02[i] for i in selected]
    sel_files = [head.filename[i] for i in selected]
    sel_dats = [head.datname[i] for i in selected]
    print(f"해석 대상 ({len(selected)}개): {sel_lc}")

    # 2. 비마찰 해석
    head.Abaqus_Run(sel_lc, message="비마찰 해석이 완료되었습니다.")

    # 3. 마찰 반복 #1
    _build_friction_iter01(sym, sel_dats, sel_files)
    head.Abaqus_Run(sel_iter01, message="Friction 1st 해석이 완료되었습니다.")

    # 4. 마찰 반복 #2
    _build_friction_iter02(sym, sel_dats, sel_files)
    head.Abaqus_Run(sel_iter02, message="마지막 해석이 완료되었습니다.")

    # 5. ASME B31.3 코드 적합성 검토
    #    sel_dats 는 L번호 오름차순 → L17(SUS)이 먼저 검토되어
    #    L17_SUS_W+P1_CodeStress.txt 가 EXP 검토 이전에 생성된다(선행조건 충족).
    print("\n    ASME B31.3\n")
    over_temp = []
    for dat_file in sel_dats:
        iter02_dat = dat_file.replace(".dat", "_iter02.dat")
        iter02_inp = dat_file.replace(".dat", "_iter02.inp")
        iter01_dat = dat_file.replace(".dat", "_iter01.dat")
        print(iter02_inp)
        result = sym["HeadClass_02"](iter02_inp, iter02_dat, iter01_dat)   # 결과 txt 파일 생성
        suffix = "  <*>" if result.check_overstress == dat_file.replace(".dat", "*") else ""
        over_temp.append(dat_file.replace(".dat", suffix))

    # 과응력 발생 LoadCase 는 '<*>' 로 표시하여 요약 출력
    for label in over_temp:
        print(label)

    # 6. 보고서 생성
    #    make_report() / F06Format 은 '존재하는 결과 txt' 만 읽으므로
    #    해석한 LoadCase 만 채워지고 나머지는 공백으로 남는다.
    #    서식 템플릿의 DRM 암호화는 openpyxl_drm shim 이 번들 사본으로 폴백해 처리한다.
    sym["make_report"]()
    sym["F06Format"]().read_txt()
    print("\n완료: 'Report for PSA.xlsx', 'Inforget_f06.f06' 생성")


# ----------------------------------------------------------------------------
# CSV 자동 선택 (인자 생략 시)
# ----------------------------------------------------------------------------
def _app_dir():
    """실행 기준 폴더.
       - PyInstaller exe(frozen): exe 파일이 위치한 폴더
       - 일반 .py 실행: 현재 작업 디렉터리"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.getcwd()


def _find_latest_csv(directory):
    csv_files = [f for f in os.listdir(directory) if f.lower().endswith(".csv")]
    if not csv_files:
        raise SystemExit("[오류] 동일한 폴더에 CSV 파일이 없습니다. csv 경로를 인자로 지정하세요.")
    csv_files.sort(key=lambda f: os.path.getmtime(os.path.join(directory, f)), reverse=True)
    latest = os.path.join(directory, csv_files[0])
    print(f"자동으로 선택된 CSV 파일: {latest}")
    return latest


def build_parser():
    parser = argparse.ArgumentParser(
        prog="PSA_AllLoadCases",
        description="배관응력 해석 (기본 전체 29 LoadCase, --load-cases 로 선택 가능)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="예시:\n"
               "  PSA_AllLoadCases.exe pipe.csv\n"
               "  PSA_AllLoadCases.exe pipe.csv --load-cases L18\n"
               "  PSA_AllLoadCases.exe pipe.csv --load-cases L20,L21,L22")
    parser.add_argument("csv", nargs="?", default=None,
                        help="입력 배관 CSV 경로. 생략 시 실행 폴더의 최신 CSV 자동 선택.")
    parser.add_argument("--load-cases", dest="load_cases", nargs="*", default=None,
                        help="해석할 LoadCase (예: L18 또는 L20 L21 L22 / L20,L21,L22). "
                             "생략하면 전체 29개를 해석. 지정 시 L17(SUS)은 항상 자동 포함.")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)

    # csv 경로 결정
    if args.csv:
        csv_path = args.csv if os.path.isabs(args.csv) else os.path.abspath(args.csv)
        if not os.path.isfile(csv_path):
            raise SystemExit(f"[오류] CSV 파일을 찾을 수 없습니다: {csv_path}")
    else:
        csv_path = _find_latest_csv(_app_dir())

    # load-cases: 미지정(None) → 전체 / 지정 → 파싱(+L17)
    requested = parse_cases(args.load_cases) if args.load_cases else None

    run_pipeline(csv_path, requested)
    return 0
