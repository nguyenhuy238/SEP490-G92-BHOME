param([string]$LanIp, [switch]$SkipDatabase)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
if (Get-NetTCPConnection -State Listen -LocalPort 7240,5240 -ErrorAction SilentlyContinue) {
    throw 'An API is already using port 7240 or 5240. Use the running Visual Studio API, or stop it before starting this standalone launcher. Prepare-OcrMobile.ps1 configures Visual Studio without starting another API.'
}
& (Join-Path $PSScriptRoot 'Prepare-OcrMobile.ps1') -LanIp $LanIp -SkipDatabase:$SkipDatabase
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../.tools/ocr-models/recognition.onnx'))) { throw 'Run scripts/Get-OcrModels.ps1 first.' }
$env:ASPNETCORE_URLS = 'https://0.0.0.0:7240;http://0.0.0.0:5240'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
# --no-launch-profile ensures the localhost-only launchSettings URL does not override the LAN binding.
$repo = Split-Path -Parent $PSScriptRoot
foreach ($line in Get-Content -LiteralPath (Join-Path $repo '.env')) {
    if ($line -match '^((ConnectionStrings|Jwt|Sessions|AuthRateLimit|AuthWeb|ObjectStorage|Jobs|Cors|Ocr|IdentityProtection|Kestrel|MobileDevelopment|Api)__[^=]+|AllowedHosts)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[3], 'Process') }
}
Push-Location $repo
try { dotnet run --project src/backend/BHome.Api --no-launch-profile; exit $LASTEXITCODE }
finally { Pop-Location }
