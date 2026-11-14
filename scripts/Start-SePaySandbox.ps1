param(
    [string]$EnvironmentFile = '.env.sepay.local',
    [string]$ExistingContainer = '',
    [switch]$Seed,
    [switch]$PrepareOnly,
    [switch]$DatabaseOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$path = [IO.Path]::GetFullPath($path)
if (-not (Test-Path -LiteralPath $path)) { throw 'Run Initialize-SePaySandbox.ps1 first.' }
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($path)) {
    if ($line -match '^([A-Za-z][A-Za-z0-9_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"', "'") }
}
$connection = $settings.ConnectionStrings__Database
if ($settings.SePay__Enabled -ne 'true' -or $settings.SePay__Mode -ne 'Test' -or
    $settings.SePay__ApiBaseUrl -ne 'https://userapi-sandbox.sepay.vn/v2' -or
    $connection -notmatch '(?i)(^|;)Host=127\.0\.0\.1(;|$)' -or
    $connection -notmatch '(?i)(^|;)Database=bhome_compact24_dev_[a-f0-9]{32}(;|$)') {
    throw 'Only an enabled Test Mode profile with an isolated loopback Sandbox database is supported.'
}
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with the Linux engine first.' }
$container = if ($ExistingContainer) { $ExistingContainer } else { $settings.BHOME_SEPAY_CONTAINER_NAME }
if ($container -notmatch '^bhome-sepay-[a-z0-9-]{3,64}$') { throw 'Missing sandbox container name. For an older private profile, explicitly pass -ExistingContainer.' }
if ($ExistingContainer) {
    & docker start $container | Out-Null
} else {
    & docker compose --project-name $container --env-file $path -f (Join-Path $repo 'deploy/compose.sepay.yml') up -d --wait --wait-timeout 45
}
if ($LASTEXITCODE -ne 0) { throw 'Sandbox database could not start; check Docker and port conflicts. Existing data is retained.' }
$databaseReady = $false
$databaseUser = if ($settings.POSTGRES_USER) { $settings.POSTGRES_USER } else { 'postgres' }
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -q -t 1 -h 127.0.0.1 -U $databaseUser -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $databaseReady = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $databaseReady) { throw 'Sandbox PostgreSQL is not ready yet. No API, schema or fixture operation was started.' }
$binding = (& docker port $container 5432/tcp).Trim()
if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Sandbox PostgreSQL must be published on loopback only.' }
$port = $Matches[1]
if ($connection -notmatch '(?i)(^|;)Port=\d+(;|$)') { throw 'Sandbox profile requires an explicit database port.' }
$updated = [regex]::Replace($connection, '(?i)(^|;)Port=\d+', { param($match) $match.Groups[1].Value + 'Port=' + $port })
if ($updated -cne $connection) {
    $text = [IO.File]::ReadAllText($path).Replace('ConnectionStrings__Database=' + $settings.ConnectionStrings__Database, 'ConnectionStrings__Database=' + $updated)
    [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))
    $settings.ConnectionStrings__Database = $updated
    Write-Output 'Synchronized the private database port with the running container.'
}
if ($DatabaseOnly) { Write-Output 'Sandbox database container is running. No schema or fixture was changed.'; return }
$saved = @{}
Push-Location $repo
try {
    foreach ($name in @($settings.Keys | Where-Object { $_ -match '^(ConnectionStrings|Jwt|SePay|SePaySandbox|Jobs|NotificationChannels|OwnerSetup|ContractWorkflow|Email|AuthenticationEmail|AnonymousSigning|Cors|AuthWeb|DevelopmentDatabase|Kestrel|Api)__|^AllowedHosts$' }) + @('DOTNET_ENVIRONMENT','ASPNETCORE_ENVIRONMENT','BHOME_ENV_FILE','BHOME_DEV_TEST_PASSWORD')) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
    }
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:BHOME_ENV_FILE = $path
    if ($Seed) {
        if ([string]::IsNullOrWhiteSpace($settings.BHOME_SEPAY_FIXTURE_PASSWORD) -or $settings.BHOME_SEPAY_FIXTURE_PASSWORD -match 'replace') { throw 'Configure BHOME_SEPAY_FIXTURE_PASSWORD privately before seeding.' }
        # Execute current source, never a stale cached migration executable.
        & dotnet run --project tools/BHome.DatabaseUpgrade -c Release
        if ($LASTEXITCODE -ne 0) { throw 'Sandbox schema preparation failed; no reset or legacy replacement was requested.' }
        $env:BHOME_DEV_TEST_PASSWORD = $settings.BHOME_SEPAY_FIXTURE_PASSWORD
        & dotnet run --project tools/BHome.LocalDevelopment -c Release -- seed-sepay-sandbox
        if ($LASTEXITCODE -ne 0) { throw 'Sandbox fixture preparation failed; credential details were suppressed.' }
        $env:BHOME_DEV_TEST_PASSWORD = $null
    }
    if ($PrepareOnly) { Write-Output 'Sandbox preparation completed. The API was not started.'; return }
    Write-Output ('Starting BHOME with private Sandbox profile: ' + (Split-Path $path -Leaf))
    & dotnet run --project src/backend/BHome.Api
    if ($LASTEXITCODE -ne 0) { throw 'Sandbox API exited with an error.' }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    Pop-Location
}
