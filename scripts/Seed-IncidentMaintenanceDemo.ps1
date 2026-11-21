[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$EnvironmentFile)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$saved = @{}
try {
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        if ($line -match '^([A-Za-z][A-Za-z0-9_-]+)=(.*)$') {
            $name = $Matches[1]
            $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $Matches[2], 'Process')
        }
    }
    if (-not $saved.ContainsKey('DOTNET_ENVIRONMENT')) { $saved['DOTNET_ENVIRONMENT'] = $env:DOTNET_ENVIRONMENT }
    $env:DOTNET_ENVIRONMENT = 'Development'
    if (-not $env:BHOME_MAINTENANCE_DEMO_PASSWORD) { throw 'Set BHOME_MAINTENANCE_DEMO_PASSWORD for synthetic demo accounts.' }
    Push-Location $repo
    try {
        & dotnet run --project tools/BHome.LocalDevelopment -c Release -- seed-maintenance-demo
        if ($LASTEXITCODE -ne 0) { throw 'Maintenance demo seed failed. Existing data is preserved.' }
    }
    finally { Pop-Location }
}
finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
