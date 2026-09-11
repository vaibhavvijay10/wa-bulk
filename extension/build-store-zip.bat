@echo off
rem Builds the zip to upload to the Chrome Web Store (no tests, screenshots or docs inside).
cd /d "%~dp0"
if exist "..\wa-bulk-extension-store.zip" del "..\wa-bulk-extension-store.zip"
powershell -NoProfile -Command "Compress-Archive -Path manifest.json,background.js,icons,page,content,vendor,PRIVACY.md -DestinationPath '..\wa-bulk-extension-store.zip' -Force"
echo Built ..\wa-bulk-extension-store.zip
