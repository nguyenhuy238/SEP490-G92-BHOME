# Local onboarding/doctor. Does not start containers, initialize/reset data or overwrite existing configuration.
param([switch]$CheckOnly, [switch]$SkipNetworkChecks)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$problems = 0
function Problem([string]$message) { $script:problems++; Write-Warning $message }
function Read-Settings([string]$path) {
    $settings = @{}
    if (Test-Path -LiteralPath $path) {
        foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $path) {
            if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') {
                if ($settings.ContainsKey($Matches[1])) { Problem "Duplicate setting key in $([IO.Path]::GetFileName($path)); remove duplicates without printing credentials." }
                $settings[$Matches[1]] = $Matches[2].Trim().Trim([char]34, [char]39)
            }
        }
    }
    return $settings
}
foreach ($tool in @('dotnet', 'node', 'npm.cmd', 'docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Problem "Missing $tool. Install .NET SDK 8, Node 22/npm and Docker Desktop (Linux containers)." }
}
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    $sdk = & dotnet --version
    if ($LASTEXITCODE -ne 0 -or $sdk -notmatch '^8\.') { Problem 'Use the .NET 8 SDK selected by global.json.' }
}
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = (& node --version).TrimStart('v')
    if ([version]$nodeVersion -lt [version]'22.13.0' -or [version]$nodeVersion -ge [version]'23.0.0') { Problem 'Use Node 22.13+ within 22.x (repository engines); dot-source scripts/Use-LocalTools.ps1 if installed locally.' }
}
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    if ([int]((& npm.cmd --version).Split('.')[0]) -lt 10) { Problem 'npm 10 or later is required.' }
}
if (-not $CheckOnly) {
    & (Join-Path $PSScriptRoot 'Initialize-Local.ps1')
    foreach ($app in @('owner-web', 'public-web')) {
        $directory = Join-Path $repositoryRoot "src/$app"
        if (!(Test-Path -LiteralPath "$directory/.env") -and !(Test-Path -LiteralPath "$directory/.env.local")) {
            [IO.File]::Copy("$directory/.env.example", "$directory/.env.local", $false)
            Write-Output "Created src/$app/.env.local."
        } else { Write-Output "Preserved existing src/$app environment configuration." }
    }
}
$settings = Read-Settings (Join-Path $repositoryRoot '.env')
if ($settings.Count -eq 0) { Problem 'Missing root .env. Run scripts/Initialize-Local.ps1.' }
if ($settings.ASPNETCORE_ENVIRONMENT -and $settings.ASPNETCORE_ENVIRONMENT -ne 'Development') { Problem 'Local .env must use Development.' }
if ($settings.SePay__Enabled -ne 'false') { Problem 'Local default must use SePay__Enabled=false. Use the dedicated Staging deployment for Internet callbacks.' }
$db = $settings.ConnectionStrings__Database
if ($db -notmatch '(?i)(^|;)\s*Host\s*=\s*(localhost|127\.0\.0\.1|::1)\s*(;|$)') {
    Problem 'Local database is not loopback. Do not use the Staging/Production database. Review any deliberate remote Development override separately.'
}
foreach ($file in @('.env', 'src/owner-web/.env', 'src/owner-web/.env.local', 'src/owner-web/.env.development', 'src/owner-web/.env.development.local', 'src/public-web/.env', 'src/public-web/.env.local', 'src/public-web/.env.development', 'src/public-web/.env.development.local')) {
    $values = Read-Settings (Join-Path $repositoryRoot $file)
    foreach ($key in $values.Keys) {
        if ($values[$key] -match 'trycloudflare\.com|ngrok') { Problem "$file contains an old tunnel setting in $key. Replace it with the corresponding local template value." }
        if ($key -match '^VITE_.*(TOKEN|SECRET|PASSWORD|HMAC|CREDENTIAL|API_?KEY|SMTP|CONNECTION_?STRING)') { Problem "Remove sensitive frontend variable $key from $file." }
        if ($key -match '^(VITE_API_BASE_URL|AuthenticationEmail__Web.*Url|AnonymousSigning__PublicSigningUrl|ContractSigning__InvitationLink__PublicOpenUrl)$') {
            $uri = $null
            if (![Uri]::TryCreate($values[$key], [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
                Problem "Invalid absolute URL in $file key $key (value withheld)."
            } elseif (!$uri.IsLoopback) { Problem "$file key $key does not target this workstation. Use Staging as a separate deployment." }
            elseif ($key -eq 'AnonymousSigning__PublicSigningUrl' -and $uri.Scheme -ne 'https') { Problem 'The anonymous signing page requires HTTPS.' }
        }
    }
}
if ($settings.Email__DeliveryMode -ne 'Capture' -or $settings.Email__Host -notin @('localhost','127.0.0.1','::1')) {
    Write-Warning 'Local email is not the Mailpit default. Real SMTP requires STARTTLS and an explicit Email__AllowedRecipients allowlist.'
}
if ($settings.AuthenticationEmail__WebResetUrl -ne ($settings.AuthenticationEmail__TrustedOrigins__0 + '/reset-password')) {
    Problem 'Authentication email URL/trusted origin differ; compare the local template and review user-secrets overrides.'
}
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    & dotnet dev-certs https --check --trust *> $null
    if ($LASTEXITCODE -ne 0) { Problem 'HTTPS certificate missing/untrusted. Run: dotnet dev-certs https --trust; then rerun this script.' }
    elseif (!$CheckOnly) {
        $directory = Join-Path $repositoryRoot '.tools/team-tls'
        $certificate = Join-Path $directory 'localhost.pem'
        if (!(Test-Path -LiteralPath $certificate) -and !(Test-Path -LiteralPath (Join-Path $directory 'localhost.key'))) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
            & dotnet dev-certs https --export-path $certificate --format PEM --no-password *> $null
            if ($LASTEXITCODE -ne 0) { Problem 'Cannot export trusted development certificate for Vite. No certificate validation is bypassed.' }
        }
    }
}
function Check-Port([string]$hostName, [int]$port, [string]$label) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect($hostName, $port, $null, $null)
        if (!$pending.AsyncWaitHandle.WaitOne(1500)) { throw 'timeout' }
        $client.EndConnect($pending)
        Write-Output "$label TCP port reachable."
    } catch { Problem "$label is not reachable. Start the documented local service or check its configured port; no data was changed." }
    finally { $client.Dispose() }
}
if (!$SkipNetworkChecks) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -ne 0) { Problem 'Docker Desktop is not running. Start its Linux engine, then docker compose up -d postgres minio mailpit.' }
    }
    $port = 5432; if ($settings.POSTGRES_PORT) { $port = [int]$settings.POSTGRES_PORT }
    Check-Port 'localhost' $port 'PostgreSQL (TCP only, credentials/schema not tested)'
    $storagePort = 9000; if ($settings.MINIO_API_PORT) { $storagePort = [int]$settings.MINIO_API_PORT }
    Check-Port 'localhost' $storagePort 'MinIO'
    if ($settings.Email__DeliveryMode -eq 'Capture') { Check-Port $settings.Email__Host ([int]$settings.Email__Port) 'Mailpit SMTP' }
    $api = 'https://localhost:7240'
    $owner = Read-Settings (Join-Path $repositoryRoot 'src/owner-web/.env.local')
    if ($owner.VITE_API_BASE_URL) { $api = $owner.VITE_API_BASE_URL }
    try {
        $uri = [Uri]$api
        if (!$uri.IsLoopback -or $uri.UserInfo) { throw 'not local' }
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($uri.GetLeftPart([UriPartial]::Authority) + '/health/live') -TimeoutSec 4
        if ($response.StatusCode -ne 200) { throw 'not ready' }
        Write-Output 'API /health/live: HTTP 200 (database readiness not implied).'
    } catch { Problem 'Local API is stopped or its HTTPS certificate is untrusted. Run scripts/Start-Api.ps1 and check /health/ready separately.' }
}
Write-Output 'Default: Owner http://localhost:5173; API https://localhost:7240; HTTPS signing portal https://localhost:5176; Mailpit http://localhost:8025.'
Write-Output 'Effective precedence: CLI/process environment > user-secrets > selected .env > appsettings. This doctor checks files; API startup validates effective configuration.'
if ($problems -gt 0) { throw "Environment check found $problems issue(s). See messages above; credentials were withheld." }
Write-Output 'Local environment checks completed.'
