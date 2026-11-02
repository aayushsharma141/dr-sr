# Kalyan Hospital - Unregister Startup Task
# Run with administrator privileges: powershell -ExecutionPolicy Bypass -File deploy\unregister-autostart.ps1

$ErrorActionPreference = "SilentlyContinue"
$TaskName = "KalyanHospitalServerAutoStart"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Unregistered task: $TaskName" -ForegroundColor Yellow
