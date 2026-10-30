@echo off
rem Validate the configured JD cookie by running the asset-statistics script.
rem NOTE: since 2026 JD no longer issues pt_key/pt_pin, so jd_CheckCK.js always
rem reports "invalid" even for a working cookie. jd_bean_change.js is the honest check.
setlocal
cd /d "%~dp0"
call "%~dp0run.cmd" jd_bean_change.js
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
