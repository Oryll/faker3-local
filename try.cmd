@echo off
setlocal
rem Run jd_try.js (JD trial) with the local h5st sign server.
rem Usage: double-click, or "try.cmd --dry-run" to preview.
set "ROOT=%~dp0"
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Install Node 18+ and retry.
  if "%~1"=="" pause
  exit /b 1
)
"%NODE_EXE%" "%ROOT%tools\run-try.cjs" %*
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
