@echo off
setlocal
rem Run the JD trial tool with filter "phones only" (JD cid1=9987).
rem Usage: double-click to apply to all phone trials within today's quota,
rem        or "try-phone.cmd --dry-run" to preview.
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
"%NODE_EXE%" "%ROOT%tools\run-try.cjs" --category phone %*
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
