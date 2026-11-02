@echo off
REM Kalyan Hospital Centralized LAN Server - Shutdown Script
echo ========================================================
echo   Stopping Kalyan Hospital LAN Server
echo ========================================================

taskkill /F /IM python.exe /FI "WINDOWTITLE eq Kalyan Hospital*" >nul 2>&1
taskkill /F /IM uvicorn.exe >nul 2>&1

echo Server stop command executed.
