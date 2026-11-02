param([string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$seedRoot = Split-Path -Parent $PSScriptRoot
$seedConfiguration = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $seedRoot $EnvironmentFile }
$seedPrevious = @{}
Push-Location $seedRoot
try {
    foreach ($line in Get-Content -LiteralPath $seedConfiguration -Encoding UTF8) {
        if ($line -match '^((ConnectionStrings|IdentityProtection|ObjectStorage|Jwt|MainDraft)__[^=]+)=(.*)$') {
            $seedPrevious[$Matches[1]] = [Environment]::GetEnvironmentVariable($Matches[1], 'Process')
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[3], 'Process')
        }
    }
    $seedPrevious['DOTNET_ENVIRONMENT'] = $env:DOTNET_ENVIRONMENT
    $env:DOTNET_ENVIRONMENT = 'Development'
    $seedArtifacts = Join-Path $seedRoot '.tools/main-draft-settings-seed'
    dotnet build tools/BHome.LocalDevelopment --artifacts-path $seedArtifacts --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Local seed build failed.' }
    dotnet (Join-Path $seedArtifacts 'bin/BHome.LocalDevelopment/debug/BHome.LocalDevelopment.dll') seed-main-draft-settings
    if ($LASTEXITCODE -ne 0) { throw 'Local seed failed. Existing data was not reset; inspect local prerequisites.' }
} finally {
    foreach ($name in $seedPrevious.Keys) { [Environment]::SetEnvironmentVariable($name, $seedPrevious[$name], 'Process') }
    Pop-Location
}
