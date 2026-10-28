@echo off
cd /d "%~dp0"
title Kalyan Hospital - Build Windows Executable

if not exist ".venv\Scripts\pyinstaller.exe" (
    echo [ERROR] PyInstaller not found in .venv.
    echo Please run: .venv\Scripts\pip.exe install -r requirements-dev.txt
    pause
    exit /b 1
)

echo ============================================================
echo   Building Kalyan Hospital Standalone Windows Application
echo ============================================================
echo.

".venv\Scripts\pyinstaller.exe" --noconfirm --onedir --windowed ^
    --name "KalyanHospital" ^
    --add-data "app/db/schema.sql;app/db" ^
    --add-data "app/assets;app/assets" ^
    main.py

echo.
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Build complete!
    echo Executable is located in: dist\KalyanHospital\KalyanHospital.exe
) else (
    echo [ERROR] Build failed with exit code %ERRORLEVEL%.
)
echo.
pause
