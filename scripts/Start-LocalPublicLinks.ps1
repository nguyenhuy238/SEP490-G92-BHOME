param(
    [string]$EnvironmentFile = '.env',
    [ValidateRange(1024,65535)][int]$Port = 5176
)

# Public Development callbacks over the existing authenticated API. No provider credentials are changed.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repository = Split-Path -Parent $PSScriptRoot
$profile = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repository $EnvironmentFile }
$profile = [IO.Path]::GetFullPath($profile)
$line = Get-Content -LiteralPath $profile | Where-Object { $_.StartsWith('ConnectionStrings__Database=') } | Select-Object -First 1
if (-not $line) { throw 'Selected profile has no database connection.' }
$database = [System.Data.Common.DbConnectionStringBuilder]::new()
try { $database.set_ConnectionString($line.Substring($line.IndexOf('=') + 1)) }
catch { throw 'Invalid database configuration; no values printed.' }
if ([string]$database['Host'] -notin @('localhost','127.0.0.1','::1')) { throw 'This launcher supports only the local Development database.' }
$directory = Join-Path $repository '.tools/local-public-links'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$upstream = "http://127.0.0.1:$Port"
$publicUrl = $null
function Find-PublicTunnel {
    try {
        $state = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
        $match = $state.tunnels | Where-Object { $_.public_url -like 'https://*' -and $_.config.addr -eq $upstream } | Select-Object -First 1
        if ($match) { return [string]$match.public_url }
    } catch { }
}
$publicUrl = Find-PublicTunnel
if (-not $publicUrl) {
    if (Get-NetTCPConnection -State Listen -LocalPort 4040 -ErrorAction SilentlyContinue) { throw 'Another ngrok agent uses port 4040; reuse its configuration or stop it before starting this launcher.' }
    $ngrok = (Get-Command ngrok -ErrorAction Stop).Source
    $tunnel = Start-Process -FilePath $ngrok -ArgumentList @('http',$upstream,'--log=stdout','--log-format=json') -WorkingDirectory $repository -WindowStyle Hidden -RedirectStandardOutput (Join-Path $directory 'ngrok.stdout.log') -RedirectStandardError (Join-Path $directory 'ngrok.stderr.log') -PassThru
    [IO.File]::WriteAllText((Join-Path $directory 'ngrok.pid'), [string]$tunnel.Id)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $publicUrl = Find-PublicTunnel
        if ($publicUrl) { break }
        if ($tunnel.HasExited) { throw 'ngrok startup failed; inspect private logs in .tools/local-public-links.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $publicUrl) { throw 'No public HTTPS tunnel was established.' }
}
$origin = $publicUrl.TrimEnd('/')
$publicHost = ([Uri]$origin).Host
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    $existing = Invoke-WebRequest -UseBasicParsing -Uri ($upstream + '/accept-invitation') -Headers @{Host=$publicHost} -TimeoutSec 10
    if ($existing.StatusCode -ne 200 -or $existing.Content -notmatch '/@vite/client') { throw 'The public frontend port belongs to another service.' }
} else {
    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $publicHost
    $env:VITE_API_BASE_URL = 'https://localhost:7240'
    $node = (Get-Command node -ErrorAction Stop).Source
    $frontend = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',[string]$Port,'--strictPort') -WorkingDirectory (Join-Path $repository 'src/owner-web') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $directory 'frontend.stdout.log') -RedirectStandardError (Join-Path $directory 'frontend.stderr.log') -PassThru
    [IO.File]::WriteAllText((Join-Path $directory 'frontend.pid'), [string]$frontend.Id)
}
$secretsPath = Join-Path $env:APPDATA 'Microsoft/UserSecrets/bhome-api-development/secrets.json'
$secrets = if (Test-Path -LiteralPath $secretsPath) { Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$changes = [ordered]@{
    AuthenticationEmail__WebResetUrl = $origin + '/reset-password'
    AuthenticationEmail__WebInvitationUrl = $origin + '/accept-invitation'
    AuthenticationEmail__WebVerificationUrl = $origin + '/confirm-email'
    AnonymousSigning__PublicSigningUrl = $origin + '/contract-signing'
    ContractSigning__InvitationLink__PublicOpenUrl = $origin + '/open/sign-contract'
}
$content = [IO.File]::ReadAllText($profile)
foreach ($section in @('AuthenticationEmail__TrustedOrigins','AuthWeb__AllowedOrigins','Cors__AllowedOrigins')) {
    $indices = @()
    $matchingIndex = $null
    foreach ($property in $secrets.PSObject.Properties) {
        if ($property.Name -match ('^' + [regex]::Escape($section.Replace('__',':')) + ':(\d+)$')) {
            $indices += [int]$Matches[1]
            if ([string]$property.Value -eq $origin) { $matchingIndex = [int]$Matches[1] }
        }
    }
    foreach ($entry in $content -split "`n") {
        if ($entry -match ('^' + [regex]::Escape($section) + '__(\d+)=(.*)$')) {
            $indices += [int]$Matches[1]
            if ($Matches[2].Trim() -eq $origin) { $matchingIndex = [int]$Matches[1] }
        }
    }
    $index = if ($null -ne $matchingIndex) { $matchingIndex } elseif ($indices.Count) { ($indices | Measure-Object -Maximum).Maximum + 1 } else { 0 }
    $changes[$section + '__' + $index] = $origin
}
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff')
Copy-Item -LiteralPath $profile -Destination (Join-Path $directory ($stamp + '-profile.backup'))
if (Test-Path -LiteralPath $secretsPath) { Copy-Item -LiteralPath $secretsPath -Destination (Join-Path $directory ($stamp + '-user-secrets.backup')) }
foreach ($key in $changes.Keys) {
    $content = [regex]::Replace($content,'(?m)^' + [regex]::Escape($key) + '=.*\r?\n?','')
    $content = $content.TrimEnd() + "`r`n$key=$($changes[$key])`r`n"
    $secrets | Add-Member -NotePropertyName $key.Replace('__',':') -NotePropertyValue $changes[$key] -Force
}
[IO.File]::WriteAllText($profile,$content,[Text.UTF8Encoding]::new($false))
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $secretsPath) | Out-Null
[IO.File]::WriteAllText($secretsPath,($secrets | ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $directory 'public-origin.txt'),$origin)
Write-Output "Public invitation origin: $origin"
Write-Output "SePay webhook URL: $origin/api/v1/integrations/sepay/webhook"
Write-Output 'Restart the Development API to load these callbacks. Reissue links created for an older origin/database.'
