$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'scripts/Use-LocalTools.ps1')
$id = 'bhome-local-urls-tests-' + [Guid]::NewGuid().ToString('N')
$directory = Join-Path ([IO.Path]::GetTempPath()) $id
$secretDirectory = Join-Path $env:APPDATA "Microsoft/UserSecrets/$id"
$secretFile = Join-Path $secretDirectory 'secrets.json'
$profile = Join-Path $directory '.env'
$script = Join-Path $repo 'scripts/Initialize-LocalUrls.ps1'
New-Item -ItemType Directory -Path $directory | Out-Null
$fixture = @'
ASPNETCORE_ENVIRONMENT=Development
ConnectionStrings__Database=Host=localhost;Database=synthetic;Password=SYNTHETIC_DB_SECRET
Email__AppPassword=SYNTHETIC_SMTP_SECRET
AuthenticationEmail__WebInvitationUrl=https://old.ngrok-free.dev/accept-invitation
AuthenticationEmail__WebResetUrl=https://old.trycloudflare.com/reset-password
AuthenticationEmail__WebVerificationUrl=https://old.ngrok-free.dev/confirm-email
AuthenticationEmail__MobileInvitationUrl=bhome://accept-invitation
AuthenticationEmail__TrustedOrigins__0=https://old.ngrok-free.dev
AuthenticationEmail__TrustedOrigins__1=bhome://accept-invitation
Cors__AllowedOrigins__0=http://localhost:5173
Cors__AllowedOrigins__4=http://192.168.1.10:8081
AuthWeb__AllowedOrigins__2=https://old.ngrok-free.dev
AnonymousSigning__PublicSigningUrl=https://old.ngrok-free.dev/contract-signing
'@
[IO.File]::WriteAllText($profile, $fixture)
function Assert([bool]$condition,[string]$message) { if (!$condition) { throw $message } }
try {
    @{ 'Email:AppPassword'='SYNTHETIC_STABLE_PASSWORD'; 'Jwt:SigningKey'='SYNTHETIC_STABLE_KEY';
       'AuthenticationEmail:WebInvitationUrl'='https://override.ngrok-free.dev/accept-invitation';
       'Cors:AllowedOrigins:4'='https://obsolete.trycloudflare.com';
       'AuthWeb:AllowedOrigins:2'='http://127.0.0.1:5173' } |
        ConvertTo-Json -Compress | dotnet user-secrets set --id $id | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated URL fixtures.' }
    $envHash = (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash
    $secretHash = (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash
    & $script -EnvironmentFile $profile -UserSecretsId $id
    Assert ($envHash -eq (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash) 'Preview changed the environment file.'
    Assert ($secretHash -eq (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash) 'Preview changed user-secrets.'
    & $script -EnvironmentFile $profile -UserSecretsId $id -Apply
    $content = [IO.File]::ReadAllText($profile)
    $settings = Get-Content -Raw -LiteralPath $secretFile | ConvertFrom-Json
    Assert ($content.Contains('AuthenticationEmail__WebInvitationUrl=http://localhost:5173/accept-invitation')) 'Invitation callback did not migrate.'
    Assert ($settings.'AuthenticationEmail:WebInvitationUrl' -eq 'http://localhost:5173/accept-invitation') 'A higher-priority override still points elsewhere.'
    Assert ($content.Contains('AnonymousSigning__PublicSigningUrl=https://localhost:5176/contract-signing')) 'Signing HTTPS was lost.'
    Assert ($content.Contains('ConnectionStrings__Database=Host=localhost;Database=synthetic;Password=SYNTHETIC_DB_SECRET')) 'Database configuration changed.'
    Assert ($content.Contains('Email__AppPassword=SYNTHETIC_SMTP_SECRET')) 'SMTP credential changed.'
    Assert ($settings.'Email:AppPassword' -ceq 'SYNTHETIC_STABLE_PASSWORD') 'SMTP secret changed.'
    Assert ($settings.'Jwt:SigningKey' -ceq 'SYNTHETIC_STABLE_KEY') 'JWT key changed.'
    Assert ($content.Contains('AuthenticationEmail__MobileInvitationUrl=bhome://accept-invitation')) 'Native callback changed.'
    Assert ($content.Contains('Cors__AllowedOrigins__4=http://192.168.1.10:8081')) 'Legitimate LAN origin was removed.'
    Assert ($settings.'AuthWeb:AllowedOrigins:2' -eq 'http://127.0.0.1:5173') 'Legitimate higher-priority origin was removed.'
    Assert (!$content.Contains('ngrok') -and !$content.Contains('trycloudflare')) 'Tunnel values remain in the local file.'
    Assert (!([IO.File]::ReadAllText($secretFile) -match 'ngrok|trycloudflare')) 'Tunnel overrides remain in user-secrets.'
    $envHash = (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash
    & $script -EnvironmentFile $profile -UserSecretsId $id -Apply
    Assert ($envHash -eq (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash) 'Rerunning migration changed the local profile.'
    [IO.File]::WriteAllText($profile, 'ASPNETCORE_ENVIRONMENT=Production')
    $rejected=$false
    try { & $script -EnvironmentFile $profile -UserSecretsId $id -Apply } catch { $rejected=$_.Exception.Message.Contains('not Development') }
    Assert $rejected 'Production profile must not be migrated as Local.'
    Write-Output 'PASS: URL preview/migration, credential and native-link preservation, cross-source origins, idempotency and Production rejection.'
} finally {
    if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile }
    Remove-Item -LiteralPath $directory
    if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile }
    if (Test-Path -LiteralPath $secretDirectory) { Remove-Item -LiteralPath $secretDirectory }
}
