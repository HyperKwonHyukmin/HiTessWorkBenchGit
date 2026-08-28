"""빌드 전처리 — 엔진 스테이징 + Tier-2 패치 적용 + 서식 템플릿 추출.

연구원 원본 폴더는 읽기만 하고, 사본(스테이징)에만 패치를 적용한다. PyInstaller 는 이
스테이징 폴더를 `pathex` 로 잡아 빌드한다.

사용법:
    python -m hitess_adapter.prep
    python -m hitess_adapter.prep --engine-dir "...\\Piping Stress Analysis for all load cases"

산출:
    <adapter_root>/build/engine/               패치 적용된 엔진 사본
    <adapter_root>/build/report_template.bin   DRM 무관 서식 템플릿
"""
import argparse
import os
import shutil
import sys

from . import engine as engine_mod
from . import patches as patches_mod

ZIP_MAGIC = b"PK\x03\x04"
REPORT_TEMPLATE_XLSX = "Report for PSA.xlsx"
REPORT_TEMPLATE_BIN = "report_template.bin"

# 스테이징에서 제외할 것들 — 캐시/백업/거대 산출물은 exe 에 들어갈 이유가 없다.
_EXCLUDE_DIRS = {"__pycache__", ".git", "build", "dist"}
_EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".exe", ".odb", ".lck", ".log")


def adapter_root():
    """.../InHouseAdapters/doublepipe_psa"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def default_staging_dir():
    return os.path.join(adapter_root(), "build", "engine")


def default_template_out():
    return os.path.join(adapter_root(), "build", REPORT_TEMPLATE_BIN)


def deploy_dir():
    """백엔드가 exe·템플릿을 읽는 배포 폴더 (InHouseProgram/DoublePipe/HiTessAdapter)."""
    backend_dir = os.path.dirname(os.path.dirname(adapter_root()))
    return os.path.join(backend_dir, "InHouseProgram", "DoublePipe", "HiTessAdapter")


def _is_excluded(name):
    lowered = name.lower()
    if lowered.endswith(_EXCLUDE_SUFFIXES):
        return True
    # PSA_AllLoadCases.exe.bak-20260716 같은 백업본
    return ".bak" in lowered or lowered.endswith("~")


def stage_engine(engine_dir, staging_dir):
    """엔진 폴더를 스테이징으로 복사한다(원본 무수정)."""
    if not os.path.isdir(engine_dir):
        raise SystemExit(f"[오류] 엔진 폴더가 없습니다: {engine_dir}")
    if os.path.exists(staging_dir):
        shutil.rmtree(staging_dir)
    os.makedirs(os.path.dirname(staging_dir), exist_ok=True)

    def ignore(directory, names):
        skipped = set()
        for name in names:
            full = os.path.join(directory, name)
            if os.path.isdir(full):
                if name in _EXCLUDE_DIRS:
                    skipped.add(name)
            elif _is_excluded(name):
                skipped.add(name)
        return skipped

    shutil.copytree(engine_dir, staging_dir, ignore=ignore)
    print(f"[prep] 엔진 스테이징 완료: {staging_dir}")
    return staging_dir


def apply_patches(staging_dir, patch_list=patches_mod.PATCHES):
    """스테이징 사본에 Tier-2 패치를 적용한다. 실패 시 PatchError 로 중단."""
    for patch in patch_list:
        target = os.path.join(staging_dir, patch.file)
        if not os.path.isfile(target):
            raise patches_mod.PatchError(
                f"[패치 실패] 대상 파일이 없습니다: {patch.file}\n"
                f"  이유: {patch.why}\n"
                f"  → 연구원이 파일을 옮기거나 지웠습니다. patches.py 를 갱신하세요."
            )
        with open(target, "r", encoding="utf-8") as handle:
            text = handle.read()
        new_text, status = patches_mod.apply_to_text(text, patch)
        if status == "applied":
            with open(target, "w", encoding="utf-8", newline="") as handle:
                handle.write(new_text)
            print(f"[prep] 패치 적용: {patch.file}")
        else:
            print(f"[prep] 패치 이미 반영됨(원본에 포함): {patch.file} — patches.py 에서 제거 가능")
    if not patch_list:
        print("[prep] 적용할 Tier-2 패치 없음")


def extract_template(engine_dir, template_out):
    """서식 템플릿을 DRM 무관한 .bin 으로 추출한다.

    우선순위:
      1) 엔진 폴더의 'Report for PSA.xlsx' (버전마다 바뀌므로 이게 최우선)
      2) 엔진 폴더에 남아 있는 report_template.bin (구 배치)
      3) 배포 폴더(HiTessAdapter)의 기존 report_template.bin
      4) 직전 빌드 산출물
    모두 PK 가 아니면 실패한다.
    """
    candidates = [
        os.path.join(engine_dir, REPORT_TEMPLATE_XLSX),
        os.path.join(engine_dir, REPORT_TEMPLATE_BIN),
        os.path.join(deploy_dir(), REPORT_TEMPLATE_BIN),
        template_out,
    ]
    for candidate in candidates:
        if not os.path.isfile(candidate):
            continue
        with open(candidate, "rb") as handle:
            data = handle.read()
        if data[:4] != ZIP_MAGIC:
            print(f"[prep] 건너뜀(PK 아님 — DRM 암호화 추정): {candidate}")
            continue
        os.makedirs(os.path.dirname(template_out), exist_ok=True)
        with open(template_out, "wb") as handle:
            handle.write(data)
        print(f"[prep] 서식 템플릿 추출: {candidate} -> {template_out} ({len(data):,} bytes)")
        return template_out

    raise SystemExit(
        "[오류] 서식 템플릿을 확보하지 못했습니다.\n"
        f"  확인한 후보: {candidates}\n"
        "  전부 PK(zip) 서명이 아닙니다 — 회사 DRM 에 암호화됐을 가능성이 높습니다.\n"
        "  → 네트워크 경로(UNC) 등 DRM 이 걸리지 않는 위치에서 'Report for PSA.xlsx' 클린 사본을\n"
        "     엔진 폴더에 복사한 뒤 다시 실행하세요."
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="hitess_adapter.prep",
        description="이중관 PSA 엔진 빌드 전처리 (스테이징 + 패치 + 템플릿 추출)")
    parser.add_argument("--engine-dir", default=None, help="연구원 원본 엔진 폴더 (기본: InHouseProgram 규약 경로)")
    parser.add_argument("--staging", default=None, help="스테이징 출력 폴더 (기본: build/engine)")
    parser.add_argument("--template-out", default=None, help="report_template.bin 출력 경로 (기본: build/report_template.bin)")
    args = parser.parse_args(argv)

    engine_dir = os.path.abspath(args.engine_dir) if args.engine_dir else engine_mod.default_engine_dir()
    staging_dir = os.path.abspath(args.staging) if args.staging else default_staging_dir()
    template_out = os.path.abspath(args.template_out) if args.template_out else default_template_out()

    print(f"[prep] 엔진 원본: {engine_dir}")
    stage_engine(engine_dir, staging_dir)
    apply_patches(staging_dir)
    extract_template(engine_dir, template_out)
    print("[prep] 완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
