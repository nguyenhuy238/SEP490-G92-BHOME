param([string]$EnvironmentFile = '.env')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configurationFile = if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile }
else { Join-Path $repositoryRoot $EnvironmentFile }
if (-not (Test-Path -LiteralPath $configurationFile)) { throw 'Selected environment file is missing. Run scripts/Initialize-Local.ps1 for the default .env, or use dotnet run with user-secrets.' }
foreach ($line in Get-Content -LiteralPath $configurationFile) {
    if ($line -match '^((ConnectionStrings|Jwt|Sessions|AuthRateLimit|AuthWeb|ObjectStorage|Jobs|Cors|BankIntegration|NotificationIntegration|ElectronicContractIntegration|Ocr|IdentityProtection|Capture|Kestrel|MobileDevelopment|Api)__[^=]+|AllowedHosts)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[3], 'Process')
    }
}
Push-Location $repositoryRoot
try { dotnet run --project src/backend/BHome.Api; exit $LASTEXITCODE }
finally { Pop-Location }
