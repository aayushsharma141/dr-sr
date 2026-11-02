# Kalyan Hospital - Automated Offline LAN Server Installation Script
# Run with administrative privileges: powershell -ExecutionPolicy Bypass -File deploy\install.ps1

param (
    [string]$DatabaseName = "kalyan_prod",
    [string]$DbAppPassword = "",
    [string]$DbOwnerPassword = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Kalyan Hospital Platform - Offline LAN Server Installer  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check Python
Write-Host "`n[1/5] Checking Python 3.12..." -ForegroundColor Yellow
$PythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCmd) {
    Write-Error "Python executable not found in system PATH. Please install Python 3.12.x."
}
$PyVersion = python --version
Write-Host "Found: $PyVersion" -ForegroundColor Green

# 2. Virtual Environment Setup
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$VenvDir = Join-Path $BackendDir ".venv"
$WheelhouseDir = Join-Path $RepoRoot "wheelhouse"

Write-Host "`n[2/5] Setting up isolated Python virtual environment..." -ForegroundColor Yellow
if (-not (Test-Path $VenvDir)) {
    python -m venv $VenvDir
    Write-Host "Created virtual environment at $VenvDir" -ForegroundColor Green
} else {
    Write-Host "Virtual environment already exists." -ForegroundColor Gray
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

# 3. Offline Package Installation
Write-Host "`n[3/5] Installing dependencies..." -ForegroundColor Yellow
if (Test-Path $WheelhouseDir) {
    Write-Host "Installing from offline wheelhouse: $WheelhouseDir" -ForegroundColor Green
    & $VenvPython -m pip install --no-index --find-links=$WheelhouseDir -e $BackendDir
} else {
    Write-Host "Wheelhouse directory not present; performing standard editable install..." -ForegroundColor Gray
    & $VenvPython -m pip install -e $BackendDir
}

# 4. Storage Directories Initialization
Write-Host "`n[4/5] Initializing application data directories..." -ForegroundColor Yellow
$VarDir = Join-Path $BackendDir "var"
$PhotosDir = Join-Path $VarDir "photos"
$BackupsDir = Join-Path $VarDir "backups"
$LogsDir = Join-Path $VarDir "logs"

foreach ($dir in @($PhotosDir, $BackupsDir, $LogsDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "Created: $dir" -ForegroundColor Green
    }
}

# 5. Database Migration & Schema Verification
Write-Host "`n[5/5] Applying database migrations..." -ForegroundColor Yellow
& $VenvPython (Join-Path $BackendDir "src\kalyan_api\cli.py") migrate
if ($LASTEXITCODE -ne 0) {
    Write-Error "Database migration failed. Please check PostgreSQL credentials in backend/.env."
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  Installation Complete!                                  " -ForegroundColor Green
Write-Host "  To launch server: deploy\start-server.bat               " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
