@echo off
REM ============================================================
REM  ModuleUnit_HiTESS.exe 빌드 스크립트
REM  실행 전 이 폴더에 아래 파일이 모두 있어야 합니다:
REM    run_module_unit.py  (래퍼, 이미 포함)
REM    HookTrolley.py      (Flask 원본 복사, 상대 import 수정 필요)
REM    HookTrolley_GU.py   (Flask 원본 복사, 상대 import 수정 필요)
REM    hmNastran.py        (Flask 원본 main\PythonModule\ 에서 복사)
REM    F06Parser.py        (동일)
REM    CalcFunc.py         (동일)
REM
REM  HookTrolley*.py 상대 import 수정:
REM    from .hmNastran import ...  →  from hmNastran import ...
REM    from .F06Parser import ...  →  from F06Parser import ...
REM    from .CalcFunc  import ...  →  from CalcFunc  import ...
REM ============================================================

REM 가상환경 생성 및 의존성 설치
python -m venv build_venv
call build_venv\Scripts\activate.bat

pip install pyNastran numpy pyinstaller

REM 빌드
pyinstaller --onefile --name ModuleUnit_HiTESS --distpath dist --clean run_module_unit.py

echo.
echo ============================================================
echo  빌드 완료: dist\ModuleUnit_HiTESS.exe
echo  이 파일을 서버의 아래 경로에 복사하세요:
echo    HiTessWorkBenchBackEnd\InHouseProgram\HiTessBeam\
echo ============================================================
pause
