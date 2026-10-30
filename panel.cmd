@echo off
setlocal
rem Start the local admin panel and open it in the default browser.
rem URL: http://127.0.0.1:7373   (Ctrl+C in this window stops the panel)
set "ROOT=%~dp0"
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Install Node 18+ and retry.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:7373"
"%NODE_EXE%" "%ROOT%tools\panel-server.cjs"
pause
