@echo off
rem Delete the scheduled task.
setlocal
set "TASK_NAME=Faker3-Daily"
schtasks /Delete /TN "%TASK_NAME%" /F
if errorlevel 1 (
  echo [WARN] Delete failed: task may not exist, or admin rights are required.
  pause
  exit /b 1
)
echo Scheduled task deleted: %TASK_NAME%
pause
exit /b 0
