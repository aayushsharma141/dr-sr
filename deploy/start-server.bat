@echo off
REM Kalyan Hospital Centralized LAN Server - Startup Script
setlocal enabledelayedexpansion

echo ========================================================
echo   Starting Kalyan Hospital LAN Server (Port 8000)
echo ========================================================

cd /d "%~dp0\.."
set REPO_ROOT=%CD%
set BACKEND_DIR=%REPO_ROOT%\backend
set VENV_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe

if not exist "%VENV_PYTHON%" (
    echo ERROR: Python virtual environment not found at %VENV_PYTHON%
    echo Please run deploy\install.ps1 first.
    pause
    exit /b 1
)

REM Verify database connection and durability
echo Checking database readiness...
"%VENV_PYTHON%" "%BACKEND_DIR%\src\kalyan_api\cli.py" check-db
if %ERRORLEVEL% neq 0 (
    echo WARNING: Database checks reported warnings or schema drift.
)

REM Launch Uvicorn Production Server
echo Launching Uvicorn server on 0.0.0.0:8000...
"%VENV_PYTHON%" -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --access-log
