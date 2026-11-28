$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'scripts/Use-LocalTools.ps1')
$id = 'bhome-local-email-tests-' + [Guid]::NewGuid().ToString('N')
$directory = Join-Path ([IO.Path]::GetTempPath()) $id
$secretDirectory = Join-Path $env:APPDATA "Microsoft/UserSecrets/$id"
$secretFile = Join-Path $secretDirectory 'secrets.json'
$profile = Join-Path $directory '.env'
$script = Join-Path $repo 'scripts/Initialize-LocalEmail.ps1'
New-Item -ItemType Directory -Path $directory | Out-Null
[IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Development`nEmail__DeliveryMode=Smtp`n")
function Assert([bool]$condition, [string]$message) { if (!$condition) { throw $message } }
function Seed-Secrets($values) {
    $values | ConvertTo-Json -Compress | dotnet user-secrets set --id $id | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated test secrets.' }
}
try {
    Seed-Secrets @{ 'Email:TestRecipient'='approved@example.invalid'; 'Email:AppPassword'='SYNTHETIC_PRIVATE_SECRET'; 'Email:Username'='sender@example.invalid'; 'Unrelated:Setting'='preserve' }
    $profileHash = (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash
    & $script -UseConfiguredTestRecipient -EnvironmentFile $profile -UserSecretsId $id
    $settings = Get-Content -Raw -LiteralPath $secretFile | ConvertFrom-Json
    Assert (!$settings.PSObject.Properties['Email:AllowedRecipients:0']) 'Compatibility script must not create an allowlist.'
    Assert ($settings.'Email:AppPassword' -ceq 'SYNTHETIC_PRIVATE_SECRET') 'SMTP credential was changed.'
    Assert ($settings.'Unrelated:Setting' -ceq 'preserve') 'Unrelated configuration was changed.'
    Assert ($profileHash -eq (Get-FileHash -LiteralPath $profile -Algorithm SHA256).Hash) 'Environment file was changed.'
    Seed-Secrets @{ 'Email:AllowedRecipients:0'='old@example.invalid'; 'Email:AllowAnyRecipientInDevelopment'='false' }
    $before = (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash
    & $script -EnvironmentFile $profile -UserSecretsId $id
    & $script -UseConfiguredTestRecipient -EnvironmentFile $profile -UserSecretsId $id
    Assert ($before -eq (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash) 'An existing allowlist or credential was overwritten.'
    dotnet user-secrets remove 'Email:TestRecipient' --id $id | Out-Null
    $before = (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash
    & $script -EnvironmentFile $profile -UserSecretsId $id
    Assert ($before -eq (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash) 'Missing diagnostic mailbox must not require migration.'
    [IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Staging`n")
    $rejected = $false
    try { & $script -UseConfiguredTestRecipient -EnvironmentFile $profile -UserSecretsId $id }
    catch { $rejected = $_.Exception.Message.Contains('not a Development profile') }
    Assert $rejected 'Staging configuration must not be migrated through local user-secrets.'
    [IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Development`n")
    [IO.File]::WriteAllText($secretFile, '{"Email:AppPassword":"SYNTHETIC_PRIVATE_SECRET", malformed')
    $before = (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash
    $rejected = $false
    try { & $script -UseConfiguredTestRecipient -EnvironmentFile $profile -UserSecretsId $id }
    catch { $rejected = $_.Exception.Message.Contains('values withheld') -and !$_.Exception.Message.Contains('SYNTHETIC_PRIVATE_SECRET') }
    Assert $rejected 'Malformed user-secrets must not expose configuration contents.'
    Assert ($before -eq (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash) 'Malformed user-secrets were overwritten.'
    Write-Output 'PASS: local email compatibility no-op, credential/env preservation, idempotency, no diagnostic mailbox requirement, Staging rejection and malformed JSON redaction.'
} finally {
    if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile }
    Remove-Item -LiteralPath $directory
    if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile }
    if (Test-Path -LiteralPath $secretDirectory) { Remove-Item -LiteralPath $secretDirectory }
}
