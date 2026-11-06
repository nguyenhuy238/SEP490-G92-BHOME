param([string]$EnvironmentFile = '.env', [switch]$Check, [switch]$RecreateDatabase, [switch]$UpgradePropertySchema, [switch]$InspectSchema)
$ErrorActionPreference = 'Stop'
if (@($Check, $RecreateDatabase, $UpgradePropertySchema, $InspectSchema).Where({ $_ }).Count -gt 1) { throw 'Select only one database operation.' }
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$configurationPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$line = Get-Content -LiteralPath $configurationPath | Where-Object { $_ -match '^ConnectionStrings__Database=' } | Select-Object -First 1
if (-not $line) { throw 'Selected environment file has no database connection.' }
$connectionText = $line.Substring($line.IndexOf('=') + 1)
$connection = [System.Data.Common.DbConnectionStringBuilder]::new()
try { $connection.set_ConnectionString($connectionText) }
catch { throw 'Invalid local database connection string. No configuration value printed.' }
if ([string]$connection['Host'] -notin @('localhost', '127.0.0.1', '::1') -or [string]$connection['Database'] -ne 'bhome') {
    throw 'Refusing migration: only the documented loopback development database bhome is supported.'
}
$previousConnection = $env:ConnectionStrings__Database
$previousEnvironment = $env:DOTNET_ENVIRONMENT
Push-Location $repo
try {
    $env:ConnectionStrings__Database = $connectionText
    $env:DOTNET_ENVIRONMENT = 'Development'
    # Compact24 only. Normal runs initialize empty targets; legacy archive is explicit.
    # Isolate output from the API binaries that Visual Studio may currently be using.
    $artifacts = Join-Path $repo '.tools/database-upgrade'
    # .NET 8 `dotnet run` can select stale default output with --artifacts-path.
    # Build and execute the exact isolated DLL so inspection uses current migrations.
    dotnet build tools/BHome.DatabaseUpgrade --artifacts-path $artifacts --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Local database tool build failed.' }
    $runner = Join-Path $artifacts 'bin/BHome.DatabaseUpgrade/debug/BHome.DatabaseUpgrade.dll'
    $runnerArguments = @($runner)
    if ($Check) { $runnerArguments += '--check' }
    if ($RecreateDatabase) { $runnerArguments += '--archive-legacy' }
    if ($UpgradePropertySchema) { $runnerArguments += '--upgrade-property-schema' }
    if ($InspectSchema) { $runnerArguments += '--inspect-schema' }
    & dotnet @runnerArguments
    if ($Check -and $LASTEXITCODE -eq 2) { return }
    if ($LASTEXITCODE -ne 0) { throw 'Compact24 preparation failed. Use -Check to inspect; -RecreateDatabase explicitly archives a legacy database without dropping it.' }
} finally {
    $env:ConnectionStrings__Database = $previousConnection
    $env:DOTNET_ENVIRONMENT = $previousEnvironment
    Pop-Location
}
