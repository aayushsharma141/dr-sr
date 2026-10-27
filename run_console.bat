@echo off
cd /d "%~dp0"
title Kalyan Hospital Management System (Console Mode)

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found at .venv\Scripts\python.exe
    pause
    exit /b 1
)

echo Starting Kalyan Hospital Management System in console mode...
".venv\Scripts\python.exe" main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Application exited with error code %ERRORLEVEL%
)
pause
