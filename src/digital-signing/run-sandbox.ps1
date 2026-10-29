# Starts the signing sandbox: http://localhost:5280 (test page) and http://<LAN IP>:5280/phone.html (fake MySign app).
# Usage:  powershell -ExecutionPolicy Bypass -File src/digital-signing/run-sandbox.ps1 [-Fake | -Viettel]
#   (no switch) Auto: the real Viettel MySign once an Owner saves the Viettel account on the page, the fake one until then
#   -Fake       always the fake MySign, even with an account saved
#   -Viettel    always the real Viettel MySign (an account must be saved on the page or set in DigitalSigning__Viettel__*)
param([switch]$Fake, [switch]$Viettel)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'BHome.DigitalSigning.Sandbox'

# The repository's global.json pins the .NET 8 SDK, as for the BHome backend.
$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match '^8\.0\.' })) {
    Write-Host '.NET 8 SDK is missing. Install it once, then run this script again:' -ForegroundColor Yellow
    Write-Host '  winget install Microsoft.DotNet.SDK.8'
    exit 1
}

$env:Sandbox__Provider = if ($Fake) { 'Fake' } elseif ($Viettel) { 'Viettel' } else { 'Auto' }
Write-Host "Mode: $($env:Sandbox__Provider). Open http://localhost:5280 ; press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host "The Viettel account saved on the page is kept in $env:LOCALAPPDATA\BHome\DigitalSigningSandbox (this machine only)."
& dotnet run --project $project
