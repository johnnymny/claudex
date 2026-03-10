@echo off
REM gpt-5.4 high via Bearer token - launches in new terminal
wt cmd /k "cd /d %~dp0 && python launch-claudex.py"
