# backend/scripts/start_server.ps1
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$frontendDist = (Resolve-Path "$repoRoot\frontend\dist").Path
$pythonExe = (Resolve-Path "$repoRoot\backend\.venv\Scripts\python.exe").Path

$env:KALYAN_FRONTEND_DIST = $frontendDist

# Stop any existing process on port 8000
$conns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($c in $conns) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting Kalyan Hospital Platform supervisor on 0.0.0.0:8000..."

while ($true) {
    Write-Host "Launching uvicorn server..."
    & $pythonExe -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --no-server-header
    Write-Host "Uvicorn exited with code $LASTEXITCODE. Restarting in 2 seconds..."
    Start-Sleep -Seconds 2
}
