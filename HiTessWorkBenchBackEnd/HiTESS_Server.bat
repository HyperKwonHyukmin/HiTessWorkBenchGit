@echo off
cd /d %~dp0
call WorkBenchEnv\Scripts\activate
python server_manager.py
