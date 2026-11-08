param([switch]$Preview)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$previousDatabase = $env:ConnectionStrings__Database
$previousEnvironment = $env:DOTNET_ENVIRONMENT
$result = 1
try {
    $line = Get-Content -LiteralPath (Join-Path $repositoryRoot '.env') -Encoding UTF8 |
        Where-Object { $_ -like 'ConnectionStrings__Database=*' } | Select-Object -First 1
    if (-not $line) { throw 'Missing local database configuration.' }
    $env:ConnectionStrings__Database = $line.Substring('ConnectionStrings__Database='.Length)
    $env:DOTNET_ENVIRONMENT = 'Development'
    Push-Location $repositoryRoot
    try {
        $seedArguments = @('run', '--project', 'tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj', '--', 'seed-notification-inbox')
        if ($Preview) { $seedArguments += '--preview' }
        & dotnet @seedArguments
        $result = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:ConnectionStrings__Database = $previousDatabase
    $env:DOTNET_ENVIRONMENT = $previousEnvironment
}
exit $result
