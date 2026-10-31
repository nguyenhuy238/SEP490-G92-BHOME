param([switch]$Clear, [ValidateRange(1024, 65535)][int]$Port = 8081)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
. (Join-Path $PSScriptRoot 'MobileNetwork.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$nodeVersion = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.13.0' -or [version]$nodeVersion -ge [version]'23.0.0') {
    throw 'BHOME requires Node >=22.13 and <23. Install Node 22 or use the local .tools Node 22 distribution.'
}
if ($Port -in @(5240,7240)) { throw 'Metro must use a different port from the API.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Metro port $Port is already in use. Stop the previous Expo terminal with Ctrl+C, or select -Port explicitly."
}
$expoCli = Join-Path $repo 'node_modules/expo/bin/cli'
if (-not (Test-Path -LiteralPath $expoCli)) { throw 'Run npm ci at the repository root first.' }
if (-not (Test-Path -LiteralPath (Join-Path $repo '.env'))) { & (Join-Path $PSScriptRoot 'Initialize-Local.ps1') }

function Assert-LocalApiProcess {
    foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort 7240,5240 -ErrorAction SilentlyContinue)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if (-not $process -or -not $process.CommandLine -or
            $process.CommandLine.IndexOf($repo, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
            $process.CommandLine -notmatch 'BHome.Api') {
            throw 'API ports belong to a different process or checkout. Stop that process before launching this checkout.'
        }
    }
}

function Stop-OwnedProcess($Process) {
    if ($Process -and -not $Process.HasExited) {
        # Only processes created by this launcher; never stop a Visual Studio API or another Metro.
        & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
    }
}

function Wait-MobileApi([string]$Address) {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        & node (Join-Path $repo 'scripts/Test-MobileApi.cjs') $Address (Join-Path $repo '.tools/mobile-tls/root-ca.cer')
        if ($LASTEXITCODE -eq 0) { return }
        if ($script:ownedApi -and $script:ownedApi.HasExited) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw 'API HTTPS readiness failed. Check the local database/storage, API logs, and Development configuration. No TLS checks were bypassed.'
}

$ownedApi = $null
$metro = $null
$previousProxy = $env:EXPO_PACKAGER_PROXY_URL
$previousServerId = $env:EXPO_PUBLIC_DEV_SERVER_ID
try {
    Assert-LocalApiProcess
    $lanIp = Get-MobileLanIp
    & (Join-Path $PSScriptRoot 'Prepare-OcrMobile.ps1') -LanIp $lanIp -SkipDatabase
    if (-not (Get-NetTCPConnection -State Listen -LocalPort 7240 -ErrorAction SilentlyContinue)) {
        $apiLauncher = Join-Path $PSScriptRoot 'Start-OcrMobile.ps1'
        $ownedApi = Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $repo -PassThru -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $apiLauncher + '"'), '-SkipDatabase'
        ) -RedirectStandardOutput (Join-Path $repo '.tools/mobile-dev-api.stdout.log') -RedirectStandardError (Join-Path $repo '.tools/mobile-dev-api.stderr.log')
    }
    Wait-MobileApi $lanIp
    while ($true) {
        # Public CA fingerprint distinguishes developer machines even if DHCP reuses the same IP.
        $env:EXPO_PUBLIC_DEV_SERVER_ID = Get-MobileDevelopmentServerId (Join-Path $repo '.tools/mobile-tls/root-ca.cer')
        $env:EXPO_PACKAGER_PROXY_URL = "http://${lanIp}:$Port"
        Write-Output "API: https://${lanIp}:7240; Expo: exp://${lanIp}:$Port"
        Write-Output 'Scan the QR/open the Expo URL. Network changes are detected automatically; scan the new QR after switching networks.'
        $expoLauncher = Join-Path $repo 'scripts/Start-ExpoMobile.cjs'
        $expoArguments = @(('"' + $expoLauncher + '"'), '--metro-only', '--lan', '--port', [string]$Port)
        if ($Clear) { $expoArguments += '--clear' }
        # Reuse this interactive terminal so the developer can read the Expo QR and use its controls.
        $metro = Start-Process (Get-Command node.exe).Source -NoNewWindow -PassThru -WorkingDirectory (Join-Path $repo 'src/mobile') -ArgumentList $expoArguments
        $networkChanged = $false
        while (-not $metro.WaitForExit(3000)) {
            try { $currentIp = Get-MobileLanIp }
            catch { continue } # A brief Wi-Fi disconnect is not a reason to stop API/Metro.
            if ($currentIp -eq $lanIp) { continue }
            Write-Output "LAN changed: $lanIp -> $currentIp. Updating HTTPS and Expo automatically."
            Stop-OwnedProcess $metro
            & (Join-Path $PSScriptRoot 'Prepare-OcrMobile.ps1') -LanIp $currentIp -SkipDatabase
            Wait-MobileApi $currentIp
            $lanIp = $currentIp
            $networkChanged = $true
            $Clear = $false
            break
        }
        if (-not $networkChanged) { exit $metro.ExitCode }
    }
} finally {
    Stop-OwnedProcess $metro
    Stop-OwnedProcess $ownedApi
    $env:EXPO_PACKAGER_PROXY_URL = $previousProxy
    $env:EXPO_PUBLIC_DEV_SERVER_ID = $previousServerId
}
