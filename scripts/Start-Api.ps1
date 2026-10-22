$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot '.env'
if (-not (Test-Path -LiteralPath $environmentFile)) { throw 'Run scripts/Initialize-Local.ps1 first, or use dotnet run with user-secrets instead.' }
foreach ($line in Get-Content -LiteralPath $environmentFile) {
    if ($line -match '^((ConnectionStrings|Jwt|ObjectStorage|Jobs|Cors|BankIntegration|NotificationIntegration|ElectronicContractIntegration)__[^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[3], 'Process')
    }
}
Push-Location $repositoryRoot
try { dotnet run --project src/backend/BHome.Api; exit $LASTEXITCODE }
finally { Pop-Location }
