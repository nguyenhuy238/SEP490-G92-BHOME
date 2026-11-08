param([string]$EnvironmentFile = '.env.neon')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
$line = [IO.File]::ReadAllLines($path) | Where-Object { $_.StartsWith('ConnectionStrings__DatabaseDirect=') } | Select-Object -First 1
if (-not $line) { throw 'The operator profile has no verified direct connection.' }
$savedConnection = $env:BHOME_COMPACT24_DIRECT
$savedDirectory = $env:BHOME_DEVELOPMENT_CREDENTIAL_DIRECTORY
try {
    $env:BHOME_COMPACT24_DIRECT = $line.Substring('ConnectionStrings__DatabaseDirect='.Length)
    # Always ignored; the command never prints or overwrites existing developer passwords.
    $env:BHOME_DEVELOPMENT_CREDENTIAL_DIRECTORY = Join-Path $repositoryRoot '.tools/neon-integration/developer-credentials'
    Push-Location $repositoryRoot
    try {
        dotnet run --project tools/BHome.LocalDevelopment -- provision-shared-development-roles
        $result = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:BHOME_COMPACT24_DIRECT = $savedConnection
    $env:BHOME_DEVELOPMENT_CREDENTIAL_DIRECTORY = $savedDirectory
}
exit $result
