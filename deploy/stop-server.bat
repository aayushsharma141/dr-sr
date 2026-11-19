@echo off
REM Kalyan Hospital Centralized LAN Server - Shutdown Script
setlocal
echo ========================================================
echo   Stopping Kalyan Hospital LAN Server
echo ========================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "try {" ^
  "  $task = Get-ScheduledTask -TaskName 'KalyanHospitalServerAutoStart' -ErrorAction SilentlyContinue;" ^
  "  if ($task -and $task.State -eq 'Running') {" ^
  "    Stop-ScheduledTask -TaskName 'KalyanHospitalServerAutoStart';" ^
  "    Write-Host 'Stopped scheduled task KalyanHospitalServerAutoStart.'" ^
  "  }" ^
  "} catch { Write-Warning ('Could not stop scheduled task: ' + $_.Exception.Message) };" ^
  "function Get-KalyanServerPids {" ^
  "  $ids = New-Object 'System.Collections.Generic.HashSet[int]';" ^
  "  Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(pythonw?|uvicorn)\.exe$' -and $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'kalyan_api' } | ForEach-Object { [void]$ids.Add([int]$_.ProcessId) };" ^
  "  Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {" ^
  "    $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess) -ErrorAction SilentlyContinue;" ^
  "    if ($p -and $p.Name -match '^(pythonw?|uvicorn)\.exe$' -and (-not $p.CommandLine -or $p.CommandLine -match 'kalyan_api')) { [void]$ids.Add([int]$p.ProcessId) }" ^
  "  };" ^
  "  return @($ids)" ^
  "};" ^
  "$targets = @(Get-KalyanServerPids);" ^
  "if ($targets.Count -eq 0) { Write-Host 'No running Kalyan Hospital server found.'; exit 0 };" ^
  "foreach ($id in $targets) {" ^
  "  if (Get-Process -Id $id -ErrorAction SilentlyContinue) {" ^
  "    try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host ('Stopped server process PID ' + $id) }" ^
  "    catch { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Write-Warning ('Failed to stop PID ' + $id + ': ' + $_.Exception.Message) } }" ^
  "  }" ^
  "};" ^
  "$deadline = (Get-Date).AddSeconds(5);" ^
  "do { Start-Sleep -Milliseconds 250; $remaining = @(Get-KalyanServerPids) } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline);" ^
  "if ($remaining.Count -gt 0) { Write-Error ('Server still running (PIDs: ' + ($remaining -join ', ') + '). Try running as Administrator.'); exit 1 };" ^
  "Write-Host 'Kalyan Hospital server stopped.'"

exit /b %ERRORLEVEL%
