# Restore the existing private local storage service without touching databases or volumes.
param([string]$EnvironmentFile = '.env', [switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$profile = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
if (-not (Test-Path -LiteralPath $profile)) { throw 'Missing local environment file. Run scripts/Initialize-Local.ps1 first.' }
$settings = @{}
foreach ($line in Get-Content -LiteralPath $profile -Encoding UTF8) {
    if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim([char]34, [char]39) }
}
foreach ($environment in @($settings['ASPNETCORE_ENVIRONMENT'], $settings['DOTNET_ENVIRONMENT'], $env:ASPNETCORE_ENVIRONMENT, $env:DOTNET_ENVIRONMENT)) {
    if ($environment -and $environment -ne 'Development') { throw 'Local storage recovery is only allowed in Development.' }
}
$endpoint = $settings['ObjectStorage__Endpoint']
if (-not $endpoint) { throw 'ObjectStorage__Endpoint is missing; no configuration was changed.' }
$ssl = $settings['ObjectStorage__UseSsl'] -eq 'true'
$scheme = if ($ssl) { 'https' } else { 'http' }
$address = $null
if (-not [Uri]::TryCreate("${scheme}://$endpoint", [UriKind]::Absolute, [ref]$address) -or
    -not $address.IsLoopback -or $address.UserInfo -or $address.AbsolutePath -ne '/' -or $address.Query -or $address.Fragment) {
    throw 'This command only manages loopback MinIO. Remote storage is never modified.'
}
$port = if ($settings['MINIO_API_PORT']) { [int]$settings['MINIO_API_PORT'] } else { 9000 }
if ($ssl -or $address.Port -ne $port) { throw 'The local Compose MinIO HTTP port does not match the storage profile. No TLS or configuration settings were changed.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is unavailable. Install/start Docker Desktop with its Linux engine.' }
function Test-StorageReady {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri ($address.GetLeftPart([UriPartial]::Authority) + '/minio/health/live') -TimeoutSec 3).StatusCode -eq 200 }
    catch { return $false }
}
function Test-DockerReady {
    # Docker writes unavailable-daemon diagnostics to stderr; that must not abort
    # PowerShell before the recovery branch can run.
    & $env:ComSpec /d /c 'docker info --format "{{.ServerVersion}}" >nul 2>&1'
    return $LASTEXITCODE -eq 0
}
if ($CheckOnly) {
    if (-not (Test-StorageReady)) { throw 'Local MinIO is unavailable. Run npm.cmd run storage:dev before uploading files.' }
    Write-Output 'Local MinIO HTTP health: PASS. Bucket permissions and upload persistence require the storage smoke check.'
    return
}
if (-not (Test-DockerReady)) {
    & docker desktop start --detach
    if ($LASTEXITCODE -ne 0) { throw 'Cannot start Docker Desktop. Start its Linux engine and run storage:dev again.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Seconds 2
        if (Test-DockerReady) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not (Test-DockerReady)) { throw 'Docker Linux engine did not become ready. Existing storage data was preserved.' }
}
Push-Location $repositoryRoot
try {
    # No down/reset, no database service, no image rebuild or credential output.
    $previousErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & docker compose --env-file $profile up -d --no-deps --no-build --pull never minio *> $null
        $startCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorPreference }
    if ($startCode -ne 0) { throw 'Cannot start the existing MinIO service. Build deploy/docker/Minio.Dockerfile if its image is missing; no volumes were removed.' }
} finally { Pop-Location }
$deadline = [DateTime]::UtcNow.AddSeconds(60)
while (-not (Test-StorageReady)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'MinIO did not become healthy. Check Docker Desktop; do not delete or reset its volume.' }
    Start-Sleep -Seconds 2
}
Write-Output 'Local MinIO is ready. Existing private files, credentials and database settings were preserved. Retry the upload, then publish the saved draft when approved.'
