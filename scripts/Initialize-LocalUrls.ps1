# Migrate URL settings only; database, credentials, native deep links and all unrelated settings are preserved.
param(
    [string]$EnvironmentFile = '.env',
    [string]$OwnerOrigin = 'http://localhost:5173',
    [string]$ApiOrigin = 'https://localhost:7240',
    [string]$SigningOrigin = 'https://localhost:5176',
    [string]$UserSecretsId,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repo = Split-Path -Parent $PSScriptRoot
foreach ($name in @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value -and $value -ne 'Development') { throw 'Local URL migration only supports Development.' }
}
foreach ($entry in @(@('OwnerOrigin', $OwnerOrigin), @('ApiOrigin', $ApiOrigin), @('SigningOrigin', $SigningOrigin))) {
    $uri = $null
    if (![Uri]::TryCreate($entry[1], [UriKind]::Absolute, [ref]$uri) -or !$uri.IsLoopback -or
        $uri.Scheme -notin @('http','https') -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo -or
        ($entry[0] -ne 'OwnerOrigin' -and $uri.Scheme -ne 'https')) {
        throw 'Local origins must be loopback HTTP(S) origins without credentials/path/query; API and signing require HTTPS.'
    }
}
$OwnerOrigin = ([Uri]$OwnerOrigin).GetLeftPart([UriPartial]::Authority)
$ApiOrigin = ([Uri]$ApiOrigin).GetLeftPart([UriPartial]::Authority)
$SigningOrigin = ([Uri]$SigningOrigin).GetLeftPart([UriPartial]::Authority)
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
if (!(Test-Path -LiteralPath $path)) { throw 'Selected local environment file is missing.' }
$content = [IO.File]::ReadAllText($path)
$settings = @{}
$rootValues = @{}
foreach ($line in $content -split '\r?\n') {
    if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') {
        $key = $Matches[1].Replace('__', ':'); $value = $Matches[2].Trim().Trim([char]34,[char]39)
        $settings[$key] = $value; $rootValues[$key] = $value
    }
}
if ($settings.ASPNETCORE_ENVIRONMENT -and $settings.ASPNETCORE_ENVIRONMENT -ne 'Development') { throw 'Selected profile is not Development.' }
if (!$UserSecretsId) {
    $project = [xml][IO.File]::ReadAllText((Join-Path $repo 'src/backend/BHome.Api/BHome.Api.csproj'))
    $UserSecretsId = [string]$project.Project.PropertyGroup.UserSecretsId
}
if (!$UserSecretsId -or $UserSecretsId.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $UserSecretsId -in @('.','..')) { throw 'A valid API UserSecretsId is required.' }
$secretPath = Join-Path $env:APPDATA "Microsoft/UserSecrets/$UserSecretsId/secrets.json"
$secretValues = @{}
if (Test-Path -LiteralPath $secretPath) {
    try { $secrets = Get-Content -Encoding UTF8 -Raw -LiteralPath $secretPath | ConvertFrom-Json }
    catch { throw 'Could not read user-secrets JSON; values withheld. No changes were made.' }
    foreach ($property in $secrets.PSObject.Properties) { $secretValues[$property.Name] = $property.Value; $settings[$property.Name] = $property.Value }
}
if ($settings['Deployment:Environment'] -and $settings['Deployment:Environment'] -ne 'Development') { throw 'Do not convert a deployed profile into Local. Select a separate Development configuration.' }
$managed = @{
    'AuthenticationEmail:WebInvitationUrl' = "$OwnerOrigin/accept-invitation"
    'AuthenticationEmail:WebResetUrl' = "$OwnerOrigin/reset-password"
    'AuthenticationEmail:WebVerificationUrl' = "$OwnerOrigin/confirm-email"
    'AnonymousSigning:PublicSigningUrl' = "$SigningOrigin/contract-signing"
    'ContractSigning:InvitationLink:PublicOpenUrl' = "$ApiOrigin/open/sign-contract"
}
if ($settings.ContainsKey('Deployment:OwnerOrigin')) { $managed['Deployment:OwnerOrigin'] = $OwnerOrigin }
if ($settings.ContainsKey('Deployment:ApiOrigin')) { $managed['Deployment:ApiOrigin'] = $ApiOrigin }
function Is-TemporaryOrigin([string]$value) {
    $uri = $null
    return [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri) -and
        $uri.Host -match '(?i)(^|\.)(trycloudflare\.com|ngrok\.io|ngrok-free\.(app|dev)|ngrok\.(app|dev))$'
}
$allKeys = @(@($rootValues.Keys) + @($secretValues.Keys) | Sort-Object -Unique)
$remove = @($allKeys | Where-Object {
    $_ -match '^(AuthenticationEmail:TrustedOrigins|AuthWeb:AllowedOrigins|Cors:AllowedOrigins):\d+$' -and
        ((Is-TemporaryOrigin ([string]$rootValues[$_])) -or (Is-TemporaryOrigin ([string]$secretValues[$_])))
})
foreach ($key in $remove) {
    if ($secretValues.ContainsKey($key) -and !(Is-TemporaryOrigin ([string]$secretValues[$key]))) { $settings[$key] = $secretValues[$key] }
    elseif ($rootValues.ContainsKey($key) -and !(Is-TemporaryOrigin ([string]$rootValues[$key]))) { $settings[$key] = $rootValues[$key] }
    else { $settings.Remove($key) }
}
foreach ($prefix in @('AuthenticationEmail:TrustedOrigins', 'AuthWeb:AllowedOrigins', 'Cors:AllowedOrigins')) {
    foreach ($origin in @($OwnerOrigin, $SigningOrigin)) {
        $entries = @($settings.Keys | Where-Object { $_ -like "$prefix`:*" })
        if (@($entries | Where-Object { $settings[$_] -eq $origin }).Count -gt 0) { continue }
        $index = 0; while ($settings.ContainsKey("$prefix`:$index")) { $index++ }
        $key = "$prefix`:$index"; $managed[$key] = $origin; $settings[$key] = $origin
    }
}
Write-Output "Local URL migration: $($managed.Count) URL/origin keys; $($remove.Count) obsolete tunnel origin entries. Values and credentials were withheld."
if (!$Apply) { Write-Output 'Preview only. Add -Apply to update just these keys in the selected .env and Development user-secrets.'; return }
foreach ($key in $remove) {
    $envKey = $key.Replace(':','__')
    if (Is-TemporaryOrigin ([string]$rootValues[$key])) {
        $content = [regex]::Replace($content, '(?m)^\s*' + [regex]::Escape($envKey) + '\s*=.*(?:\r?\n|$)', '')
    }
    if (Is-TemporaryOrigin ([string]$secretValues[$key])) {
        & dotnet user-secrets remove $key --id $UserSecretsId | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove an obsolete URL origin from Development user-secrets; values withheld.' }
    }
}
foreach ($key in $managed.Keys) {
    $envKey = $key.Replace(':','__'); $value = $managed[$key]
    $pattern = '(?m)^\s*' + [regex]::Escape($envKey) + '\s*=.*$'
    if ([regex]::IsMatch($content, $pattern)) {
        $content = [regex]::Replace($content, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) "$envKey=$value" })
    } else { $content = $content.TrimEnd() + "`n$envKey=$value`n" }
}
# CLI merges only URL keys. Credentials never appear in arguments or output.
$managed | ConvertTo-Json -Compress | dotnet user-secrets set --id $UserSecretsId | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not synchronize Development URL settings; values withheld.' }
$temporaryPath = $path + '.urls-' + [Guid]::NewGuid().ToString('N')
try {
    [IO.File]::WriteAllText($temporaryPath, $content, [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporaryPath, $path, [System.Management.Automation.Language.NullString]::Value)
} finally { if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath } }
Write-Output 'Local URL keys updated; database, credentials and native app links preserved. Restart API/Visual Studio and request a new invitation; old email contents do not change.'
