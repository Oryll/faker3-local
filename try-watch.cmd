@echo off
setlocal
rem Watch the JD trial page and auto-apply newly listed items (default: phone).
rem Usage: double-click (watch 12h), or "try-watch.cmd --dry-run" to preview.
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
"%NODE_EXE%" "%ROOT%tools\try-watch.cjs" %*
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
