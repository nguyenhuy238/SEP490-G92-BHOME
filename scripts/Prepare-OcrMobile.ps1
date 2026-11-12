param([string]$LanIp, [switch]$SkipDatabase)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
. (Join-Path $PSScriptRoot 'MobileNetwork.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$configurationPath = Join-Path $repo '.env'
if (-not (Test-Path -LiteralPath $configurationPath)) { throw 'Run scripts/Initialize-Local.ps1 first.' }
if (-not $LanIp) { $LanIp = Get-MobileLanIp }
if (-not (Test-MobilePrivateIpv4 $LanIp)) { throw 'Supply -LanIp with the private IPv4 address on the same LAN as the iPhone.' }
if ($LanIp -notin @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress)) { throw 'Selected LAN IP is not assigned to this computer.' }
function New-Secret32 {
    $bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes); return [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }
}
$configText = [IO.File]::ReadAllText($configurationPath)
function Set-Setting([string]$key, [string]$value, [switch]$OnlyIfMissing) {
    $pattern = '(?m)^' + [regex]::Escape($key) + '=.*$'
    if ([regex]::IsMatch($script:configText, $pattern)) {
        if (-not $OnlyIfMissing) { $script:configText = [regex]::Replace($script:configText, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) "$key=$value" }) }
    } else { $script:configText = $script:configText.TrimEnd() + "`n$key=$value`n" }
}
Set-Setting 'IdentityProtection__ActiveEncryptionVersion' 'local-v1' -OnlyIfMissing
Set-Setting 'IdentityProtection__ActiveHmacVersion' 'local-h1' -OnlyIfMissing
$aesVersion = [regex]::Match($configText, '(?m)^IdentityProtection__ActiveEncryptionVersion=([^\r\n]+)').Groups[1].Value
$hmacVersion = [regex]::Match($configText, '(?m)^IdentityProtection__ActiveHmacVersion=([^\r\n]+)').Groups[1].Value
if ($aesVersion -notmatch '^[a-zA-Z0-9_-]{1,32}$' -or $hmacVersion -notmatch '^[a-zA-Z0-9_-]{1,32}$') { throw 'Invalid local key version.' }
Set-Setting "IdentityProtection__EncryptionKeys__$aesVersion" (New-Secret32) -OnlyIfMissing
Set-Setting "IdentityProtection__HmacKeys__$hmacVersion" (New-Secret32) -OnlyIfMissing
$tlsDir = Join-Path $repo '.tools/mobile-tls'
New-Item -ItemType Directory -Path $tlsDir -Force | Out-Null
$pfxPath = Join-Path $tlsDir 'api.pfx'; $caPath = Join-Path $tlsDir 'root-ca.cer'; $ipPath = Join-Path $tlsDir 'lan-ip.txt'
$developmentHost = [string](Get-MobileDevelopmentHost)
$hostPath = Join-Path $tlsDir 'dns-host.txt'
$existingPassword = [regex]::Match($configText, '(?m)^Kestrel__Certificates__Default__Password=([^\r\n]+)').Groups[1].Value
$renewCertificate = -not (Test-Path -LiteralPath $pfxPath) -or -not (Test-Path -LiteralPath $caPath) -or
    -not (Test-Path -LiteralPath $ipPath) -or [IO.File]::ReadAllText($ipPath).Trim() -ne $LanIp -or -not $existingPassword -or
    -not (Test-Path -LiteralPath $hostPath) -or [IO.File]::ReadAllText($hostPath).Trim() -ne $developmentHost
if (-not $renewCertificate) {
    try {
        $currentCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($pfxPath, $existingPassword)
        $renewCertificate = $currentCertificate.NotAfter -le (Get-Date).AddDays(7)
        $currentCertificate.Dispose()
    } catch { $renewCertificate = $true }
}
if ($renewCertificate) {
    # Certificates go to the current user's personal store, never auto-install into a trust store.
    # An IP change only requires a new server certificate. Keep the CA already trusted on iPhone.
    $ca = $null
    if (Test-Path -LiteralPath $caPath) {
        $publicCa = [Security.Cryptography.X509Certificates.X509Certificate2]::new($caPath)
        $ca = Get-Item -LiteralPath "Cert:\CurrentUser\My\$($publicCa.Thumbprint)" -ErrorAction SilentlyContinue
        if ($ca -and (-not $ca.HasPrivateKey -or $ca.NotAfter -le (Get-Date).AddMonths(6))) { $ca = $null }
    }
    if (-not $ca) {
        $ca = New-SelfSignedCertificate -Type Custom -Subject 'CN=BHOME Local Mobile CA' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(2) -KeyUsage CertSign,CRLSign -TextExtension @('2.5.29.19={critical}{text}ca=1')
        Write-Warning 'A new local CA was created. Install and explicitly trust the public CA on your iPhone.'
    }
    $subjectAlternativeNames = "IPAddress=$LanIp&DNS=localhost"
    if ($developmentHost) { $subjectAlternativeNames += "&DNS=$developmentHost" }
    $server = New-SelfSignedCertificate -Type Custom -Subject "CN=$LanIp" -Signer $ca -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddMonths(6) -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @("2.5.29.17={text}$subjectAlternativeNames", '2.5.29.37={text}1.3.6.1.5.5.7.3.1')
    $existingPassword = New-Secret32
    Export-PfxCertificate -Cert $server -FilePath $pfxPath -Password (ConvertTo-SecureString $existingPassword -AsPlainText -Force) | Out-Null
    Export-Certificate -Cert $ca -FilePath $caPath -Type CERT | Out-Null
    [IO.File]::WriteAllText($ipPath, $LanIp)
    [IO.File]::WriteAllText($hostPath, $developmentHost)
}
Set-Setting 'Kestrel__Certificates__Default__Path' $pfxPath
Set-Setting 'Kestrel__Certificates__Default__Password' $existingPassword
Set-Setting 'Ocr__Enabled' 'true'
Set-Setting 'Ocr__ModelDirectory' (Join-Path $repo '.tools/ocr-models')
Set-Setting 'MobileDevelopment__Enabled' 'true'
Set-Setting 'MobileDevelopment__RootCertificate' $caPath
Set-Setting 'AllowedHosts' ((@('localhost', '127.0.0.1', $LanIp, $developmentHost) | Where-Object { $_ }) -join ';')
[IO.File]::WriteAllText($configurationPath, $configText, [Text.UTF8Encoding]::new($false))
foreach ($line in ($configText -split '\r?\n')) {
    if ($line -match '^(ConnectionStrings__[^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
# Mobile development derives its API from the Expo manifest, not an IP baked into .env.local.
# Preserve explicit environment configuration for standalone/staging builds.
# Visual Studio does not load .env. Keep its Development-only user secrets aligned
# with the mobile launcher, including explicit endpoints that override localhost launch URLs.
# Pipe JSON through stdin so certificate passwords/identity keys never appear in process arguments.
$mobileSettings = Get-MobileBackendSettings $configText
$mobileSettings['Kestrel:Endpoints:MobileHttps:Url'] = 'https://0.0.0.0:7240'
$mobileSettings['Kestrel:Endpoints:MobileHttps:Certificate:Path'] = $pfxPath
$mobileSettings['Kestrel:Endpoints:MobileHttps:Certificate:Password'] = $existingPassword
$mobileSettings['Kestrel:Endpoints:MobileHttp:Url'] = 'http://0.0.0.0:5240'
# Never install or trust a root automatically. Reuse only an existing, trusted
# ASP.NET localhost certificate; exporting it stays inside the ignored TLS directory.
$localhostPfx = $null
$trustedLocalhost = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.Subject -eq 'CN=localhost' -and $_.HasPrivateKey -and
    $_.Extensions.Oid.Value -contains '1.3.6.1.4.1.311.84.1.1' -and
    $_.NotAfter -gt (Get-Date).AddDays(7) -and $_.Verify()
} | Sort-Object NotAfter -Descending | Select-Object -First 1
if ($trustedLocalhost) {
    $localhostPfx = Join-Path (Split-Path -Parent $pfxPath) 'localhost.pfx'
    Export-PfxCertificate -Cert $trustedLocalhost -FilePath $localhostPfx -Password (ConvertTo-SecureString $existingPassword -AsPlainText -Force) | Out-Null
    # Public certificate only, used by the Owner Web development proxy for strict TLS validation.
    Export-Certificate -Cert $trustedLocalhost -FilePath (Join-Path (Split-Path -Parent $pfxPath) 'localhost.cer') | Out-Null
    Write-Output 'Browser HTTPS: using the already-trusted localhost development certificate; LAN certificate unchanged.'
} else {
    Write-Warning 'No trusted localhost development certificate found. Browser HTTPS requires explicit certificate trust; see docs/development/MOBILE_LIVE_WORKSPACE.md.'
}
$sniSettings = Get-MobileHttpsSniSettings $pfxPath $existingPassword $localhostPfx
foreach ($key in $sniSettings.Keys) { $mobileSettings[$key] = $sniSettings[$key] }
$apiProject = [xml][IO.File]::ReadAllText((Join-Path $repo 'src/backend/BHome.Api/BHome.Api.csproj'))
$secretsId = [string]$apiProject.Project.PropertyGroup.UserSecretsId
if (-not $secretsId) { throw 'API project has no UserSecretsId for Visual Studio mobile configuration.' }
$mobileSettings | ConvertTo-Json -Compress | dotnet user-secrets set --id $secretsId | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not synchronize Visual Studio mobile configuration.' }
Write-Output 'Visual Studio Development configuration synchronized. Restart debugging to apply it; do not start a second API.'
if (-not $SkipDatabase) {
    # The active persistence is Compact24. Legacy EF migrations would add the
    # retired schema to this database and cannot upgrade its property shape.
    & (Join-Path $PSScriptRoot 'Update-LocalDatabase.ps1')
}
Write-Output "API: https://${LanIp}:7240"
Write-Output "Public CA download (development only): http://${LanIp}:5240/development/mobile-ca.cer"
Write-Output 'Install and explicitly trust this CA on your iPhone; never share the .env or PFX.'
$publicCa = [Security.Cryptography.X509Certificates.X509Certificate2]::new($caPath)
Write-Output "CA thumbprint: $($publicCa.Thumbprint)"
Write-Output 'No firewall rule or trusted-root store was changed.'
