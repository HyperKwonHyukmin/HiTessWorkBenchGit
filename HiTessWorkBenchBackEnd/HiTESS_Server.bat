@echo off
cd /d %~dp0\HiTessWorkBenchBackEnd
start "" WorkBenchEnv\Scripts\pythonw.exe server_manager.py
exit
