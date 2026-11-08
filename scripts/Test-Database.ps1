param([string]$EnvironmentFile = '.env', [switch]$Direct)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
if (-not (Test-Path -LiteralPath $path)) { throw 'Selected environment file is missing.' }
$key = if ($Direct) { 'ConnectionStrings__DatabaseDirect' } else { 'ConnectionStrings__Database' }
$connection = $null
foreach ($line in [IO.File]::ReadAllLines($path)) {
    $at = $line.IndexOf('=')
    if ($at -gt 0 -and $line.Substring(0, $at).Trim() -eq $key) {
        $connection = $line.Substring($at + 1).Trim()
        if ($connection.Length -ge 2 -and $connection[0] -in @([char]39, [char]34) -and
            $connection[0] -eq $connection[$connection.Length - 1]) {
            $connection = $connection.Substring(1, $connection.Length - 2)
        }
    }
}
if ([string]::IsNullOrWhiteSpace($connection)) { throw 'Selected connection key is missing; no connection attempted.' }
$previous = [Environment]::GetEnvironmentVariable('ConnectionStrings__Database', 'Process')
try {
    [Environment]::SetEnvironmentVariable('ConnectionStrings__Database', $connection, 'Process')
    Push-Location $repositoryRoot
    try { dotnet run --project tools/BHome.DatabaseCheck; $result = $LASTEXITCODE }
    finally { Pop-Location }
}
finally { [Environment]::SetEnvironmentVariable('ConnectionStrings__Database', $previous, 'Process') }
exit $result
