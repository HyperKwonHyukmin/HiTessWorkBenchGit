"""PyInstaller 진입 스크립트.

spec 은 모듈(`-m`)이 아니라 스크립트 파일을 필요로 하므로, 패키지 진입점을 한 줄로 감싼다.
실제 로직은 전부 `hitess_adapter.psa_main` 에 있다.
"""
import sys

from hitess_adapter.psa_main import main

if __name__ == "__main__":
    sys.exit(main())
