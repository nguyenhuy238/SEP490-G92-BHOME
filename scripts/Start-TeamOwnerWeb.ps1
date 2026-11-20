# Start one of the two local Owner Web listeners in a separate terminal.
param([switch]$SigningHttps)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$env:BHOME_WEB_HTTPS = if ($SigningHttps) { 'true' } else { 'false' }
$port = if ($SigningHttps) { '5176' } else { '5173' }
Push-Location $repositoryRoot
try {
    & npm.cmd run dev --workspace ./src/owner-web -- --host localhost --port $port --strictPort
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
