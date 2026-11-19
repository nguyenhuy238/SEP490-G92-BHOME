# Explicit migration for existing Development SMTP users. Never sends mail, changes credentials or writes .env.
param(
    [switch]$UseConfiguredTestRecipient,
    [string]$EnvironmentFile = '.env',
    [string]$UserSecretsId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
if (!$UseConfiguredTestRecipient) { throw 'Select -UseConfiguredTestRecipient to explicitly allow the existing Email:TestRecipient for local SMTP.' }
foreach ($name in @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value -and $value -ne 'Development') { throw 'This migration only configures Development user-secrets. Use the deployment secret store for Staging/Production.' }
}
$repo = Split-Path -Parent $PSScriptRoot
$path = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
if (!(Test-Path -LiteralPath $path)) { throw 'Selected local environment file is missing.' }
$settings = @{}
foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $path) {
    if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') {
        $settings[$Matches[1].Replace('__', ':')] = $Matches[2].Trim().Trim([char]34, [char]39)
    }
}
if ($settings.ASPNETCORE_ENVIRONMENT -and $settings.ASPNETCORE_ENVIRONMENT -ne 'Development') { throw 'Selected environment file is not a Development profile.' }
if (!$UserSecretsId) {
    $project = [xml][IO.File]::ReadAllText((Join-Path $repo 'src/backend/BHome.Api/BHome.Api.csproj'))
    $UserSecretsId = [string]$project.Project.PropertyGroup.UserSecretsId
}
if (!$UserSecretsId -or $UserSecretsId.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $UserSecretsId -in @('.', '..')) {
    throw 'A valid API UserSecretsId is required.'
}
$secretFile = Join-Path $env:APPDATA "Microsoft/UserSecrets/$UserSecretsId/secrets.json"
if (Test-Path -LiteralPath $secretFile) {
    try { $secrets = Get-Content -Encoding UTF8 -Raw -LiteralPath $secretFile | ConvertFrom-Json }
    catch { throw 'Could not read Development user-secrets JSON. No changes were made; configuration values withheld.' }
    foreach ($property in $secrets.PSObject.Properties) { $settings[$property.Name] = $property.Value }
    if ($secrets.Email) {
        foreach ($property in $secrets.Email.PSObject.Properties) { $settings['Email:' + $property.Name] = $property.Value }
    }
}
foreach ($entry in Get-ChildItem Env:Email__*) { $settings[$entry.Name.Replace('__', ':')] = $entry.Value }
if ($settings['Email:DeliveryMode'] -and $settings['Email:DeliveryMode'] -ne 'Smtp') {
    throw 'This migration is only for existing SMTP configuration. Local Mailpit Capture needs no SMTP recipient migration.'
}
if (@($settings.Keys | Where-Object { $_ -like 'Email:AllowedRecipients:*' -or $_ -eq 'Email:AllowedRecipients' }).Count -gt 0) {
    Write-Output 'Existing Email:AllowedRecipients configuration preserved. No credentials or environment files changed.'
    return
}
$recipient = [string]$settings['Email:TestRecipient']
try { $mailbox = [Net.Mail.MailAddress]::new($recipient) }
catch { throw 'Email:TestRecipient is missing or invalid. Configure an approved test mailbox first; no changes were made.' }
if ($recipient.Length -gt 254 -or $recipient.Contains("`r") -or $recipient.Contains("`n") -or
    $mailbox.Address -cne $recipient -or !$mailbox.Host.Contains('.')) {
    throw 'Email:TestRecipient must contain one bare approved mailbox. No changes were made; value withheld.'
}
# Merge just this non-secret key through stdin. Never put mailbox/SMTP credentials in process arguments or logs.
@{ 'Email:AllowedRecipients:0' = $recipient } | ConvertTo-Json -Compress | dotnet user-secrets set --id $UserSecretsId | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not update the Development SMTP allowlist. Existing SMTP credentials were not replaced.' }
Write-Output 'Configured the existing test mailbox as the local SMTP allowlist. SMTP credentials and .env were preserved. No email was sent. Restart the API/Visual Studio debugging session.'
