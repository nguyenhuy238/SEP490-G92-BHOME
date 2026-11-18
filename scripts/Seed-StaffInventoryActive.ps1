param(
    [ValidateSet('Inspect', 'Apply')][string]$Mode = 'Inspect',
    [string]$EnvironmentFile = '.env'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$seedRoot = Split-Path -Parent $PSScriptRoot
$configFile = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $seedRoot $EnvironmentFile }
if (-not (Test-Path -LiteralPath $configFile)) { throw 'Local environment file was not found.' }
$previous = @{}
Push-Location $seedRoot
try {
    foreach ($line in Get-Content -LiteralPath $configFile -Encoding UTF8) {
        if ($line -match '^((ConnectionStrings|IdentityProtection|ObjectStorage|Jwt)__[A-Za-z0-9_]+)=(.*)$') {
            $name = $Matches[1]
            $value = $Matches[3].Trim().Trim('"').Trim("'")
            if (-not $previous.ContainsKey($name)) {
                $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            }
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
    foreach ($name in @('DOTNET_ENVIRONMENT', 'BHOME_STAFF_INVENTORY_SEED_CONFIRM')) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:DOTNET_ENVIRONMENT = 'Development'
    if ($Mode -eq 'Apply') {
        $env:BHOME_STAFF_INVENTORY_SEED_CONFIRM = 'CREATE-THREE-SYNTHETIC-ACTIVE-CONTRACTS'
        $argument = '--apply'
    } else {
        $env:BHOME_STAFF_INVENTORY_SEED_CONFIRM = $null
        $argument = '--inspect'
    }
    & dotnet run --no-build --no-launch-profile --project tools/BHome.LocalDevelopment -- seed-staff-inventory-active $argument
    if ($LASTEXITCODE -ne 0) { throw 'Staff inventory fixture failed its guard or readiness checks.' }
} finally {
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
    Pop-Location
}
