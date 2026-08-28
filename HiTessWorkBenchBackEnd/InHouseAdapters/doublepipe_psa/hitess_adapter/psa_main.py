"""PSA_AllLoadCases.exe 진입점.

★ 순서가 중요하다: 엔진 모듈을 import 하기 **전에** shim 을 설치해야 한다.
   - console shim 이 먼저 걸려야 이후 모든 print 가 인코딩으로 죽지 않는다.
   - openpyxl/subprocess shim 은 엔진이 그 모듈들을 쓰기 전에 자리를 잡아야 한다.

그래서 `cli` 는 모듈 최상단이 아니라 main() 안에서 import 한다(cli → engine → 엔진 모듈).
"""
import sys

from .shims import install_all


def main(argv=None):
    install_all()
    from .cli import main as cli_main
    return cli_main(argv)


if __name__ == "__main__":
    sys.exit(main())
