# Kalyan Hospital - Automated Scheduled Backup Task Registration
# Run with administrator privileges: powershell -ExecutionPolicy Bypass -File deploy\register-backup-task.ps1

$ErrorActionPreference = "Stop"

$TaskName = "KalyanHospitalScheduledBackup"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python.exe"
}

Write-Host "Registering Windows Scheduled Backup Task: $TaskName..." -ForegroundColor Cyan

# Define action to run backup-run-scheduled
$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument "-m kalyan_api.cli backup-run-scheduled" -WorkingDirectory $BackendDir
# Run every 15 minutes to evaluate if a scheduled backup slot is due
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration ([TimeSpan]::MaxValue)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Unregister existing task if present
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed previous task registration." -ForegroundColor Yellow
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null

Write-Host "SUCCESS: Scheduled backup task registered." -ForegroundColor Green
Write-Host "The task will tick every 15 minutes and execute scheduled database+photo backups when due according to admin settings." -ForegroundColor Green

