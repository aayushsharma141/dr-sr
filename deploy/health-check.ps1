# Kalyan Hospital - Automated Health Check Script
# Probes the running server's public /api/health endpoint.
#
# /api/health (backend/src/kalyan_api/routers/health.py) returns:
#   { "status": "ok", "db": "ok", "setup_required": <bool> }
# The endpoint executes "SELECT 1" before answering, so db = "ok" means the database answered.
#
# Exit codes: 0 = healthy, 1 = degraded (unexpected payload), 2 = server unreachable / error.

param (
    [string]$ServerUrl = "http://localhost:8000"
)

$HealthEndpoint = "$ServerUrl/api/health"
Write-Host "Probing Kalyan Hospital server health at: $HealthEndpoint..." -ForegroundColor Cyan

try {
    $Response = Invoke-RestMethod -Uri $HealthEndpoint -Method Get -TimeoutSec 10
    Write-Host "Response received:" -ForegroundColor Green
    $Response | Format-List

    if ($Response.status -eq "ok" -and $Response.db -eq "ok") {
        if ($Response.setup_required -eq $true) {
            Write-Host "`nNOTE: First-run setup has not been completed yet (setup_required = true)." -ForegroundColor Yellow
        }
        Write-Host "`nHEALTH STATUS: OK (Server is ready and accepting LAN requests)" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`nHEALTH STATUS: DEGRADED (status='$($Response.status)', db='$($Response.db)')" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "`nERROR: Unable to connect to server at $HealthEndpoint" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 2
}
