param(
    [string]$Filter = 'FullyQualifiedName~Compact24OwnerSetupTests',
    [string]$ResultsDirectory = (Join-Path $env:TEMP 'bhome-configuration-tests'),
    [string]$TestProject = '',
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Debug'
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
if (-not $TestProject) { $TestProject = Join-Path $repository 'tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj' }
$TestProject = (Resolve-Path -LiteralPath $TestProject).Path
$container = 'bhome-config-test-' + [Guid]::NewGuid().ToString('N')
$previousAdmin = $env:BHOME_COMPACT24_TEST_ADMIN
$previousPassword = $env:POSTGRES_PASSWORD
$exitCode = 1
try {
    & docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker must be running for isolated Compact24 tests.' }
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $env:POSTGRES_PASSWORD = [Convert]::ToBase64String($bytes)
    & docker run --detach --name $container --label bhome.configuration-tests=disposable --publish '127.0.0.1::5432' --env POSTGRES_PASSWORD postgres:16-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the dedicated PostgreSQL test container.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        & docker exec $container pg_isready -U postgres -d postgres *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Dedicated PostgreSQL test instance did not become ready.' }
    $binding = & docker port $container 5432/tcp
    if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Expected a dedicated loopback port binding.' }
    $env:BHOME_COMPACT24_TEST_ADMIN = 'Host=127.0.0.1;Port=' + $Matches[1] + ';Database=postgres;Username=postgres;Password=' + $env:POSTGRES_PASSWORD
    Write-Host 'Running against disposable PostgreSQL; no working database configuration is used.'
    & dotnet test $TestProject --configuration $Configuration --no-restore --filter $Filter --logger 'trx' --results-directory $ResultsDirectory --verbosity minimal
    $exitCode = $LASTEXITCODE
} finally {
    $env:BHOME_COMPACT24_TEST_ADMIN = $previousAdmin
    $env:POSTGRES_PASSWORD = $previousPassword
    if ($container -match '^bhome-config-test-[a-f0-9]{32}$') {
        $inspection = & docker inspect $container 2>$null | ConvertFrom-Json
        $label = $inspection[0].Config.Labels.'bhome.configuration-tests'
        if ($LASTEXITCODE -eq 0 -and $label -eq 'disposable') { & docker rm --force --volumes $container | Out-Null }
    }
}
exit $exitCode
