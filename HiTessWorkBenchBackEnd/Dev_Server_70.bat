@echo off
chcp 65001 > nul
title HiTESS WorkBench 백엔드 (70 개발용, 9091)
rem ---------------------------------------------------------------------------
rem 70 개발 PC 전용 백엔드 실행 — 바탕화면 바로가기로 두 번 클릭해 켠다(2026-11-10).
rem  * PyCharm 터미널에서 띄우면 백엔드가 부르는 파이썬(BDF 검증·편집 적용)이 회사 DRM 모듈
rem    HIDRMH.DLL 에서 0xC0000005 로 죽는다(2026-11-10 실측). 이 창은 PyCharm 과 무관하게 뜬다.
rem  * 145 운영 서버는 이것을 쓰지 않는다 — 145 는 HiTESS_Server.bat(server_manager.py).
rem  * --reload: 코드를 저장하면 저절로 다시 읽는다. 끌 때는 이 창에서 Ctrl+C 또는 창 닫기.
rem ---------------------------------------------------------------------------
cd /d %~dp0

rem 9091 을 이미 쓰는 백엔드가 있으면 알리고 묻는다(PyCharm 에 떠 있던 백엔드 등).
rem  --reload 는 감시 프로세스(uvicorn) 아래 작업 프로세스가 포트를 잡아, 작업 프로세스만 끄면 감시 프로세스가 남는다.
rem  그래서 포트 주인에서 위로 python/uvicorn 이 이어지는 맨 위 프로세스를 찾아 그 아래를 통째로 끈다.
set "ROOT9091="
for /f "usebackq delims=" %%r in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts_dev_find_9091.ps1"`) do set "ROOT9091=%%r"
if defined ROOT9091 (
    echo.
    echo [알림] 9091 포트에 이미 백엔드가 떠 있습니다 - %ROOT9091%
    echo        PyCharm 터미널에서 띄운 것이면 끄고 여기서 새로 켜는 것이 좋습니다.
    echo.
    choice /c YN /m "그 백엔드를 끄고 여기서 새로 켤까요"
    if errorlevel 2 (
        echo 켜지 않고 끝냅니다.
        pause
        exit /b 0
    )
    for /f "tokens=1" %%k in ("%ROOT9091%") do taskkill /PID %%k /T /F > nul 2>&1
    timeout /t 2 /nobreak > nul
)

if not exist "WorkBenchEnv\Scripts\python.exe" (
    echo [오류] 가상환경이 없습니다: %~dp0WorkBenchEnv
    pause
    exit /b 1
)

echo.
echo === HiTESS WorkBench 백엔드 시작 (http://localhost:9091) ===
echo     끄기: Ctrl+C 또는 이 창 닫기
echo.
"WorkBenchEnv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload

echo.
echo [백엔드가 멈췄습니다] 위 메시지를 확인하세요.
pause
