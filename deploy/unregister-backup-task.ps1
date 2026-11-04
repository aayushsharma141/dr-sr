# Kalyan Hospital - Unregister Scheduled Backup Task
# Run with administrator privileges: powershell -ExecutionPolicy Bypass -File deploy\unregister-backup-task.ps1

$ErrorActionPreference = "SilentlyContinue"
$TaskName = "KalyanHospitalScheduledBackup"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Unregistered task: $TaskName" -ForegroundColor Yellow
