param(
    [string]$EnvironmentFile = '.env',
    [ValidateRange(1024,65535)][int]$Port = 5176
)

# Compatibility entry point: use develop's local HTTPS portal, never rewrite callbacks.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repository = Split-Path -Parent $PSScriptRoot
foreach ($name in @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value -and $value -ne 'Development') { throw 'This launcher only supports Development. Use the deployment runbooks for Staging/Production.' }
}
$profile = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repository $EnvironmentFile }
if (!(Test-Path -LiteralPath $profile)) { throw 'Selected local environment file is missing. Run scripts/Initialize-TeamEnvironment.ps1 first.' }
foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $profile) {
    if ($line -match '^\s*(ASPNETCORE_ENVIRONMENT|DOTNET_ENVIRONMENT|Deployment__Environment)\s*=\s*(.*)$') {
        $value = $Matches[2].Trim().Trim([char]34,[char]39)
        if ($value -and $value -ne 'Development') { throw 'Selected profile is not Development. No configuration was changed.' }
    }
}
Write-Output "Starting local HTTPS callback pages at https://localhost:$Port. Start the API separately with scripts/Start-Api.ps1 and the same local profile."
Write-Output 'Internet callbacks use the dedicated Staging deployment. Existing .env, user-secrets and provider settings are preserved.'
$previousHttps = $env:BHOME_WEB_HTTPS
$env:BHOME_WEB_HTTPS = 'true'
Push-Location (Join-Path $repository 'src/owner-web')
try {
    & npm.cmd run dev -- --host localhost --port $Port --strictPort
    if ($LASTEXITCODE -ne 0) { throw 'Local HTTPS portal failed. Check the trusted development certificate and whether the port is available.' }
} finally {
    Pop-Location
    $env:BHOME_WEB_HTTPS = $previousHttps
}
