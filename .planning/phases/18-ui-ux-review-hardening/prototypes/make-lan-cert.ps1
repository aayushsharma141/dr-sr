# EXPERIMENT (scratchpad only) - candidate for deploy\make-lan-cert.ps1
# Creates a private local CA + one server certificate (SAN: LAN IP, host name, localhost, 127.0.0.1) using only
# Windows PowerShell 5.1 / .NET Framework 4.8. Nothing is installed in any Windows certificate store and no
# external tool (OpenSSL, mkcert) is needed. Output: ca.cer (DER, for client import), ca.pem, server.pem, server.key.
param(
    [Parameter(Mandatory = $true)][string]$ServerIp,
    [string]$ServerName = "kalyan-server",
    [string]$OutDir = (Join-Path $PSScriptRoot "certs"),
    [int]$LeafYears = 2,
    [int]$CaYears = 10
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-ExportableRsa([int]$Bits) {
    $p = New-Object System.Security.Cryptography.CngKeyCreationParameters
    $p.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::AllowPlaintextExport
    $p.KeyUsage = [System.Security.Cryptography.CngKeyUsages]::AllowAllUsages
    $len = New-Object System.Security.Cryptography.CngProperty("Length", [BitConverter]::GetBytes($Bits), [System.Security.Cryptography.CngPropertyOptions]::None)
    $p.Parameters.Add($len)
    $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, [NullString]::Value, $p)  # NullString => ephemeral key, nothing persisted in the key store
    return New-Object System.Security.Cryptography.RSACng($key)
}
function ConvertTo-Pem([byte[]]$Der, [string]$Label) {
    $b64 = [Convert]::ToBase64String($Der, [Base64FormattingOptions]::InsertLineBreaks)
    return "-----BEGIN $Label-----`n$b64`n-----END $Label-----`n"
}
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

$sha = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$pad = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$X = "System.Security.Cryptography.X509Certificates"
$notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)

# --- Local CA (kept only as long as needed to sign; ca.key is NOT written) ---
$caKey = New-ExportableRsa 3072
$caReq = New-Object "$X.CertificateRequest" ("CN=Kalyan Hospital LAN CA", $caKey, $sha, $pad)
$caReq.CertificateExtensions.Add((New-Object "$X.X509BasicConstraintsExtension" ($true, $true, 0, $true)))
$caReq.CertificateExtensions.Add((New-Object "$X.X509KeyUsageExtension" (([int]([Enum]::Parse("$X.X509KeyUsageFlags", "KeyCertSign")) -bor [int]([Enum]::Parse("$X.X509KeyUsageFlags", "CrlSign"))), $true)))
$caReq.CertificateExtensions.Add((New-Object "$X.X509SubjectKeyIdentifierExtension" ($caReq.PublicKey, $false)))
$caCert = $caReq.CreateSelfSigned($notBefore, $notBefore.AddYears($CaYears))

# --- Server certificate signed by the CA ---
$leafKey = New-ExportableRsa 2048
$req = New-Object "$X.CertificateRequest" ("CN=$ServerName", $leafKey, $sha, $pad)
$san = New-Object "$X.SubjectAlternativeNameBuilder"
$san.AddIpAddress([Net.IPAddress]::Parse($ServerIp))
$san.AddIpAddress([Net.IPAddress]::Loopback)
$san.AddDnsName($ServerName)
$san.AddDnsName("localhost")
$req.CertificateExtensions.Add($san.Build())
$req.CertificateExtensions.Add((New-Object "$X.X509BasicConstraintsExtension" ($false, $false, 0, $true)))
$kuFlags = [int]([Enum]::Parse("$X.X509KeyUsageFlags", "DigitalSignature")) -bor [int]([Enum]::Parse("$X.X509KeyUsageFlags", "KeyEncipherment"))
$req.CertificateExtensions.Add((New-Object "$X.X509KeyUsageExtension" ($kuFlags, $true)))
$eku = New-Object System.Security.Cryptography.OidCollection
[void]$eku.Add((New-Object System.Security.Cryptography.Oid("1.3.6.1.5.5.7.3.1")))  # serverAuth
$req.CertificateExtensions.Add((New-Object "$X.X509EnhancedKeyUsageExtension" ($eku, $false)))
$req.CertificateExtensions.Add((New-Object "$X.X509SubjectKeyIdentifierExtension" ($req.PublicKey, $false)))
$serial = New-Object byte[] 16
(New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($serial)
$serial[0] = $serial[0] -band 0x7F
$leaf = $req.Create($caCert, $notBefore, $notBefore.AddYears($LeafYears), $serial)

# --- Write PEM / DER files ---
Write-Utf8NoBom (Join-Path $OutDir "ca.pem")     (ConvertTo-Pem $caCert.RawData "CERTIFICATE")
[IO.File]::WriteAllBytes((Join-Path $OutDir "ca.cer"), $caCert.RawData)
Write-Utf8NoBom (Join-Path $OutDir "server.pem") ((ConvertTo-Pem $leaf.RawData "CERTIFICATE") + (ConvertTo-Pem $caCert.RawData "CERTIFICATE"))
Write-Utf8NoBom (Join-Path $OutDir "server.key") (ConvertTo-Pem ($leafKey.Key.Export([System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)) "PRIVATE KEY")

Write-Host "CA thumbprint     : $($caCert.Thumbprint)"
Write-Host "Server thumbprint : $($leaf.Thumbprint)"
Write-Host "Server cert valid : $($leaf.NotBefore.ToString('yyyy-MM-dd')) .. $($leaf.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "Files written to  : $OutDir"
