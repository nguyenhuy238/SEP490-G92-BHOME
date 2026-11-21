param([string]$EnvironmentFile = '.env.neon')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
$saved = @{}
try {
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        $at = $line.IndexOf('=')
        if ($at -le 0 -or $line.StartsWith('#')) { continue }
        $name = $line.Substring(0, $at)
        if ($name -notmatch '^(ConnectionStrings__Database|Jwt__.+|IdentityProtection__.+|ObjectStorage__.+|BHOME_DEV_TEST_PASSWORD)$') { continue }
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $line.Substring($at + 1), 'Process')
    }
    foreach ($name in @('DOTNET_ENVIRONMENT', 'BHOME_DATABASE_BRANCH', 'Jobs__Enabled', 'NotificationChannels__AutomationEnabled')) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:BHOME_DATABASE_BRANCH = 'development'
    $env:Jobs__Enabled = 'false'
    $env:NotificationChannels__AutomationEnabled = 'false'
    Push-Location $repositoryRoot
    try {
        dotnet run --project tools/BHome.LocalDevelopment -- seed-shared-development-data
        $result = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
exit $result
