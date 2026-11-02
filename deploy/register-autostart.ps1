# Kalyan Hospital - Automated Startup Task Registration
# Run with administrator privileges: powershell -ExecutionPolicy Bypass -File deploy\register-autostart.ps1

$ErrorActionPreference = "Stop"

$TaskName = "KalyanHospitalServerAutoStart"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StartBat = Join-Path $RepoRoot "deploy\start-server.bat"

Write-Host "Registering Windows Startup Task: $TaskName..." -ForegroundColor Cyan

# Define action to run start-server.bat minimized
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StartBat`""
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Unregister existing task if present
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed previous task registration." -ForegroundColor Yellow
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null

Write-Host "SUCCESS: Auto-recovery task registered." -ForegroundColor Green
Write-Host "The Kalyan Hospital server will automatically boot and verify database health after any system restart or power cut." -ForegroundColor Green
