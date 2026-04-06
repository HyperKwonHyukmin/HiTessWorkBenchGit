@echo off
cd /d C:\서버경로\HiTessWorkBenchGit\HiTessWorkBenchBackEnd
call WorkBenchEnv\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000