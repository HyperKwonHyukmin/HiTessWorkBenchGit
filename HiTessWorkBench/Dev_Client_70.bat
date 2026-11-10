@echo off
chcp 65001 > nul
title HiTESS WorkBench 클라이언트 (70 개발용 - React 5173 + Electron)
rem ---------------------------------------------------------------------------
rem 70 개발 PC 전용 — HiTessWorkBench 에서 "npm run dev" 를 두 번 클릭으로 띄운다(2026-11-10).
rem  React 개발 서버(5173) + Electron 개발 창. 끄기: 이 창에서 Ctrl+C 또는 창 닫기.
rem  Electron 은 5173 만 연다 — 이미 5173 이 떠 있으면 Vite 가 다른 포트로 옮겨 화면이 안 맞으므로 먼저 묻는다.
rem ---------------------------------------------------------------------------
cd /d %~dp0

set "PID5173="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":5173 .*LISTENING"') do set "PID5173=%%p"
if defined PID5173 (
    echo.
    echo [알림] 5173 포트가 이미 쓰이고 있습니다 - PID %PID5173%
    echo        다른 창에서 클라이언트가 떠 있을 수 있습니다.
    echo.
    choice /c YN /m "그것을 끄고 여기서 새로 띄울까요"
    if errorlevel 2 (
        echo 띄우지 않고 끝냅니다.
        pause
        exit /b 0
    )
    taskkill /PID %PID5173% /T /F > nul 2>&1
    timeout /t 2 /nobreak > nul
)

where npm > nul 2>&1
if errorlevel 1 (
    echo [오류] npm 을 찾을 수 없습니다. Node.js 설치를 확인하세요.
    pause
    exit /b 1
)

echo.
echo === HiTESS WorkBench 클라이언트 시작 (React 5173 + Electron) ===
echo     끄기: Ctrl+C 또는 이 창 닫기
echo.
call npm run dev

echo.
echo [클라이언트가 멈췄습니다] 위 메시지를 확인하세요.
pause
