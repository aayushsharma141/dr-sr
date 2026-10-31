# backend/scripts/smoke_boot.ps1
# Boot smoke test for Kalyan Hospital Management System v3.0 (Plan 11-16 Task 1)
# Strictly PowerShell 5.1 compatible, no && chaining.

$ErrorActionPreference = "Stop"

function Write-Pass([string]$msg) {
    Write-Host "PASS: $msg" -ForegroundColor Green
}

function Write-Fail([string]$msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
}

$repoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$frontendDist = (Resolve-Path "$repoRoot\frontend\dist").Path
$pythonExe = (Resolve-Path "$repoRoot\backend\.venv\Scripts\python.exe").Path

# Set absolute frontend distribution path
$env:KALYAN_FRONTEND_DIST = $frontendDist

Write-Host "=== Kalyan Hospital Management System Boot Smoke ==="
Write-Host "Frontend Dist: $frontendDist"
Write-Host "Python: $pythonExe"

# Step 1: Run database migrations on kalyan_dev
Write-Host "Running database migrations..."
& $pythonExe -m kalyan_api.cli migrate
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Database migration failed."
    exit 1
}
Write-Pass "Database migrations applied up to head"

# Step 2: Check database connectivity and D-02 durability invariants
Write-Host "Checking database durability..."
$checkDbOutput = (& $pythonExe -m kalyan_api.cli check-db 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Database check-db failed: $checkDbOutput"
    exit 1
}
if ($checkDbOutput -notmatch "synchronous_commit:\s*on") {
    Write-Fail "synchronous_commit is not 'on' in check-db output"
    exit 1
}
Write-Pass "Database check-db verified synchronous_commit on"

# Step 3: Generate in-memory 24-character password (unambiguous, never logged or printed)
$alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz!@#$%^&*"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 24
$rng.GetBytes($bytes)
$pwdChars = for ($i = 0; $i -lt 24; $i++) {
    $alphabet[$bytes[$i] % $alphabet.Length]
}
$adminPassword = -join $pwdChars

# Helper function to invoke HTTP requests reliably in PowerShell 5.1
function Invoke-RawHttp {
    param(
        [string]$Method = "GET",
        [string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Body = $null,
        [string]$CookieHeader = $null
    )
    $req = [System.Net.HttpWebRequest]::Create($Uri)
    $req.Method = $Method
    $req.Timeout = 10000
    $req.AllowAutoRedirect = $false

    if ($Headers.ContainsKey("Accept")) {
        $req.Accept = $Headers["Accept"]
    }
    if ($Headers.ContainsKey("Content-Type")) {
        $req.ContentType = $Headers["Content-Type"]
    }
    foreach ($k in $Headers.Keys) {
        if ($k -notin @("Accept", "Content-Type", "Cookie", "Origin")) {
            $req.Headers.Add($k, $Headers[$k])
        }
    }
    if ($Headers.ContainsKey("Origin")) {
        # HttpWebRequest Origin property may or may not be direct in .NET 4.5+
        try {
            $req.Headers.Add("Origin", $Headers["Origin"])
        } catch {
            $req.Host = $Headers["Origin"].Replace("http://", "").Replace("https://", "")
        }
    }
    if ($CookieHeader) {
        $req.Headers.Add("Cookie", $CookieHeader)
    }

    if ($Body) {
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
        $req.ContentLength = $bodyBytes.Length
        $reqStream = $req.GetRequestStream()
        $reqStream.Write($bodyBytes, 0, $bodyBytes.Length)
        $reqStream.Flush()
        $reqStream.Close()
    }

    try {
        $resp = $req.GetResponse()
        $respStream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($respStream, [System.Text.Encoding]::UTF8)
        $content = $reader.ReadToEnd()
        $reader.Close()
        $respStream.Close()

        $respHeaders = @{}
        foreach ($key in $resp.Headers.AllKeys) {
            $respHeaders[$key] = $resp.Headers[$key]
        }
        $statusCode = [int]$resp.StatusCode
        $resp.Close()

        return @{
            StatusCode = $statusCode
            Headers = $respHeaders
            Content = $content
        }
    } catch [System.Net.WebException] {
        $errResp = $_.Exception.Response
        if ($null -ne $errResp) {
            $errStream = $errResp.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($errStream, [System.Text.Encoding]::UTF8)
            $content = $reader.ReadToEnd()
            $reader.Close()
            $errStream.Close()

            $respHeaders = @{}
            foreach ($key in $errResp.Headers.AllKeys) {
                $respHeaders[$key] = $errResp.Headers[$key]
            }
            $statusCode = [int]$errResp.StatusCode
            $errResp.Close()

            return @{
                StatusCode = $statusCode
                Headers = $respHeaders
                Content = $content
            }
        }
        throw
    }
}

$uvicorn = $null
$sessionCookieHeader = $null

try {
    # Step 4: Start uvicorn server in background
    # Ensure any stale setup code from prior runs/tests is removed before server startup
    $setupCodePath = "$repoRoot\backend\var\setup-code.txt"
    if (Test-Path $setupCodePath) {
        Remove-Item -Force $setupCodePath -ErrorAction SilentlyContinue
    }

    Write-Host "Starting uvicorn server on 127.0.0.1:8000..."
    $uvicorn = Start-Process -FilePath $pythonExe `
        -ArgumentList "-m", "uvicorn", "kalyan_api.main:create_app", "--factory", "--host", "127.0.0.1", "--port", "8000", "--no-server-header" `
        -PassThru -NoNewWindow

    # Wait up to 30s for server to start listening
    $started = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $hResp = Invoke-RawHttp -Method "GET" -Uri "http://127.0.0.1:8000/api/health"
            if ($hResp.StatusCode -eq 200) {
                $started = $true
                break
            }
        } catch {
            # continue waiting
        }
    }

    if (-not $started) {
        Write-Fail "Uvicorn server failed to respond on 127.0.0.1:8000 within 30 seconds."
        exit 1
    }
    Write-Pass "Uvicorn server started and responding"

    # Step 5: First-run setup or existing admin reset
    $setupStatusResp = Invoke-RawHttp -Method "GET" -Uri "http://127.0.0.1:8000/api/setup/status"
    if ($setupStatusResp.StatusCode -eq 200) {
        Write-Host "First-run setup is open; reading setup code from file..."
        $setupCodePath = "$repoRoot\backend\var\setup-code.txt"
        $codeWaitCount = 0
        while (-not (Test-Path $setupCodePath) -and $codeWaitCount -lt 10) {
            Start-Sleep -Milliseconds 500
            $codeWaitCount++
        }
        if (-not (Test-Path $setupCodePath)) {
            Write-Fail "Setup code file was not created at $setupCodePath."
            exit 1
        }
        $setupCode = (Get-Content $setupCodePath -Raw).Trim()

        $setupPayload = @{
            setup_code = $setupCode
            username = "smoke.admin"
            full_name = "Smoke Admin"
            password = $adminPassword
        } | ConvertTo-Json -Compress

        $setupResp1 = Invoke-RawHttp -Method "POST" `
            -Uri "http://127.0.0.1:8000/api/setup/admin" `
            -Headers @{
                "Origin" = "http://127.0.0.1:8000"
                "Content-Type" = "application/json"
            } `
            -Body $setupPayload

        if ($setupResp1.StatusCode -ne 201) {
            Write-Fail "First setup POST failed with status $($setupResp1.StatusCode): $($setupResp1.Content)"
            exit 1
        }
        Write-Pass "First-run setup completed (status 201) for smoke.admin"

        # Verify second POST to setup is rejected with 410
        $setupResp2 = Invoke-RawHttp -Method "POST" `
            -Uri "http://127.0.0.1:8000/api/setup/admin" `
            -Headers @{
                "Origin" = "http://127.0.0.1:8000"
                "Content-Type" = "application/json"
            } `
            -Body $setupPayload

        if ($setupResp2.StatusCode -ne 410) {
            Write-Fail "Second setup POST expected 410 but got $($setupResp2.StatusCode): $($setupResp2.Content)"
            exit 1
        }
        Write-Pass "Second setup attempt rejected with status 410 (setup closed)"
    } else {
        Write-Host "Setup already closed; resetting password for smoke.admin via CLI stdin..."
        $adminPassword | & $pythonExe -m kalyan_api.cli reset-admin-password --username smoke.admin --password-stdin
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "CLI password reset failed for smoke.admin. (kalyan_dev may have been set up with a different admin)."
            exit 1
        }
        Write-Pass "Existing smoke.admin password reset via CLI"
    }

    # Step 6: Health check verification
    # health 200 with setup_required false and no Server header
    $healthResp = Invoke-RawHttp -Method "GET" -Uri "http://127.0.0.1:8000/api/health"
    if ($healthResp.StatusCode -ne 200) {
        Write-Fail "Health check expected 200 but got $($healthResp.StatusCode)"
        exit 1
    }
    $healthJson = $healthResp.Content | ConvertFrom-Json
    if ($healthJson.setup_required -ne $false) {
        Write-Fail "Health check setup_required is not false: $($healthResp.Content)"
        exit 1
    }
    if ($healthResp.Headers.ContainsKey("Server") -and [string]::IsNullOrWhiteSpace($healthResp.Headers["Server"]) -eq $false) {
        Write-Fail "Health check response contains Server header: $($healthResp.Headers['Server'])"
        exit 1
    }
    Write-Pass "Health check 200 with setup_required false and no Server header"

    # Step 7: GET / HTML with root element
    $rootResp = Invoke-RawHttp -Method "GET" -Uri "http://127.0.0.1:8000/"
    if ($rootResp.StatusCode -ne 200) {
        Write-Fail "GET / expected 200 but got $($rootResp.StatusCode)"
        exit 1
    }
    if ($rootResp.Content -notmatch 'id="root"') {
        Write-Fail "GET / HTML does not contain id='root'"
        exit 1
    }
    Write-Pass "Root endpoint serves SPA HTML with root element"

    # Step 8: GET /api/unknown with Accept application/json is 404 JSON
    $unknownResp = Invoke-RawHttp -Method "GET" `
        -Uri "http://127.0.0.1:8000/api/unknown" `
        -Headers @{ "Accept" = "application/json" }
    if ($unknownResp.StatusCode -ne 404) {
        Write-Fail "GET /api/unknown expected 404 but got $($unknownResp.StatusCode)"
        exit 1
    }
    try {
        $unknownJson = $unknownResp.Content | ConvertFrom-Json
        if ($null -eq $unknownJson.error -and $null -eq $unknownJson.code) {
            Write-Fail "GET /api/unknown 404 response missing error envelope: $($unknownResp.Content)"
            exit 1
        }
    } catch {
        Write-Fail "GET /api/unknown 404 response is not valid JSON: $($unknownResp.Content)"
        exit 1
    }
    Write-Pass "Unknown API route returns 404 JSON"

    # Step 9: Login without Origin is 403 (csrf_failed)
    $loginPayload = @{
        username = "smoke.admin"
        password = $adminPassword
    } | ConvertTo-Json -Compress

    $loginNoOriginResp = Invoke-RawHttp -Method "POST" `
        -Uri "http://127.0.0.1:8000/api/auth/login" `
        -Headers @{ "Content-Type" = "application/json" } `
        -Body $loginPayload
    if ($loginNoOriginResp.StatusCode -ne 403) {
        Write-Fail "Login without Origin expected 403 but got $($loginNoOriginResp.StatusCode): $($loginNoOriginResp.Content)"
        exit 1
    }
    if ($loginNoOriginResp.Content -notmatch "csrf_failed") {
        Write-Fail "Login without Origin response does not mention csrf_failed: $($loginNoOriginResp.Content)"
        exit 1
    }
    Write-Pass "Login POST without Origin rejected with 403 csrf_failed"

    # Step 10: Login with Origin http://127.0.0.1:8000 is 200 with HttpOnly, SameSite=Strict, no Secure
    $loginResp = Invoke-RawHttp -Method "POST" `
        -Uri "http://127.0.0.1:8000/api/auth/login" `
        -Headers @{
            "Origin" = "http://127.0.0.1:8000"
            "Content-Type" = "application/json"
        } `
        -Body $loginPayload
    if ($loginResp.StatusCode -ne 200) {
        Write-Fail "Login with Origin expected 200 but got $($loginResp.StatusCode): $($loginResp.Content)"
        exit 1
    }
    $setCookie = $loginResp.Headers["Set-Cookie"]
    if (-not $setCookie) {
        Write-Fail "Login response missing Set-Cookie header."
        exit 1
    }
    if ($setCookie -notmatch "(?i)httponly") {
        Write-Fail "Set-Cookie missing HttpOnly attribute."
        exit 1
    }
    if ($setCookie -notmatch "(?i)samesite=strict") {
        Write-Fail "Set-Cookie missing SameSite=Strict attribute."
        exit 1
    }
    if ($setCookie -match "(?i)secure") {
        Write-Fail "Set-Cookie contains Secure flag on offline LAN HTTP deployment."
        exit 1
    }

    # Extract session cookie value for subsequent authenticated call without printing it
    if ($setCookie -match "([a-zA-Z0-9_-]+=[^;]+)") {
        $sessionCookieHeader = $Matches[1]
    } else {
        Write-Fail "Unable to parse session cookie from Set-Cookie."
        exit 1
    }
    Write-Pass "Login POST with Origin returns 200 with HttpOnly, SameSite=Strict, no Secure"

    # Step 11: /me with session cookie returns role ADMIN
    $meResp = Invoke-RawHttp -Method "GET" `
        -Uri "http://127.0.0.1:8000/api/auth/me" `
        -CookieHeader $sessionCookieHeader
    if ($meResp.StatusCode -ne 200) {
        Write-Fail "GET /api/auth/me expected 200 but got $($meResp.StatusCode): $($meResp.Content)"
        exit 1
    }
    $meJson = $meResp.Content | ConvertFrom-Json
    if ($meJson.role -ne "ADMIN") {
        Write-Fail "/api/auth/me expected role 'ADMIN' but got '$($meJson.role)'"
        exit 1
    }
    Write-Pass "Authenticated /me returns 200 with role ADMIN"

    Write-Host "SMOKE OK" -ForegroundColor Green
    exit 0
}
finally {
    Write-Host "Tearing down uvicorn process..."
    if ($uvicorn -and -not $uvicorn.HasExited) {
        Stop-Process -Id $uvicorn.Id -Force -ErrorAction SilentlyContinue
        $uvicorn.WaitForExit(5000)
    }

    # Verify no process is listening on port 8000
    $conns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}
