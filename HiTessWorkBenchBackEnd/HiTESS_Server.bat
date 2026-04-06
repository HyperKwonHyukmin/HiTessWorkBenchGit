@echo off
cd /d %~dp0
call WorkBenchEnv\Scripts\activate
start "" pythonw server_manager.py
exit
