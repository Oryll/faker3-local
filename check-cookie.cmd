@echo off
rem Check the configured JD cookie + account info.
rem Uses api.m.jd.com GetJDUserInfoUnion (works with the 2026 login flow),
rem instead of the legacy me-api TotalBean endpoint that returns 403/401.
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Install Node.js 18+ first.
  pause
  exit /b 2
)

"%NODE_EXE%" "%~dp0tools\try-tool.cjs" --account %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
