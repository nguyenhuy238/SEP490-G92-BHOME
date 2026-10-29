param([switch]$Clear, [ValidateRange(1024, 65535)][int]$Port = 8081)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$nodeVersion = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.13.0' -or [version]$nodeVersion -ge [version]'23.0.0') {
    throw 'BHOME requires Node >=22.13 and <23. Install Node 22 or use the local .tools Node 22 distribution.'
}
$repo = Split-Path -Parent $PSScriptRoot
$mobileEnv = Join-Path $repo 'src/mobile/.env.local'
if (-not (Test-Path -LiteralPath $mobileEnv)) { throw 'Start scripts/Start-OcrMobile.ps1 in another terminal first to configure the LAN API.' }
$apiUrl = [regex]::Match([IO.File]::ReadAllText($mobileEnv), '(?m)^EXPO_PUBLIC_API_BASE_URL=([^\r\n]+)').Groups[1].Value
$apiUri = $null
if (-not [Uri]::TryCreate($apiUrl, [UriKind]::Absolute, [ref]$apiUri) -or $apiUri.Scheme -ne 'https') { throw 'Mobile API must use HTTPS. Run scripts/Start-OcrMobile.ps1 first.' }
$localIps = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress)
if ($apiUri.Host -notin $localIps) { throw "Mobile API IP $($apiUri.Host) is no longer assigned to this computer. Restart scripts/Start-OcrMobile.ps1 to update the LAN IP and HTTPS certificate." }
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $apiUri.Port -ErrorAction SilentlyContinue)
if (-not ($listeners | Where-Object { $_.LocalAddress -in @('0.0.0.0', '::', $apiUri.Host) })) {
    throw "API is not listening on the LAN at $apiUrl. Run Prepare-OcrMobile.ps1 and restart Visual Studio debugging, or use Start-OcrMobile.ps1 as the only API process."
}
Write-Output "Mobile API: $apiUrl"
Write-Output "Check HTTPS in iPhone Safari first: $apiUrl/health/ready"
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Metro port $Port is already in use. Stop the previous Expo terminal with Ctrl+C, or select -Port explicitly."
}
Write-Output "Node: $nodeVersion; Expo: exp://$($apiUri.Host):$Port"
$expoArguments = @('--lan', '--port', [string]$Port)
if ($Clear) { $expoArguments += '--clear' }
Push-Location $repo
try { npm.cmd run mobile -- @expoArguments; exit $LASTEXITCODE }
finally { Pop-Location }
