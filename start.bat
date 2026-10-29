@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting server... Do not close this window.
echo Browser will open at http://localhost:3000
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node server.js
echo.
echo Server stopped or failed. Read the message above.
pause
