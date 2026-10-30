@echo off
rem Register a daily Windows scheduled task (current user, no admin needed).
setlocal
cd /d "%~dp0"

set "TASK_NAME=Faker3-Daily"
set "RUN_AT=08:30"

if not exist "%~dp0.env" (
  echo [WARN] No .env file yet. The scheduled run will fail without JD_COOKIE.
  echo        Copy .env.example to .env and fill it in first.
  echo.
)

schtasks /Create /TN "%TASK_NAME%" /TR "\"%~dp0daily.cmd\"" /SC DAILY /ST %RUN_AT% /F
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to create the scheduled task.
  echo         Try running this file as Administrator.
  pause
  exit /b 1
)

echo.
echo Scheduled task created: %TASK_NAME%  (daily at %RUN_AT%, group "daily")
echo   Show it : schtasks /Query /TN "%TASK_NAME%"
echo   Run now : schtasks /Run   /TN "%TASK_NAME%"
echo   Delete  : run remove-schedule.cmd
echo.
echo NOTE: by default it runs only while you are logged on. For true headless
echo       scheduling use QingLong in Docker instead.
echo.
pause
exit /b 0
