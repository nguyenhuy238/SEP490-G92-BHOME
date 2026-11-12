param([switch]$Clear, [ValidateRange(1024, 65535)][int]$Port = 8081, [switch]$LanApi, [switch]$HostnameApi, [string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
. (Join-Path $PSScriptRoot 'MobileNetwork.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$nodeVersion = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.13.0' -or [version]$nodeVersion -ge [version]'23.0.0') {
    throw 'BHOME requires Node >=22.13 and <23. Install Node 22 or use the local .tools Node 22 distribution.'
}
if ($Port -in @(5240,7240)) { throw 'Metro must use a different port from the API.' }
if ($LanApi -and $HostnameApi) { throw 'Choose either LAN API or hostname API.' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Metro port $Port is already in use. Stop the previous Expo terminal with Ctrl+C, or select -Port explicitly."
}
$expoCli = Join-Path $repo 'node_modules/expo/bin/cli'
if (-not (Test-Path -LiteralPath $expoCli)) { throw 'Run npm ci at the repository root first.' }
$configurationPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
if (-not (Test-Path -LiteralPath $configurationPath)) {
    if ($EnvironmentFile -eq '.env') { & (Join-Path $PSScriptRoot 'Initialize-Local.ps1') }
    else { throw 'Selected environment file is missing.' }
}
$EnvironmentFile = [IO.Path]::GetFullPath($configurationPath)
Write-Output "Backend environment file: $EnvironmentFile"

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

function Get-CheckoutApiProcess {
    # A debugger can pause startup before Kestrel binds either port. Port checks
    # alone must not launch a second API against the same database/checkout.
    Get-CimInstance Win32_Process -Filter "Name = 'BHome.Api.exe' OR Name = 'dotnet.exe'" | Where-Object {
        $identity = $_.CommandLine + ' ' + $_.ExecutablePath
        $identity.IndexOf($repo, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $identity -match 'BHome\.Api(?:\.dll|\.exe)?(?:\s|"|$)'
    } | Select-Object -First 1
}

function Stop-OwnedProcess($Process) {
    if ($Process -and -not $Process.HasExited) {
        # Only processes created by this launcher; never stop a Visual Studio API or another Metro.
        & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
    }
}

function Wait-MobileApi([string]$Address) {
    $deadline = (Get-Date).AddSeconds(120)
    Write-Output 'Waiting for API HTTPS readiness (up to 120 seconds; 15 seconds per request).'
    do {
        & node (Join-Path $repo 'scripts/Test-MobileApi.cjs') $Address (Join-Path $repo '.tools/mobile-tls/root-ca.cer') $Address 15000
        if ($LASTEXITCODE -eq 0) { return }
        if ($script:ownedApi -and $script:ownedApi.HasExited) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    # Diagnose the API that was actually probed. Logs from a previous standalone run
    # can be stale when this launcher reuses a Visual Studio API.
    & node (Join-Path $repo 'scripts/Diagnose-MobileApi.cjs') "https://${Address}:7240" (Join-Path $repo '.tools/mobile-tls/root-ca.cer')
    $logHint = if ($script:ownedApi) { 'Check .tools/mobile-dev-api.stdout.log and .tools/mobile-dev-api.stderr.log.' } else { 'Check the running API/Visual Studio output; .tools/mobile-dev-api logs belong to earlier standalone runs.' }
    $connectionHint = if (Get-NetTCPConnection -State Listen -LocalPort 7240 -ErrorAction SilentlyContinue) {
        'API port 7240 is listening. Check the HTTP status, TLS diagnosis and readiness timeout above.'
    } else { 'No API HTTPS listener on port 7240 (ECONNREFUSED). Check startup exceptions or a paused debugger.' }
    throw "API HTTPS readiness failed. $connectionHint $logHint Read-only database check for the selected profile: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile `"$EnvironmentFile`". No TLS checks were bypassed."
}

function Wait-MobileMetro([string]$Address) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        & node (Join-Path $repo 'scripts/Test-ExpoMobile.cjs') $Address $Port
        if ($LASTEXITCODE -eq 0) { return }
        if ($script:metro.HasExited) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Metro status/iOS manifest failed at http://${Address}:$Port. Check the Expo terminal; API readiness alone does not mean the app can load."
}

$ownedApi = $null
$metro = $null
$previousProxy = $env:EXPO_PACKAGER_PROXY_URL
$previousServerId = $env:EXPO_PUBLIC_DEV_SERVER_ID
$previousDevelopmentUrl = $env:EXPO_PUBLIC_DEV_API_BASE_URL
try {
    Assert-LocalApiProcess
    if ((Get-CheckoutApiProcess) -or (Get-NetTCPConnection -State Listen -LocalPort 7240 -ErrorAction SilentlyContinue)) {
        Write-Warning 'Reusing an existing API. Its environment file cannot be changed while running. To switch databases, stop that API and restart this command.'
    }
    $lanIp = Get-MobileLanIp
    $missingModels = @('detection.onnx', 'recognition.onnx', 'charset.txt') | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $repo ".tools/ocr-models/$_"))
    }
    if ($missingModels) {
        Write-Output 'Preparing missing OCR models for this workstation (verified download, first run only).'
        & (Join-Path $PSScriptRoot 'Get-OcrModels.ps1')
    }
    & (Join-Path $PSScriptRoot 'Prepare-OcrMobile.ps1') -LanIp $lanIp -SkipDatabase -EnvironmentFile $EnvironmentFile
    if (-not (Get-NetTCPConnection -State Listen -LocalPort 7240 -ErrorAction SilentlyContinue)) {
        if (Get-CheckoutApiProcess) {
            Write-Output 'An API process from this checkout is starting or paused before opening HTTPS. Continue/check Visual Studio startup output; waiting without starting a second API.'
        } else {
            $apiLauncher = Join-Path $PSScriptRoot 'Start-OcrMobile.ps1'
            $ownedApi = Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $repo -PassThru -ArgumentList @(
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $apiLauncher + '"'), '-SkipDatabase', '-EnvironmentFile', ('"' + $EnvironmentFile + '"')
            ) -RedirectStandardOutput (Join-Path $repo '.tools/mobile-dev-api.stdout.log') -RedirectStandardError (Join-Path $repo '.tools/mobile-dev-api.stderr.log')
        }
    }
    Wait-MobileApi $lanIp
    while ($true) {
        # Public CA fingerprint distinguishes developer machines even if DHCP reuses the same IP.
        $env:EXPO_PUBLIC_DEV_SERVER_ID = Get-MobileDevelopmentServerId (Join-Path $repo '.tools/mobile-tls/root-ca.cer')
        $apiHost = $lanIp
        # A Windows hostname self-probe cannot establish iPhone mDNS support.
        # Keep LAN IPv4 as the default; hostname mode requires an explicit choice.
        if ($HostnameApi) {
            $developmentHost = Get-MobileDevelopmentHost
            if ($developmentHost) {
                & node (Join-Path $repo 'scripts/Test-MobileApi.cjs') $developmentHost (Join-Path $repo '.tools/mobile-tls/root-ca.cer') $lanIp
                if ($LASTEXITCODE -eq 0) { $apiHost = $developmentHost }
                else { Write-Warning 'Local hostname is not reachable at this LAN IP with valid HTTPS. Using the current LAN IP automatically.' }
            }
        }
        $env:EXPO_PUBLIC_DEV_API_BASE_URL = "https://${apiHost}:7240"
        $env:EXPO_PACKAGER_PROXY_URL = "http://${lanIp}:$Port"
        Write-Output "API: https://${lanIp}:7240; Expo: exp://${lanIp}:$Port"
        Write-Output "API checked from this computer: $env:EXPO_PUBLIC_DEV_API_BASE_URL"
        Write-Output 'Scan the QR/open the Expo URL. Use the new QR when reloading Expo on a new network.'
        $expoLauncher = Join-Path $repo 'scripts/Start-ExpoMobile.cjs'
        $expoArguments = @(('"' + $expoLauncher + '"'), '--metro-only', '--lan', '--port', [string]$Port)
        if ($Clear) { $expoArguments += '--clear' }
        # Reuse this interactive terminal so the developer can read the Expo QR and use its controls.
        $metro = Start-Process (Get-Command node.exe).Source -NoNewWindow -PassThru -WorkingDirectory (Join-Path $repo 'src/mobile') -ArgumentList $expoArguments
        Wait-MobileMetro $lanIp
        Write-Output "Metro status/iOS manifest OK from this computer. On iPhone Safari, test http://${lanIp}:$Port/status (expected: packager-status:running)."
        Write-Output 'Desktop probes do not confirm phone connectivity. If Safari fails, check Expo Go Local Network permission and router/device isolation.'
        $deviceSeen = $false
        $networkChanged = $false
        while (-not $metro.WaitForExit(3000)) {
            if (-not $deviceSeen) {
                $peer = Get-NetTCPConnection -State Established -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object {
                    ($_.RemoteAddress -replace '^::ffff:', '') -notin @('127.0.0.1', '::1', $lanIp)
                } | Select-Object -First 1
                if ($peer) {
                    $deviceSeen = $true
                    Write-Output 'Metro received a TCP connection from another device. Wait for iOS Bundled to confirm JavaScript transfer.'
                }
            }
            try { $currentIp = Get-MobileLanIp }
            catch { continue } # A brief Wi-Fi disconnect is not a reason to stop API/Metro.
            if ($currentIp -eq $lanIp) { continue }
            Write-Output "LAN changed: $lanIp -> $currentIp. Updating HTTPS and Expo automatically."
            Stop-OwnedProcess $metro
            & (Join-Path $PSScriptRoot 'Prepare-OcrMobile.ps1') -LanIp $currentIp -SkipDatabase -EnvironmentFile $EnvironmentFile
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
    $env:EXPO_PUBLIC_DEV_API_BASE_URL = $previousDevelopmentUrl
}
