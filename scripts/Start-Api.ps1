param([string]$EnvironmentFile = '.env')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configurationFile = if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile }
else { Join-Path $repositoryRoot $EnvironmentFile }
if (-not (Test-Path -LiteralPath $configurationFile)) { throw 'Selected environment file is missing. Run scripts/Initialize-Local.ps1 for the default .env, or use dotnet run with user-secrets.' }
$env:BHOME_ENV_FILE = $configurationFile
if (Get-Content -Encoding UTF8 -LiteralPath $configurationFile | Where-Object { $_ -match '^ASPNETCORE_ENVIRONMENT=(?!Development\s*$)' }) {
    throw 'Selected file is not a Development profile. Deploy Staging/Production through Docker Compose.'
}
# Let the API's single Development loader handle all option keys and preserve
# user-secrets/process/CLI precedence. Never launch a deployment from a local .env.
if ($env:ASPNETCORE_ENVIRONMENT -and $env:ASPNETCORE_ENVIRONMENT -ne 'Development') {
    throw 'Start-Api.ps1 is a local Development launcher. Run the published API with deployment environment variables for Staging/Production.'
}
if ($env:DOTNET_ENVIRONMENT -and $env:DOTNET_ENVIRONMENT -ne 'Development') {
    throw 'Clear DOTNET_ENVIRONMENT or set it to Development for the local launcher.'
}
$env:ASPNETCORE_ENVIRONMENT = 'Development'
Push-Location $repositoryRoot
try { dotnet run --project src/backend/BHome.Api; exit $LASTEXITCODE }
finally { Pop-Location }
