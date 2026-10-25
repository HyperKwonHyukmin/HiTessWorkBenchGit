"""PSA_AllLoadCases.exe 진입점.

★ 순서가 중요하다: 엔진 모듈을 import 하기 **전에** shim 을 설치해야 한다.
   - console shim 이 먼저 걸려야 이후 모든 print 가 인코딩으로 죽지 않는다.
   - openpyxl/subprocess shim 은 엔진이 그 모듈들을 쓰기 전에 자리를 잡아야 한다.

그래서 `cli` 는 모듈 최상단이 아니라 main() 안에서 import 한다(cli → engine → 엔진 모듈).

소스 실행(`python -m hitess_adapter.psa_main`)이면 엔진 import 전에 `runtime.prepare_engine()` 이
패치 적용된 엔진 사본을 준비한다(exe 는 빌드 때 이미 패치돼 있다).
"""
import sys

from .shims import install_all

# 어댑터 패치가 새 엔진과 맞지 않을 때의 종료 코드(백엔드 로그에 사유가 함께 남는다).
EXIT_PATCH_MISMATCH = 3


def main(argv=None):
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
