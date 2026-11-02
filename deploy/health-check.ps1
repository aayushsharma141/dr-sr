# Kalyan Hospital - Automated Health Check Script
# Probes running server API health and database durability

param (
    [string]$ServerUrl = "http://localhost:8000"
)

$HealthEndpoint = "$ServerUrl/api/health"
Write-Host "Probing Kalyan Hospital server health at: $HealthEndpoint..." -ForegroundColor Cyan

try {
    $Response = Invoke-RestMethod -Uri $HealthEndpoint -Method Get -TimeoutSec 10
    Write-Host "Response received:" -ForegroundColor Green
    $Response | Format-List

    if ($Response.status -eq "ok" -and $Response.database -eq "connected") {
        Write-Host "`nHEALTH STATUS: OK (Server is ready and accepting LAN requests)" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`nHEALTH STATUS: DEGRADED" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "`nERROR: Unable to connect to server at $HealthEndpoint" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 2
}
