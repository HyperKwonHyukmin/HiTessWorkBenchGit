@echo off
REM Build script for ModuleUnit_HiTESS.exe
REM All 7 files must be present in this folder:
REM   run_module_unit.py, HookTrolley.py, HookTrolley_GU.py,
REM   hmNastran.py, F06Parser.py, CalcFunc.py, build.bat

python -m venv build_venv
call build_venv\Scripts\activate.bat

pip install pyNastran numpy pandas pyinstaller

pyinstaller --onefile --name ModuleUnit_HiTESS --distpath dist --clean run_module_unit.py

echo.
echo Build complete: dist\ModuleUnit_HiTESS.exe
echo Copy to: HiTessWorkBenchBackEnd\InHouseProgram\HiTessBeam\
pause
