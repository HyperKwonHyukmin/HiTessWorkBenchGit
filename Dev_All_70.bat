@echo off
chcp 65001 > nul
rem ---------------------------------------------------------------------------
rem 70 개발 PC 전용 — 백엔드(9091)와 클라이언트(React+Electron)를 각자 새 창으로 띄운다(2026-11-10).
rem  백엔드  = HiTessWorkBenchBackEnd\Dev_Server_70.bat (PyCharm 밖에서 실행 — DRM 충돌 회피)
rem  클라이언트 = HiTessWorkBench\Dev_Client_70.bat (npm run dev)
rem  각 창에서 Ctrl+C 또는 창 닫기로 따로 끈다.
rem ---------------------------------------------------------------------------
cd /d %~dp0
start "HiTESS 백엔드 (9091)" "%~dp0HiTessWorkBenchBackEnd\Dev_Server_70.bat"
rem 백엔드가 포트를 잡을 시간을 조금 준다(클라이언트는 로그인 화면에서 서버를 다시 확인하므로 늦어도 괜찮다).
timeout /t 4 /nobreak > nul
start "HiTESS 클라이언트" "%~dp0HiTessWorkBench\Dev_Client_70.bat"
