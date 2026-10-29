@echo off
chcp 65001 >nul
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo This needs Administrator rights.
  echo Right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
set "APPDIR=%~dp0"
set "PORT=3000"

echo [1/3] Allowing port %PORT% in Windows Firewall...
netsh advfirewall firewall delete rule name="LandRegistry" >nul 2>&1
netsh advfirewall firewall add rule name="LandRegistry" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain >nul

echo [2/3] Creating auto-start task (runs when Windows starts)...
schtasks /Delete /TN "LandRegistry" /F >nul 2>&1
schtasks /Create /TN "LandRegistry" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "cmd /c cd /d \"%APPDIR%\" && node server.js >> server.log 2>&1" >nul
if %errorlevel% neq 0 ( echo Failed to create the task. & pause & exit /b 1 )

echo [3/3] Starting the server now...
schtasks /Run /TN "LandRegistry" >nul

echo.
echo Done. The server now starts automatically with this computer.
echo Other computers can open:  http://THIS-COMPUTER-IP:%PORT%
echo Your IP address(es):
ipconfig | findstr /i "IPv4"
echo.
pause
