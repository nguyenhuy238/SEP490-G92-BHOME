param([string]$EnvironmentFile = '.env.neon', [switch]$Apply)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
$line = [IO.File]::ReadAllLines($path) | Where-Object { $_.StartsWith('ConnectionStrings__DatabaseDirect=') } | Select-Object -First 1
if (-not $line) { throw 'The selected local profile has no verified direct connection.' }
$savedConnection = $env:BHOME_COMPACT24_DIRECT
$savedBranch = $env:BHOME_DATABASE_BRANCH
try {
    $env:BHOME_COMPACT24_DIRECT = $line.Substring('ConnectionStrings__DatabaseDirect='.Length)
    $env:BHOME_DATABASE_BRANCH = 'development'
    Push-Location $repositoryRoot
    try {
        if ($Apply) {
            # Only a designated operator with recorded schema approval uses -Apply.
            dotnet ef database update --context Compact24DbContext --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
        } else {
            dotnet ef migrations list --context Compact24DbContext --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
        }
        $result = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:BHOME_COMPACT24_DIRECT = $savedConnection
    $env:BHOME_DATABASE_BRANCH = $savedBranch
}
exit $result
