@echo off
cd /d "%~dp0"
title Kalyan Hospital - Automated Test Suite

if not exist ".venv\Scripts\pytest.exe" (
    echo [ERROR] Virtual environment or pytest not found.
    pause
    exit /b 1
)

echo ============================================================
echo   Running Kalyan Hospital Automated Tests
echo ============================================================
echo.

".venv\Scripts\pytest.exe" -v
echo.
pause
