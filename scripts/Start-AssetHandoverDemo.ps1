param(
    [ValidateSet('Start', 'Api', 'Owner', 'Mobile')][string]$Mode = 'Start',
    [string]$SessionFile,
    [int]$ApiPort = 5280,
    [int]$OwnerPort = 5281,
    [int]$MobilePort = 5282
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
if ($Mode -ne 'Start') {
    $session = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
    foreach ($item in $session.environment.PSObject.Properties) { [Environment]::SetEnvironmentVariable($item.Name, [string]$item.Value, 'Process') }
    switch ($Mode) {
        Api {
            # Testing avoids workstation-specific Development Kestrel endpoints and .env files.
            $env:ASPNETCORE_ENVIRONMENT = 'Testing'; $env:DOTNET_ENVIRONMENT = 'Testing'
            & dotnet run --no-build -c Release --no-launch-profile --project src/backend/BHome.Api --urls "https://localhost:$($session.apiPort)"
        }
        Owner { & npm.cmd run dev --workspace src/owner-web -- --host 127.0.0.1 --port $session.ownerPort --strictPort }
        Mobile { Push-Location src/mobile; try { & npx.cmd --no-install expo start --web --port $session.mobilePort } finally { Pop-Location } }
    }
    exit $LASTEXITCODE
}
foreach ($port in @($ApiPort, $OwnerPort, $MobilePort)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is in use; choose different demo ports. No existing process was stopped." }
}
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop before running this isolated demo.' }
function New-DemoSecret {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes); return 'Demo!1' + [Convert]::ToBase64String($bytes) } finally { $random.Dispose() }
}
$suffix = [Guid]::NewGuid().ToString('N')
$database = 'bhome_compact24_' + $suffix
$pgName = 'bhome-handover-pg-' + $suffix.Substring(0, 8)
$minioName = 'bhome-handover-files-' + $suffix.Substring(0, 8)
$password = New-DemoSecret
$pgPassword = New-DemoSecret
$minioPassword = New-DemoSecret
$directory = Join-Path $repo '.tmp/handover-demo'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$pfxPassword = New-DemoSecret
$pfxFile = Join-Path $directory ('api-' + $suffix + '.pfx')
$caFile = Join-Path $directory ('api-' + $suffix + '.cer')
& dotnet dev-certs https --export-path $pfxFile --password $pfxPassword *> (Join-Path $directory 'certificate.log')
if ($LASTEXITCODE -ne 0) { throw 'Cannot export the localhost development certificate; inspect certificate.log.' }
$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($pfxFile, $pfxPassword)
try { [IO.File]::WriteAllBytes($caFile, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)) } finally { $certificate.Dispose() }
& docker run -d --name $pgName -e POSTGRES_USER=bhome_demo -e "POSTGRES_PASSWORD=$pgPassword" -e POSTGRES_DB=postgres -p '127.0.0.1::5432' postgres:16-alpine | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot start disposable PostgreSQL.' }
& docker run -d --name $minioName -e MINIO_ROOT_USER=bhome-demo -e "MINIO_ROOT_PASSWORD=$minioPassword" -p '127.0.0.1::9000' bhome/minio-local:2025-10-15 server /data | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot start disposable MinIO. Build deploy/docker/Minio.Dockerfile with tag bhome/minio-local:2025-10-15 first.' }
$pgPort = ((& docker port $pgName 5432) -split ':')[-1]
$filesPort = ((& docker port $minioName 9000) -split ':')[-1]
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $pgName pg_isready -U bhome_demo -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (!$ready) { throw 'Disposable PostgreSQL did not become ready.' }
& docker exec $pgName createdb -U bhome_demo $database
if ($LASTEXITCODE -ne 0) { throw 'Cannot create the new disposable demo database.' }
Get-Content -LiteralPath 'docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql' -Raw | & docker exec -i -e 'PGOPTIONS=-c client_min_messages=warning' $pgName psql -q -U bhome_demo -d $database -v ON_ERROR_STOP=1 *> (Join-Path $directory 'schema.log')
if ($LASTEXITCODE -ne 0) { throw 'Disposable schema initialization failed; inspect .tmp/handover-demo/schema.log.' }
$environment = @{
    DOTNET_ENVIRONMENT = 'Development'; ASPNETCORE_ENVIRONMENT = 'Development'
    ConnectionStrings__Database = "Host=127.0.0.1;Port=$pgPort;Database=$database;Username=bhome_demo;Password=$pgPassword"
    Jwt__SigningKey = (New-DemoSecret); Jwt__Issuer = 'BHome'; Jwt__Audience = 'BHome.Clients'
    Api__ReadDevelopmentEnvironmentFile = 'false'; Api__UseHttpsRedirection = 'false'; DevelopmentDatabase__InitializeOnStartup = 'false'
    Jobs__Enabled = 'false'; BillingAutomation__AutomaticJobsEnabled = 'false'
    ContractWorkflow__SimulatedSigningEnabled = 'true'; ContractPdf__TemplateId = 'main-contract-development-v1'
    ObjectStorage__Endpoint = "127.0.0.1:$filesPort"; ObjectStorage__AccessKey = 'bhome-demo'; ObjectStorage__SecretKey = $minioPassword
    ObjectStorage__Bucket = 'handover-demo'; ObjectStorage__UseSsl = 'false'
    Kestrel__Certificates__Default__Path = $pfxFile; Kestrel__Certificates__Default__Password = $pfxPassword
    Cors__AllowedOrigins__0 = "http://127.0.0.1:$OwnerPort"; Cors__AllowedOrigins__1 = "http://localhost:$MobilePort"; Cors__AllowedOrigins__2 = "http://127.0.0.1:$MobilePort"
    AuthWeb__AllowedOrigins__0 = "http://127.0.0.1:$OwnerPort"; AuthWeb__AllowedOrigins__1 = "http://localhost:$OwnerPort"
    VITE_API_MODE = 'api'; VITE_API_BASE_URL = "https://localhost:$ApiPort"; VITE_DEV_CA_FILE = $caFile
    EXPO_PUBLIC_API_BASE_URL = "https://localhost:$ApiPort"; EXPO_PUBLIC_DEV_API_BASE_URL = "https://localhost:$ApiPort"; EXPO_NO_DOTENV = '1'
    BHOME_HANDOVER_DEMO_PASSWORD = $password; AuthRateLimit__PermitLimit = '10000'
}
foreach ($item in $environment.GetEnumerator()) { [Environment]::SetEnvironmentVariable($item.Key, [string]$item.Value, 'Process') }
& dotnet build src/backend/BHome.Api/BHome.Api.csproj -c Release --no-restore *> (Join-Path $directory 'build.log')
if ($LASTEXITCODE -ne 0) { throw 'API build failed; inspect .tmp/handover-demo/build.log.' }
& dotnet build tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj -c Release --no-restore *>> (Join-Path $directory 'build.log')
if ($LASTEXITCODE -ne 0) { throw 'Release build failed; inspect .tmp/handover-demo/build.log.' }
& dotnet run --no-build -c Release --project tools/BHome.LocalDevelopment -- seed-asset-handover-demo *> (Join-Path $directory 'seed.log')
if ($LASTEXITCODE -ne 0) { throw 'Demo seed failed; inspect .tmp/handover-demo/seed.log. Existing databases were not touched.' }
$SessionFile = Join-Path $directory ('session-' + $suffix + '.json')
$session = @{ environment = $environment; apiPort = $ApiPort; ownerPort = $OwnerPort; mobilePort = $MobilePort; postgresContainer = $pgName; filesContainer = $minioName }
$session | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $SessionFile
$session.processes = @()
foreach ($surface in @('Api', 'Owner', 'Mobile')) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode $surface -SessionFile `"$SessionFile`""
    $process = Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $directory "$suffix-$surface.log") -RedirectStandardError (Join-Path $directory "$suffix-$surface.err.log")
    $session.processes += @{ mode = $surface; id = $process.Id }
}
$session | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $SessionFile
@{ accounts = @('owner.sample@example.invalid', 'staff.sample@example.invalid', 'tenant.sample@example.invalid', 'tenant.other.sample@example.invalid'); password = $password; ownerUrl = "http://127.0.0.1:$OwnerPort"; mobileUrl = "http://localhost:$MobilePort"; sessionFile = $SessionFile } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $directory 'access.json')
Write-Host "Owner Web: http://127.0.0.1:$OwnerPort"
Write-Host "Staff / Tenant Mobile web: http://localhost:$MobilePort"
Write-Host 'Synthetic account password: .tmp/handover-demo/access.json (ignored by Git). Scenario: .tmp/handover-demo/scenario.json.'
Write-Host 'All data uses newly created disposable PostgreSQL and MinIO containers. Processes and container names are recorded in the session file.'
