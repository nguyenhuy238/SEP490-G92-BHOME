# Offline-only: synthetic UserSecretsId, fake credentials, no network or real email.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'scripts/Use-LocalTools.ps1')
$id = 'bhome-local-gmail-tests-' + [Guid]::NewGuid().ToString('N')
$directory = Join-Path ([IO.Path]::GetTempPath()) $id
$secretsDirectory = Join-Path $env:APPDATA "Microsoft/UserSecrets/$id"
$secretFile = Join-Path $secretsDirectory 'secrets.json'
$profile = Join-Path $directory '.env'
$command = Join-Path $repo 'scripts/Configure-LocalGmail.ps1'
function Assert([bool]$test, [string]$message) { if (!$test) { throw $message } }
New-Item -ItemType Directory -Path $directory | Out-Null
try {
    [IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Development`nEmail__DeliveryMode=Capture`nEmail__Host=localhost`n")
    $hash = (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash
    $failure = $false
    try { & $command -EnvironmentFile $profile -UserSecretsId $id -CheckOnly }
    catch { $failure = $_.Exception.Message.Contains('NOT configured') }
    Assert $failure 'Empty config should not claim Gmail works.'
    $password = ConvertTo-SecureString 'SYNTHETIC_PRIVATE_TEST_1234' -AsPlainText -Force
    $failure = $false
    try { & $command -EnvironmentFile $profile -UserSecretsId $id -Sender 'invalid-address' -AllowedRecipients @('approved@example.invalid') -AppPassword $password }
    catch { $failure = $_.Exception.Message.Contains('Sender must be') }
    Assert $failure 'Invalid sender should be rejected.'
    Assert (!(Test-Path -LiteralPath $secretFile)) 'Invalid input wrote credentials.'
    & $command -EnvironmentFile $profile -UserSecretsId $id -Sender 'bhome.testing@gmail.com' -AllowedRecipients @('approved@example.invalid') -AppPassword $password
    Assert ($LASTEXITCODE -eq 0) 'Could not write isolated local Gmail secrets.'
    & $command -EnvironmentFile $profile -UserSecretsId $id -CheckOnly
    $data = Get-Content -LiteralPath $secretFile -Raw | ConvertFrom-Json
    Assert ($data.'Email:DeliveryMode' -eq 'Smtp') 'Gmail SMTP was not enabled.'
    Assert ($data.'Email:Host' -eq 'smtp.gmail.com' -and $data.'Email:Port' -eq '587') 'Wrong SMTP endpoint.'
    Assert ($data.'Email:UseStartTls' -eq 'true') 'Gmail STARTTLS must be enabled.'
    Assert ($data.'Email:AllowedRecipients:0' -eq 'approved@example.invalid') 'Recipient was not allowlisted.'
    Assert ($data.'Email:AppPassword' -eq 'SYNTHETIC_PRIVATE_TEST_1234') 'Secure credential was not saved.'
    Assert ($hash -eq (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash) 'Existing .env changed.'
    $before = (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash
    $failure = $false
    try { & $command -EnvironmentFile $profile -UserSecretsId $id -Sender 'bhome.testing@gmail.com' -AllowedRecipients @('other@example.invalid') -AppPassword $password }
    catch { $failure = $_.Exception.Message.Contains('existing SMTP allowlist differs') }
    Assert $failure 'Previously approved recipient list must not change implicitly.'
    Assert ($before -eq (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash) 'Rejected change touched secrets.'
    [IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Production`n")
    $failure = $false
    try { & $command -EnvironmentFile $profile -UserSecretsId $id -Sender 'bhome.testing@gmail.com' -AllowedRecipients @('approved@example.invalid') -AppPassword $password }
    catch { $failure = $_.Exception.Message.Contains('Development profile') }
    Assert $failure 'Production profile must not be modified.'
    Assert ($before -eq (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash) 'Production rejection changed secrets.'
    Write-Output 'PASS: local Gmail opt-in, offline validation, consented allowlist, User Secrets and .env preservation.'
} finally {
    if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile }
    if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory }
    if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile }
    if (Test-Path -LiteralPath $secretsDirectory) { Remove-Item -LiteralPath $secretsDirectory }
}
