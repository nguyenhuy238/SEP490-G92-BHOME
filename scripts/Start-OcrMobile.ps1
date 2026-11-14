param([string]$LanIp, [switch]$SkipDatabase, [string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
if (Get-NetTCPConnection -State Listen -LocalPort 7240,5240 -ErrorAction SilentlyContinue) {
    throw 'An API is already using port 7240 or 5240. Use the running Visual Studio API, or stop it before starting this standalone launcher. Prepare-OcrMobile.ps1 configures Visual Studio without starting another API.'
}
& (Join-Path $PSScriptRoot 'Prepare-OcrMobile.ps1') -LanIp $LanIp -SkipDatabase:$SkipDatabase -EnvironmentFile $EnvironmentFile
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../.tools/ocr-models/recognition.onnx'))) { throw 'Run scripts/Get-OcrModels.ps1 first.' }
$env:ASPNETCORE_URLS = 'https://0.0.0.0:7240;http://0.0.0.0:5240'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
# --no-launch-profile ensures the localhost-only launchSettings URL does not override the LAN binding.
$repo = Split-Path -Parent $PSScriptRoot
# Network/TLS configuration must remain reloadable through Development user-secrets.
# Environment overrides would freeze the old AllowedHosts/certificate after switching Wi-Fi.
Get-ChildItem Env: | Where-Object { $_.Name -match '^(Kestrel__|MobileDevelopment__|AllowedHosts$)' } |
    ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
$configurationPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$env:BHOME_ENV_FILE = [IO.Path]::GetFullPath($configurationPath)
foreach ($line in Get-Content -LiteralPath $configurationPath) {
    if ($line -match '^((ConnectionStrings|Jwt|Sessions|AuthRateLimit|AuthWeb|AuthenticationEmail|Email|ObjectStorage|Jobs|Cors|BankIntegration|SePay|NotificationIntegration|NotificationChannels|OwnerSetup|ElectronicContractIntegration|Ocr|IdentityProtection|Capture|Api|MainDraft|DevelopmentDatabase|DigitalSigning|AnonymousSigning|HoldingTesting)__[^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[3], 'Process') }
}
Push-Location $repo
try { dotnet run --project src/backend/BHome.Api --no-launch-profile; exit $LASTEXITCODE }
finally { Pop-Location }
