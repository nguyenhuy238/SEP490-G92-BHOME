# Shared local Development profile. Only non-secret keys are normalized.
# -CheckOnly does not write files, create secrets, start services, or send email.
[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$SkipNetworkChecks,
    [string]$EnvironmentFile = '.env'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configurationFile = if ([IO.Path]::IsPathRooted($EnvironmentFile)) {
    [IO.Path]::GetFullPath($EnvironmentFile)
} else {
    [IO.Path]::GetFullPath((Join-Path $repositoryRoot $EnvironmentFile))
}
$defaultFile = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.env'))
$isDefaultFile = [string]::Equals($configurationFile, $defaultFile, [StringComparison]::OrdinalIgnoreCase)

if (-not [IO.File]::Exists($configurationFile)) {
    if ($CheckOnly -or -not $isDefaultFile) { throw 'Selected environment file is missing.' }
    & (Join-Path $PSScriptRoot 'Initialize-Local.ps1')
}

$content = [IO.File]::ReadAllText($configurationFile)
$newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = [Collections.Generic.List[string]]::new()
$lines.AddRange([string[]]($content -split "`r?`n"))

# All values stay in memory; no connection strings or secrets are printed.
$current = @{}
foreach ($line in $lines) {
    if ($line -match '^([A-Za-z][A-Za-z0-9_]*)=(.*)$') {
        if ($current.ContainsKey($Matches[1])) {
            throw ('Duplicate environment key: ' + $Matches[1])
        }
        $current[$Matches[1]] = $Matches[2]
    }
}

$postgresPort = if ($current.ContainsKey('POSTGRES_PORT')) { $current['POSTGRES_PORT'] } else { '5434' }
$smtpPort = if ($current.ContainsKey('MAILPIT_SMTP_PORT')) { $current['MAILPIT_SMTP_PORT'] } else { '1025' }
$mailpitWebPort = if ($current.ContainsKey('MAILPIT_WEB_PORT')) { $current['MAILPIT_WEB_PORT'] } else { '8025' }
foreach ($port in @($postgresPort, $smtpPort, $mailpitWebPort)) {
    $parsedPort = 0
    if (-not [int]::TryParse($port, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
        throw 'Invalid local port in environment file.'
    }
}
$connection = if ($current.ContainsKey('ConnectionStrings__Database')) { $current['ConnectionStrings__Database'] } else { '' }
if ($connection -and $connection -match '(?:^|;)Port=([0-9]+)(?:;|$)' -and $Matches[1] -ne $postgresPort) {
    throw 'POSTGRES_PORT and ConnectionStrings__Database Port disagree. Correct them without resetting the database.'
}

$expected = [ordered]@{
    'MAILPIT_SMTP_PORT' = $smtpPort
    'MAILPIT_WEB_PORT' = $mailpitWebPort
    'BHOME_WEB_HTTPS' = 'true'
    'Email__DeliveryMode' = 'Capture'
    'Email__Enabled' = 'true'
    'Email__Host' = '127.0.0.1'
    'Email__Port' = $smtpPort
    'Email__UseStartTls' = 'false'
    'Email__Username' = ''
    'Email__FromEmail' = 'bhome.notifications@example.invalid'
    'Email__FromName' = 'BHOME'
    'NotificationChannels__Enabled' = 'true'
    'NotificationChannels__AutomationEnabled' = 'true'
    'NotificationChannels__Mode' = 'Unconfigured'
    'Jobs__Enabled' = 'false'
    'SePay__Enabled' = 'false'
    'ContractSigning__Methods__Otp' = 'true'
    'ContractSigning__Methods__ViettelMySign' = 'false'
    'AuthWeb__AllowedOrigins__0' = 'http://localhost:5173'
    'AuthWeb__AllowedOrigins__1' = 'https://localhost:5176'
    'Cors__AllowedOrigins__0' = 'http://localhost:5173'
    'Cors__AllowedOrigins__3' = 'https://localhost:5176'
    # Expo Web is served directly by Metro, unlike Owner Web's Vite API proxy.
    # Exact loopback origins only; do not expand Production CORS to local subnets.
    'Cors__AllowedOrigins__4' = 'http://localhost:8081'
    'Cors__AllowedOrigins__5' = 'http://127.0.0.1:8081'
    'AuthenticationEmail__WebResetUrl' = 'http://localhost:5173/reset-password'
    'AuthenticationEmail__WebInvitationUrl' = 'http://localhost:5173/accept-invitation'
    'AuthenticationEmail__WebVerificationUrl' = 'http://localhost:5173/confirm-email'
    'AuthenticationEmail__TrustedOrigins__0' = 'http://localhost:5173'
    'AnonymousSigning__PublicSigningUrl' = 'https://localhost:5176/contract-signing'
    'ContractSigning__InvitationLink__PublicOpenUrl' = 'https://localhost:7240/open/sign-contract'
}
$missingOrDrifted = [Collections.Generic.List[string]]::new()
foreach ($key in $expected.Keys) {
    if (-not $current.ContainsKey($key) -or $current[$key] -cne $expected[$key]) { $missingOrDrifted.Add($key) }
}
# A previous tunnel script marks its single extra AuthWeb origin. Remove that managed origin
# when selecting local mode; other custom origins remain user-managed.
$tunnelMarker = '# BHOME Cloudflare email origin (managed by Configure-CloudflareEmailLinks.ps1)'
$markerIndices = @(
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -eq $tunnelMarker) { $index }
    }
)
if ($markerIndices.Count -gt 1) { throw 'Duplicate managed Cloudflare origin marker.' }
if ($markerIndices.Count -eq 1) {
    $next = $markerIndices[0] + 1
    if ($next -ge $lines.Count -or $lines[$next] -notmatch '^AuthWeb__AllowedOrigins__[0-9]+=') {
        throw 'Cloudflare origin marker is not followed by the expected AuthWeb setting.'
    }
    if ($lines[$next] -notmatch '^AuthWeb__AllowedOrigins__([0-9]+)=') { throw 'Invalid marked AuthWeb origin.' }
    $markedKey = 'AuthWeb__AllowedOrigins__' + $Matches[1]
    if ($expected.Contains($markedKey)) {
        # The managed slot is now reserved for the local HTTPS origin.
        $lines.RemoveAt($markerIndices[0])
    } else {
        $lines.RemoveAt($next)
        $lines.RemoveAt($markerIndices[0])
    }
    $missingOrDrifted.Add('Cloudflare managed origin')
}

if ($CheckOnly) {
    if ($missingOrDrifted.Count -gt 0) {
        throw ('Team environment requires local configuration for: ' + ($missingOrDrifted -join ', ') +
            '. Run Initialize-TeamEnvironment.ps1 without -CheckOnly.')
    }
    Write-Output 'PASS: local team configuration matches the shared profile. No files changed.'
} else {
    foreach ($key in $expected.Keys) {
        $found = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i].StartsWith($key + '=', [StringComparison]::Ordinal)) {
                $lines[$i] = $key + '=' + $expected[$key]
                $found = $true
                break
            }
        }
        if (-not $found) { $lines.Add($key + '=' + $expected[$key]) }
    }
    if ($missingOrDrifted.Count -gt 0) {
        $temporary = $configurationFile + '.team-update-' + [Guid]::NewGuid().ToString('N')
        $backup = $configurationFile + '.team-backup-' + [Guid]::NewGuid().ToString('N')
        try {
            [IO.File]::WriteAllText($temporary, [string]::Join($newline, $lines), [Text.UTF8Encoding]::new($false))
            # .NET Framework used by PowerShell 5 requires an actual backup path.
            # Both temporary files remain git-ignored and are always cleaned up.
            [IO.File]::Replace($temporary, $configurationFile, $backup)
        } finally {
            if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
            if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
        }
    }
    Write-Output 'Local team settings ready. Existing secrets and PostgreSQL port preserved.'
    if ($isDefaultFile) {
        $ownerExample = Join-Path $repositoryRoot 'src/owner-web/.env.example'
        $ownerLocal = Join-Path $repositoryRoot 'src/owner-web/.env.local'
        if (-not [IO.File]::Exists($ownerLocal)) {
            [IO.File]::Copy($ownerExample, $ownerLocal)
            Write-Output 'Created ignored Owner Web .env.local from its example.'
        }
        $certFolder = Join-Path $repositoryRoot '.tools/team-tls'
        $certFile = Join-Path $certFolder 'localhost.crt'
        $keyFile = Join-Path $certFolder 'localhost.key'
        if ([IO.File]::Exists($certFile) -xor [IO.File]::Exists($keyFile)) {
            throw 'The team HTTPS certificate/key pair is incomplete. Inspect .tools/team-tls before retrying.'
        }
        if (-not [IO.File]::Exists($certFile)) {
            [IO.Directory]::CreateDirectory($certFolder) | Out-Null
            & dotnet dev-certs https --export-path $certFile --format Pem --no-password --quiet
            if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($certFile) -or
                -not [IO.File]::Exists($keyFile)) {
                throw 'Could not export the local HTTPS localhost.crt + localhost.key pair.'
            }
            Write-Output 'Created ignored .tools/team-tls/localhost.crt and localhost.key for HTTPS Owner Web.'
        }
        & (Join-Path $PSScriptRoot 'Initialize-LocalSigning.ps1')
    }
}

if ($isDefaultFile -and $CheckOnly) {
    $certFolder = Join-Path $repositoryRoot '.tools/team-tls'
    if (-not [IO.File]::Exists((Join-Path $certFolder 'localhost.crt')) -or
        -not [IO.File]::Exists((Join-Path $certFolder 'localhost.key'))) {
        throw 'Local HTTPS PEM certificate/key pair is missing. Run Initialize-TeamEnvironment.ps1 to export it.'
    }
}

Push-Location $repositoryRoot
try {
    & docker compose --env-file $configurationFile config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration is invalid.' }
    Write-Output 'PASS: Docker Compose configuration.'
} finally { Pop-Location }

if (-not $SkipNetworkChecks) {
    foreach ($endpoint in @(
        ('http://127.0.0.1:' + $mailpitWebPort + '/'),
        'https://localhost:7240/health/live',
        'https://localhost:5176/contract-signing'
    )) {
        try {
            $result = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ([int]$result.StatusCode -eq 200) { Write-Output ('PASS: reachable ' + $endpoint) }
            else { Write-Warning ('Unexpected HTTP status at ' + $endpoint) }
        } catch {
            Write-Warning ('Not reachable yet: ' + $endpoint + '. Start the corresponding local service.')
        }
    }
}
