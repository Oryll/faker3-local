@echo off
rem Daily group runner - this is what Windows Task Scheduler calls.
setlocal
cd /d "%~dp0"
call "%~dp0run.cmd" --group daily
exit /b %ERRORLEVEL%
