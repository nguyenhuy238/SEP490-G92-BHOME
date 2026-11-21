param(
    [string]$SteroidsPath = 'D:\steroi\chat-on-steroids',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$bhomePath = Split-Path -Parent $PSScriptRoot
$ownerWebPath = Join-Path $bhomePath 'src/owner-web'

. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')

function Assert-AvailablePort([int]$Port, [string]$Service) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return }

    $occupant = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $description = if ($occupant) { "$($occupant.ProcessName) (PID $($listener.OwningProcess))" } else { "PID $($listener.OwningProcess)" }
    throw "Cannot start $Service`: port $Port is already used by $description. Close the existing service first."
}

function Wait-HttpReady(
    [string]$Service,
    [string]$Address,
    [int]$TimeoutSeconds,
    [System.Diagnostics.Process]$Console,
    [string]$ExpectedBody = ''
) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Console.HasExited) { throw "$Service terminal exited before $Address became ready." }
        try {
            $result = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 3
            if ($result.StatusCode -eq 200 -and
                (-not $ExpectedBody -or $result.Content -match [regex]::Escape($ExpectedBody))) {
                Write-Host "$Service ready: $Address" -ForegroundColor Green
                return
            }
        } catch {
            # The dev process can be running while its HTTP listener is still starting.
        }
        Start-Sleep -Seconds 2
    }
    throw "$Service did not become ready at $Address. Check its separate terminal for the startup error."
}

function Start-DevConsole([string]$WorkingDirectory, [string]$Command) {
    # /k keeps the window and its error output visible if npm exits unexpectedly.
    return Start-Process -FilePath $env:ComSpec -ArgumentList @('/k', $Command) -WorkingDirectory $WorkingDirectory -PassThru
}

if (-not (Test-Path -LiteralPath (Join-Path $bhomePath 'scripts/Start-OcrMobileApp.ps1'))) {
    throw 'BHOME mobile launcher is missing.'
}
if (-not (Test-Path -LiteralPath (Join-Path $ownerWebPath 'package.json'))) {
    throw 'BHOME Owner Web package.json is missing.'
}
if (-not (Test-Path -LiteralPath (Join-Path $SteroidsPath 'package.json'))) {
    throw "Chat On Steroids was not found at '$SteroidsPath'. Supply -SteroidsPath with its actual directory."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd is unavailable. Install Node.js 22/npm, or configure the BHOME local tools.'
}

$SteroidsPath = (Resolve-Path -LiteralPath $SteroidsPath).ProviderPath
$steroidsPackage = Get-Content -LiteralPath (Join-Path $SteroidsPath 'package.json') -Raw | ConvertFrom-Json
if ($steroidsPackage.scripts.dev -notmatch 'electron-vite\s+dev') {
    throw "The package at '$SteroidsPath' does not have the expected electron-vite dev script."
}

# The mobile launcher manages API 7240/5240 itself and can reuse the current
# BHOME API (including one started from Visual Studio). Do not launch another API.
Assert-AvailablePort 8081 'Expo Metro'
Assert-AvailablePort 5173 'Owner Web'
Assert-AvailablePort 5174 'Chat On Steroids'

if ($CheckOnly) {
    Write-Host 'All requested frontend ports are free. No processes were started.' -ForegroundColor Green
    Write-Host 'Mobile: 8081 (API: 7240); Owner Web: 5173; Chat On Steroids: 5174'
    return
}

Write-Host '[1/3] Starting BHOME Mobile / API...' -ForegroundColor Cyan
$mobileConsole = Start-DevConsole $bhomePath 'npm.cmd run mobile:dev'
Wait-HttpReady 'Expo Metro' 'http://127.0.0.1:8081/status' 420 $mobileConsole 'packager-status:running'

Write-Host '[2/3] Starting BHOME Owner Web on port 5173...' -ForegroundColor Cyan
Assert-AvailablePort 5173 'Owner Web'
$ownerConsole = Start-DevConsole $ownerWebPath 'npm.cmd run dev -- --port 5173 --strictPort'
Wait-HttpReady 'Owner Web' 'http://localhost:5173/' 120 $ownerConsole

# electron-vite picks the next free Vite port. With Owner Web already on 5173,
# Steroids receives 5174. electron-vite itself has no --port CLI option.
Write-Host '[3/3] Starting Chat On Steroids on port 5174...' -ForegroundColor Cyan
Assert-AvailablePort 5174 'Chat On Steroids'
$steroidsConsole = Start-DevConsole $SteroidsPath 'npm.cmd run dev'
Wait-HttpReady 'Chat On Steroids' 'http://localhost:5174/' 180 $steroidsConsole

Write-Host 'All three dev services are running in separate terminals.' -ForegroundColor Green
Write-Host 'Expo: http://localhost:8081 | Owner Web: http://localhost:5173 | Steroids: http://localhost:5174'
Write-Host 'Stop a service with Ctrl+C in its own terminal.'
