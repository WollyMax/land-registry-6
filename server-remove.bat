@echo off
chcp 65001 >nul
net session >nul 2>&1
if %errorlevel% neq 0 ( echo Run as administrator. & pause & exit /b 1 )
schtasks /End /TN "LandRegistry" >nul 2>&1
schtasks /Delete /TN "LandRegistry" /F
netsh advfirewall firewall delete rule name="LandRegistry"
echo Auto-start removed.
pause
