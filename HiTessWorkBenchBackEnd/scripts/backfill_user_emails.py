r"""[호환용] 메일만 백필하던 옛 스크립트의 자리. 이제는 전체 PLM 리프레시로 대체됐다.

실제 작업은 ``scripts/sync_user_directory.py`` 가 수행한다. 이 파일은 과거 명령어
(``--employee-id``, ``--refresh-all``, ``--dry-run``)로 돌리던 손 끝 기억을 깨뜨리지
않기 위해 남겨 둔 얇은 wrapper 다. ``--refresh-all`` 은 이제 기본 동작이므로 무시된다.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.argv = [a for a in sys.argv if a != "--refresh-all"]

from sync_user_directory import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
