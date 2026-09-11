@echo off
setlocal EnableDelayedExpansion
title WA Bulk server
cd /d "%~dp0"

echo ==========================================
echo   WA Bulk - self-hosted WhatsApp sender
echo ==========================================
echo.

rem ---- 1. Node.js: use the installed one, or a portable copy in .\runtime ----
set "NODE="
where node >nul 2>&1 && set "NODE=node"
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
if defined NODE (
  "%NODE%" -p process.versions.node > "%TEMP%\wab_node_ver.txt" 2>nul
  set /p NODEVER=<"%TEMP%\wab_node_ver.txt"
  for /f "tokens=1 delims=." %%v in ("!NODEVER!") do set NODEMAJOR=%%v
  if "!NODEMAJOR!"=="" set "NODE="
  if defined NODE if !NODEMAJOR! LSS 22 set "NODE="
)
if not defined NODE (
  echo Node.js 22+ was not found. Downloading a portable copy ^(about 30 MB^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue';" ^
    "$v='v24.9.0'; $zip=\"node-$v-win-x64.zip\";" ^
    "Invoke-WebRequest \"https://nodejs.org/dist/$v/$zip\" -OutFile $zip;" ^
    "Expand-Archive $zip -DestinationPath . -Force; Remove-Item $zip;" ^
    "if (Test-Path runtime) { Remove-Item runtime -Recurse -Force };" ^
    "Rename-Item \"node-$v-win-x64\" runtime"
  if not exist "runtime\node.exe" (
    echo Could not download Node.js. Install it from https://nodejs.org and run this file again.
    pause & exit /b 1
  )
  set "NODE=%~dp0runtime\node.exe"
)
set "PATH=%~dp0runtime;%PATH%"
echo Using Node: & "%NODE%" -v

rem ---- 2. dependencies (no compiler needed; Chromium download is skipped) ----
set PUPPETEER_SKIP_DOWNLOAD=1
set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
if not exist "node_modules\express" (
  echo Installing packages ^(first run only, 1-2 minutes^)...
  if exist "runtime\npm.cmd" ( call "runtime\npm.cmd" install --omit=dev --no-audit --no-fund ) else ( call npm install --omit=dev --no-audit --no-fund )
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

rem ---- 3. a browser for the WhatsApp Web session (Chrome or Edge) ----
set "BROWSER="
for %%p in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do if not defined BROWSER if exist %%p set "BROWSER=%%~p"
if not defined BROWSER (
  echo Google Chrome or Microsoft Edge is required. Install Chrome and run this file again.
  pause & exit /b 1
)
set "PUPPETEER_EXECUTABLE_PATH=%BROWSER%"
echo Using browser: %BROWSER%

rem ---- 4. settings (.env) ----
if not exist ".env" (
  > .env echo ADMIN_USER=admin
  >> .env echo ADMIN_PASSWORD=admin1234
  >> .env echo PORT=3000
  >> .env echo TZ=Asia/Kolkata
  >> .env echo WA_MOCK=0
  echo Created .env with login admin / admin1234  ^(change it in Team after signing in^)
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
if not defined PORT set PORT=3000
set "DATA_DIR=%~dp0data"

rem ---- 5. run ----
echo.
echo Starting on http://localhost:%PORT%   (login: %ADMIN_USER% / %ADMIN_PASSWORD%)
echo Keep this window open. Press Ctrl+C to stop.
echo.
start "" "http://localhost:%PORT%"
"%NODE%" --no-warnings src\server.js
pause
