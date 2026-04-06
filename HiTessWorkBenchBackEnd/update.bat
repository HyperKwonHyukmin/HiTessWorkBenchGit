@echo off
chcp 65001 > nul
echo === HiTESS WorkBench 서버 업데이트 ===
cd /d %~dp0

echo.
echo [1/3] Git pull...
git pull origin main
if %ERRORLEVEL% neq 0 (
    echo [오류] git pull 실패. 네트워크 또는 충돌 확인 필요.
    pause
    exit /b 1
)

echo.
echo [2/3] Python 패키지 업데이트...
call WorkBenchEnv\Scripts\pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [오류] pip install 실패.
    pause
    exit /b 1
)

echo.
echo [3/3] 서비스 재시작...
schtasks /end /tn "HiTessBackend" >nul 2>&1
timeout /t 2 >nul
schtasks /run /tn "HiTessBackend"
if %ERRORLEVEL% neq 0 (
    echo [경고] 서비스 재시작 실패. 작업 스케줄러에 HiTessBackend 등록 여부 확인.
)

echo.
echo === 업데이트 완료 ===
pause
