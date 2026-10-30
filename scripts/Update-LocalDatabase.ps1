param([string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
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
Push-Location $repo
try {
    $env:ConnectionStrings__Database = $connectionText
    # The guarded runner applies all migrations in one transaction; no API/user-secrets startup.
    dotnet run --project tools/BHome.DatabaseUpgrade
    if ($LASTEXITCODE -ne 0) { throw 'Local migration failed. Do not reset/drop the database; inspect the migration error.' }
} finally {
    $env:ConnectionStrings__Database = $previousConnection
    Pop-Location
}
