# Set the public account-email callbacks and contract signing page in an existing ignored .env.
# Legacy opt-in helper. Standard onboarding uses Initialize-TeamEnvironment.ps1 and VPS Staging.
# This script does not create a tunnel, send emails, or modify SMTP credentials.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublicWebOrigin,
    [string]$EnvironmentFile = '.env',
    [switch]$Apply,
    [switch]$SkipRemoteProbe
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configurationFile = if ([IO.Path]::IsPathRooted($EnvironmentFile)) {
    [IO.Path]::GetFullPath($EnvironmentFile)
} else {
    [IO.Path]::GetFullPath((Join-Path $repositoryRoot $EnvironmentFile))
}

if (-not [IO.File]::Exists($configurationFile)) {
    throw 'The selected environment file does not exist. Generate your ignored .env with Initialize-Local.ps1 first.'
}

$publicUri = $null
if (-not [Uri]::TryCreate($PublicWebOrigin, [UriKind]::Absolute, [ref]$publicUri) -or
    $publicUri.Scheme -ne 'https' -or
    $publicUri.IsLoopback -or
    -not $publicUri.IsDefaultPort -or
    $publicUri.AbsolutePath -ne '/' -or
    $publicUri.Query -or $publicUri.Fragment -or $publicUri.UserInfo -or
    $publicUri.HostNameType -ne [UriHostNameType]::Dns -or
    $publicUri.Host.EndsWith('.invalid', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'PublicWebOrigin must be a public HTTPS origin (hostname only; no port, path, query, fragment or credentials).'
}
$origin = $publicUri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')

$routes = @('/reset-password', '/accept-invitation', '/confirm-email', '/contract-signing')
if (-not $SkipRemoteProbe) {
    foreach ($route in $routes) {
        $url = $origin + $route
        $request = [Net.HttpWebRequest][Net.WebRequest]::Create($url)
        $request.Method = 'GET'
        $request.Timeout = 8000
        $request.ReadWriteTimeout = 8000
        $request.AllowAutoRedirect = $false
        try {
            $response = [Net.HttpWebResponse]$request.GetResponse()
            try {
                if ([int]$response.StatusCode -ne 200) {
                    throw ('The public page {0} returned HTTP {1}; verify the tunnel upstream and Vite allowed host.' -f $route, [int]$response.StatusCode)
                }
            } finally { $response.Dispose() }
        } catch [Net.WebException] {
            $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'unreachable' }
            if ($_.Exception.Response) { $_.Exception.Response.Dispose() }
            throw ('The public page {0} returned {1}; verify DNS, tunnel, Vite port and allowed host.' -f $route, $statusCode)
        }
        Write-Output ('Public page reachable: ' + $route)
    }
} else {
    Write-Warning 'Remote page checks skipped. Confirm all three public email routes work before distributing email links.'
}

$replacement = [ordered]@{
    'AuthenticationEmail__WebResetUrl' = $origin + '/reset-password'
    'AuthenticationEmail__WebInvitationUrl' = $origin + '/accept-invitation'
    'AuthenticationEmail__WebVerificationUrl' = $origin + '/confirm-email'
    'AuthenticationEmail__TrustedOrigins__0' = $origin
    # The account callbacks above do not configure anonymous contract invitations.
    # Without this HTTPS page, the signing email falls back to pasting a token into Mobile.
    'AnonymousSigning__PublicSigningUrl' = $origin + '/contract-signing'
}

$content = [IO.File]::ReadAllText($configurationFile)
$newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = [Collections.Generic.List[string]]::new()
$lines.AddRange([string[]]($content -split "`r?`n"))
foreach ($key in $replacement.Keys) {
    $matches = @($lines | Where-Object { $_ -match ('^' + [Regex]::Escape($key) + '=') })
    if ($matches.Count -gt 1) { throw ("Duplicate environment variable: " + $key) }
}

# Cookie-authenticated /api requests arrive at the local Vite proxy with the
# public Origin header. Keep the user's other development origins intact.
$managedOriginMarker = '# BHOME Cloudflare email origin (managed by Configure-CloudflareEmailLinks.ps1)'
$managedMarkerIndices = @(
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -eq $managedOriginMarker) { $i }
    }
)
if ($managedMarkerIndices.Count -gt 1) { throw 'Duplicate managed AuthWeb origin markers.' }
$managedOriginKey = $null
if ($managedMarkerIndices.Count -eq 1) {
    $next = $managedMarkerIndices[0] + 1
    if ($next -ge $lines.Count -or $lines[$next] -notmatch '^AuthWeb__AllowedOrigins__([0-9]+)=') {
        throw 'Managed AuthWeb origin marker does not have the expected next line.'
    }
    $managedOriginKey = 'AuthWeb__AllowedOrigins__' + $Matches[1]
} else {
    $occupied = @(
        foreach ($line in $lines) {
            if ($line -match '^AuthWeb__AllowedOrigins__([0-9]+)=') { [int]$Matches[1] }
        }
    )
    $nextIndex = if ($occupied.Count) { ($occupied | Measure-Object -Maximum).Maximum + 1 } else { 0 }
    $managedOriginKey = 'AuthWeb__AllowedOrigins__' + $nextIndex
    $lines.Add($managedOriginMarker)
    $lines.Add($managedOriginKey + '=' + $origin)
}
$existingManagedEntries = @($lines | Where-Object { $_ -match ('^' + [Regex]::Escape($managedOriginKey) + '=') })
if ($existingManagedEntries.Count -ne 1) { throw 'Ambiguous managed AuthWeb origin key.' }
$replacement[$managedOriginKey] = $origin

foreach ($key in $replacement.Keys) {
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].StartsWith($key + '=', [StringComparison]::Ordinal)) {
            $lines[$i] = $key + '=' + $replacement[$key]
            $found = $true
            break
        }
    }
    if (-not $found) { $lines.Add($key + '=' + $replacement[$key]) }
}

Write-Output ('Email callbacks origin: ' + $origin)
if (-not $Apply) {
    Write-Output 'Preview only. Add -Apply to write account email callbacks, the contract signing URL, and exact trusted origins.'
    return
}
if (-not $PSCmdlet.ShouldProcess($configurationFile, 'Update non-secret account email URLs and exact allowed origins')) {
    return
}

$temporaryFile = Join-Path (Split-Path -Parent $configurationFile) ('.bhome-email-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$backupFile = $configurationFile + '.cloudflare-email-backup-' + [Guid]::NewGuid().ToString('N')
try {
    [IO.File]::WriteAllText($temporaryFile, [string]::Join($newline, $lines), [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporaryFile, $configurationFile, $backupFile)
} finally {
    if ([IO.File]::Exists($temporaryFile)) { [IO.File]::Delete($temporaryFile) }
    if ([IO.File]::Exists($backupFile)) { [IO.File]::Delete($backupFile) }
}
Write-Output 'Updated account email callbacks, contract signing URL and trusted origins. Restart the Backend, then issue a NEW contract invitation email.'
