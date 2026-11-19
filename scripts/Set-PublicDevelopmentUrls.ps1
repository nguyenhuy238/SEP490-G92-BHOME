param(
    [Parameter(Mandatory=$true)][string]$ApiUrl,
    [Parameter(Mandatory=$true)][string]$WebUrl,
    [string[]]$EnvironmentFiles = @('.env.neon.dev04', '.env')
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
foreach ($origin in @($ApiUrl, $WebUrl)) {
    $uri = $null
    if (-not [Uri]::TryCreate($origin, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {
        throw 'Public URLs must be HTTPS origins without credentials, paths or query strings.'
    }
}
$ApiUrl = $ApiUrl.TrimEnd('/')
$WebUrl = $WebUrl.TrimEnd('/')
$updates = @{
    AuthenticationEmail__WebInvitationUrl = "$WebUrl/accept-invitation"
    AuthenticationEmail__WebResetUrl = "$WebUrl/reset-password"
    AuthenticationEmail__WebVerificationUrl = "$WebUrl/confirm-email"
    AuthenticationEmail__TrustedOrigins__4 = $WebUrl
    AnonymousSigning__PublicSigningUrl = "$WebUrl/contract-signing"
    Cors__AllowedOrigins__3 = $WebUrl
    AuthWeb__AllowedOrigins__3 = $WebUrl
}
foreach ($file in $EnvironmentFiles) {
    $path = if ([IO.Path]::IsPathRooted($file)) { $file } else { Join-Path $repo $file }
    if (-not (Test-Path -LiteralPath $path)) { throw "Environment file is missing: $file" }
    $content = [IO.File]::ReadAllText($path)
    $hosts = [regex]::Match($content, '(?m)^AllowedHosts=([^\r\n]*)').Groups[1].Value.Trim().Trim('"', "'") -split ';'
    # Keep LAN and explicitly configured public hosts; never use a wildcard.
    $updates.AllowedHosts = (@($hosts) + @('localhost', '127.0.0.1', ([uri]$ApiUrl).Host, ([uri]$WebUrl).Host) |
        Where-Object { $_ } | Select-Object -Unique) -join ';'
    foreach ($key in $updates.Keys) {
        $replacement = $key + '=' + $updates[$key]
        $pattern = '(?m)^' + [regex]::Escape($key) + '=[^\r\n]*'
        if ([regex]::IsMatch($content, $pattern)) { $content = [regex]::Replace($content, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement }) }
        else { $content = $content.TrimEnd() + [Environment]::NewLine + $replacement + [Environment]::NewLine }
    }
    [IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))
}
# F5 user-secrets override .env; synchronize only the public settings, never credentials.
$publicSettings = @{}
foreach ($key in $updates.Keys) { $publicSettings[$key.Replace('__', ':')] = $updates[$key] }
$publicSettings | ConvertTo-Json | & dotnet user-secrets set --id bhome-api-development | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not synchronize public URL user-secrets.' }
$directory = Join-Path $repo '.tools/cloudflare'
[IO.Directory]::CreateDirectory($directory) | Out-Null
foreach ($name in @('api-url.txt', 'login-api-url.txt')) { [IO.File]::WriteAllText((Join-Path $directory $name), $ApiUrl) }
[IO.File]::WriteAllText((Join-Path $directory 'email-web-url.txt'), $WebUrl)
[IO.File]::WriteAllText((Join-Path $directory 'sepay-webhook-url.txt'), "$ApiUrl/api/v1/integrations/sepay/webhook")
Write-Output 'Synchronized email, signing, origin allowlists and SePay webhook URL files.'
