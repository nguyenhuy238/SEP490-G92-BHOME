# Starts the signing sandbox: http://localhost:5280 (test page) and http://<LAN IP>:5280/phone.html (fake MySign app).
# Usage:  powershell -ExecutionPolicy Bypass -File src/digital-signing/run-sandbox.ps1 [-Viettel]
param([switch]$Viettel)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'BHome.DigitalSigning.Sandbox'

# The repository's global.json pins the .NET 8 SDK, as for the BHome backend.
$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match '^8\.0\.' })) {
    Write-Host '.NET 8 SDK is missing. Install it once, then run this script again:' -ForegroundColor Yellow
    Write-Host '  winget install Microsoft.DotNet.SDK.8'
    exit 1
}

if ($Viettel) {
    # Real Viettel MySign: client id/secret come from the environment, never from a committed file.
    if (-not $env:DigitalSigning__Viettel__ClientId -or -not $env:DigitalSigning__Viettel__ClientSecret) {
        Write-Host 'Set DigitalSigning__Viettel__ClientId and DigitalSigning__Viettel__ClientSecret first.' -ForegroundColor Yellow
        exit 1
    }
    $env:Sandbox__Provider = 'Viettel'
} else {
    $env:Sandbox__Provider = 'Fake'
}

Write-Host "Mode: $($env:Sandbox__Provider). Open http://localhost:5280 ; press Ctrl+C to stop." -ForegroundColor Cyan
& dotnet run --project $project
