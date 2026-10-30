param(
    [ValidateSet("content", "order")]
    [string]$Mode = "content"
)

$ErrorActionPreference = "Stop"

$registerPath = ".planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md"

if (-not (Test-Path $registerPath)) {
    Write-Host "FAIL: Register file $registerPath not found"
    exit 1
}

$content = Get-Content -Path $registerPath -Raw

# Check for forbidden OPEN status cell
if ($content -match '\|\s*OPEN\s*\|') {
    Write-Host "FAIL: Register contains an OPEN status cell"
    exit 1
}

# Verify presence of all required IDs
$requiredIds = @(
    "EG-1", "EG-2", "EG-3", "EG-4", "EG-5",
    "EG-6", "EG-7", "EG-8", "EG-9", "EG-10",
    "EG-11", "EG-12", "EG-13", "EG-14", "EG-15",
    "EG-16", "EG-17", "EG-18", "EG-19", "EG-20",
    "RISK-01", "RISK-02", "RISK-03"
)

foreach ($id in $requiredIds) {
    if ($content -notmatch "\b$id\b") {
        Write-Host "FAIL: Missing required ID $id in register"
        exit 1
    }
}

if ($Mode -eq "order") {
    $gitExe = "git"
    if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
        if (Test-Path "C:\Program Files\Git\cmd\git.exe") {
            $gitExe = "C:\Program Files\Git\cmd\git.exe"
        }
    }

    $gate = & $gitExe log --diff-filter=A --format=%ct -- $registerPath | Select-Object -Last 1
    $code = & $gitExe log --diff-filter=A --format=%ct -- backend frontend | Select-Object -Last 1

    if ($gate -and (-not $code -or [int64]$gate -le [int64]$code)) {
        Write-Host "OK: gate precedes code"
        exit 0
    } else {
        Write-Host "FAIL: entry gate not committed before code"
        exit 1
    }
}

Write-Host "OK"
exit 0
