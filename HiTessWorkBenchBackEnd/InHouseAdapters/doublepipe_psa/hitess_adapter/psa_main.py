"""PSA_AllLoadCases.exe 진입점.

★ 순서가 중요하다: 엔진 모듈을 import 하기 **전에** shim 을 설치해야 한다.
   - console shim 이 먼저 걸려야 이후 모든 print 가 인코딩으로 죽지 않는다.
   - openpyxl/subprocess shim 은 엔진이 그 모듈들을 쓰기 전에 자리를 잡아야 한다.

그래서 `cli` 는 모듈 최상단이 아니라 main() 안에서 import 한다(cli → engine → 엔진 모듈).

소스 실행(`python -m hitess_adapter.psa_main`)이면 엔진 import 전에 `runtime.prepare_engine()` 이
패치 적용된 엔진 사본을 준비한다(exe 는 빌드 때 이미 패치돼 있다).
"""
import os
import sys

from .shims import install_all

# 어댑터 패치가 새 엔진과 맞지 않을 때의 종료 코드(백엔드 로그에 사유가 함께 남는다).
EXIT_PATCH_MISMATCH = 3


def _engine_has_main_pipeline():
    """소스 실행에서 엔진 폴더 Main.py 가 2026-11-26 이후 엔진인지(run_pipeline + make_report_pro).

    옛 엔진(10월 판 등)도 run_pipeline 은 있으므로 그것만으로는 가를 수 없다. 서식 없이 보고서를
    만드는 make_report_pro 를 쓰는지까지 본다(백엔드 _engine_builds_own_report 와 같은 기준).
    옛 엔진은 아래 옛 경로(shim + 패치 사본)로 돌아야 보고서가 깨지지 않는다.
    """
    from . import engine
    engine_dir = engine.resolve_engine_dir()
    if engine_dir is None:
        return False
    try:
        with open(os.path.join(engine_dir, "Main.py"), "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    except OSError:
        return False
    return "def run_pipeline" in text and "make_report_pro" in text


def main(argv=None):
    if not getattr(sys, "frozen", False) and _engine_has_main_pipeline():
        # 2026-11-26 사용자 지시: 엔진 폴더 그대로 실행한다. 사본, 패치, 서식 shim 없이
        # 엔진 폴더의 Main.run_pipeline 을 부르고, WorkBench 는 Load Case 선택만 더한다(cli.py).
        # 남기는 것은 한글 출력이 파이프에서 깨지지 않게 하는 console shim 하나뿐이다.
        from .shims import console
        console.install()
        sys.dont_write_bytecode = True  # 연구원 엔진 폴더에 __pycache__ 를 쓰지 않는다
        from .cli import main as cli_main
        return cli_main(argv)
    install_all()
    if not getattr(sys, "frozen", False):
        from .patches import PatchError
        from .runtime import prepare_engine
        try:
            prepare_engine()
        except PatchError as exc:
            print("[어댑터 패치 불일치] 엔진 코드가 바뀌어 WorkBench 보정 패치를 적용할 수 없습니다.")
            print(exc)
            print("  → 70 에서 pytest tests/test_doublepipe_adapter.py 로 확인하고 patches.py 를 갱신하세요.")
            return EXIT_PATCH_MISMATCH
    from .cli import main as cli_main
    return cli_main(argv)


if __name__ == "__main__":
    sys.exit(main())
