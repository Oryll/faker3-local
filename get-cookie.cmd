@echo off
setlocal
cd /d "%~dp0"

rem Locate Node.js: PATH, common install dirs, then the DSH bundled runtime.
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js not found.
  echo   Install Node.js LTS: https://nodejs.org/en/download
  echo   Or add the node.exe directory to PATH and retry.
  pause
  exit /b 1
)

rem Grab JD cookies via a dedicated Edge profile and write them into .env.
"%NODE_EXE%" "%~dp0tools\get-cookie.mjs" %*
set "RC=%ERRORLEVEL%"

if "%~1"=="" pause
exit /b %RC%
