# Kalyan Hospital - Scheduled Backup Task Registration
# Run with administrator privileges: powershell -ExecutionPolicy Bypass -File deploy\register-backup-task.ps1
#
# The task runs every 15 minutes and does nothing until an administrator enables the schedule in
# Admin > Backup & Restore. Time, frequency, second copy and retention are read from the database.

$ErrorActionPreference = "Stop"

$TaskName = "KalyanHospitalScheduledBackup"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    throw "Python virtual environment not found at $VenvPython. Run deploy\install.ps1 first."
}

Write-Host "Registering Windows Scheduled Task: $TaskName..." -ForegroundColor Cyan

$Action = New-ScheduledTaskAction -Execute $VenvPython -Argument "-m kalyan_api.cli backup-run-scheduled" -WorkingDirectory $BackendDir
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed previous task registration." -ForegroundColor Yellow
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null

Write-Host "SUCCESS: Scheduled backup task registered." -ForegroundColor Green
Write-Host "Backups stay off until the schedule is enabled in the Admin Panel." -ForegroundColor Green
