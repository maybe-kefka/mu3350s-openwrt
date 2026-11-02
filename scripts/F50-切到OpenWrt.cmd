@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0F50-切到OpenWrt.ps1"
echo.
pause
