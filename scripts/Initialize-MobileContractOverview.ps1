param([string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$configPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$previous = @{}
Push-Location $repo
try {
    foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
        if ($line -match '^([A-Za-z][A-Za-z0-9_]*__[A-Za-z0-9_]+)=(.*)$') {
            $key = $Matches[1]
            $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $Matches[2], 'Process')
        }
    }
    $previous['DOTNET_ENVIRONMENT'] = $env:DOTNET_ENVIRONMENT
    $env:DOTNET_ENVIRONMENT = 'Development'
    $artifacts = Join-Path $repo '.tools/mobile-contract-overview-build'
    dotnet build tools/BHome.LocalDevelopment --artifacts-path $artifacts --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Contract overview seed build failed.' }
    & dotnet (Join-Path $artifacts 'bin/BHome.LocalDevelopment/debug/BHome.LocalDevelopment.dll') seed-mobile-contract-overview
    if ($LASTEXITCODE -ne 0) { throw 'Contract overview seed failed; no partial database changes committed.' }
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    Pop-Location
}
