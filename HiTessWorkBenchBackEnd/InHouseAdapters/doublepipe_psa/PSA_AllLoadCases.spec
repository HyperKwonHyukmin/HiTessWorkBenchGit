# -*- mode: python ; coding: utf-8 -*-
"""PSA_AllLoadCases.exe PyInstaller spec.

★ 반드시 `python -m hitess_adapter.prep` 을 먼저 돌린 뒤 빌드할 것.
   prep 이 build/engine (패치 적용된 엔진 사본) 과 build/report_template.bin 을 만든다.
   build.ps1 이 이 순서를 강제한다.

구조:
  - 진입점은 어댑터(psa_entry.py). 연구원의 Main.py 는 쓰지 않는다.
  - 엔진 모듈은 flat import(`from Head_for_... import ...`) 이므로 pathex 에 스테이징 폴더를 넣는다.
  - report_template.bin 을 데이터로 번들해, DRM 으로 디스크 서식이 암호화돼도
    openpyxl_drm shim 이 이 사본으로 폴백할 수 있게 한다.
"""
import os

from PyInstaller.utils.hooks import collect_all

ADAPTER_ROOT = os.path.abspath(SPECPATH)
BUILD_DIR = os.path.join(ADAPTER_ROOT, 'build')
ENGINE_STAGING = os.path.join(BUILD_DIR, 'engine')
TEMPLATE_BIN = os.path.join(BUILD_DIR, 'report_template.bin')

if not os.path.isdir(ENGINE_STAGING):
    raise SystemExit(
        f"엔진 스테이징이 없습니다: {ENGINE_STAGING}\n"
        "  → 먼저 `python -m hitess_adapter.prep` 을 실행하세요."
    )
if not os.path.isfile(TEMPLATE_BIN):
    raise SystemExit(
        f"서식 템플릿이 없습니다: {TEMPLATE_BIN}\n"
        "  → 먼저 `python -m hitess_adapter.prep` 을 실행하세요."
    )

# 빌드 파이썬에 엔진 의존성이 다 있는지 먼저 확인한다 — 여기서 걸러야 '조용히 깨진 exe' 가 안 나온다.
_missing = []
for _dep in ('numpy', 'scipy', 'openpyxl', 'matplotlib', 'pyNastran'):
    try:
        __import__(_dep)
    except ImportError:
        _missing.append(_dep)
if _missing:
    raise SystemExit(
        "빌드 파이썬에 엔진 의존성이 없습니다: " + ", ".join(_missing) + "\n"
        "  → pip install numpy==1.24.4 scipy==1.10.1 openpyxl==3.1.5 matplotlib==3.7.5 pyNastran==1.3.4\n"
        "  (엔진 문서 'FuelLine for HiTESS.md' §2 기준 검증 버전, Python 3.8.8)"
    )

# pyNastran 은 서브모듈을 동적으로 참조하는 부분이 있어 통째로 수집한다.
pynastran_datas, pynastran_binaries, pynastran_hidden = collect_all('pyNastran')

def _engine_modules():
    """스테이징된 엔진의 모든 파이썬 모듈명을 디스크에서 열거한다.

    build 시점에 엔진을 import 하지 않고(sys.path 오염 방지) 파일명만으로 목록을 만든다.
    엔진은 flat import 구조라 최상위 .py 는 모듈명 그대로, 패키지는 점 표기로 넣는다.
    """
    names = []
    for entry in sorted(os.listdir(ENGINE_STAGING)):
        full = os.path.join(ENGINE_STAGING, entry)
        if entry.endswith('.py') and os.path.isfile(full):
            names.append(entry[:-3])
        elif os.path.isdir(full) and os.path.isfile(os.path.join(full, '__init__.py')):
            names.append(entry)
            for sub in sorted(os.listdir(full)):
                if sub.endswith('.py') and sub != '__init__.py':
                    names.append(f'{entry}.{sub[:-3]}')
    return names


hiddenimports = list(pynastran_hidden)
# 엔진 모듈 — 스테이징 pathex 로 잡히지만 명시해 두면 동적 import 누락을 막는다.
# (연구원의 Main.py 는 어댑터가 쓰지 않으므로 제외한다.)
_SKIP = ('Main',)  # 연구원 Main.py 는 어댑터가 대체했으므로 번들하지 않는다.
hiddenimports += [
    name for name in _engine_modules()
    if name not in _SKIP and '_backup' not in name.lower() and '.bak' not in name.lower()
]
hiddenimports += [
    'scipy.sparse.csgraph._validation',
    'scipy.special._cdflib',
    'openpyxl',
]
# 어댑터 자신 — psa_main 이 shim 설치 이후에야 cli 를 import 하므로(순서가 중요),
# 정적 분석이 놓치지 않도록 명시한다.
hiddenimports += [
    'hitess_adapter',
    'hitess_adapter.cli',
    'hitess_adapter.engine',
    'hitess_adapter.psa_main',
    'hitess_adapter.shims',
    'hitess_adapter.shims.console',
    'hitess_adapter.shims.openpyxl_drm',
    'hitess_adapter.shims.openpyxl_merged',
    'hitess_adapter.shims.abaqus_subprocess',
]

datas = list(pynastran_datas)
datas += [(TEMPLATE_BIN, '.')]

a = Analysis(
    [os.path.join(ADAPTER_ROOT, 'psa_entry.py')],
    pathex=[ADAPTER_ROOT, ENGINE_STAGING],
    binaries=list(pynastran_binaries),
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter'],
    noarchive=False,
)
pyz = PYZ(a.pure)

# onefile EXE 인자는 PyInstaller 5(zipfiles 포함) 와 6(제거) 이 다르다 — 둘 다 지원한다.
_exe_parts = [pyz, a.scripts, a.binaries]
if hasattr(a, 'zipfiles'):
    _exe_parts.append(a.zipfiles)
_exe_parts += [a.datas, []]

exe = EXE(
    *_exe_parts,
    name='PSA_AllLoadCases',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
