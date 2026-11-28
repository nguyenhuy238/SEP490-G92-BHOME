# Opt-in real Gmail SMTP for local Development. Never changes .env, database, Docker or deployment.
# App Password is entered without echo and stored only in the current API's .NET User Secrets.
[CmdletBinding()]
param(
    [string]$Sender,
    # Legacy parameters accepted for existing callers; Development has no recipient allowlist.
    [string[]]$AllowedRecipients,
    [switch]$AllowAnyRecipient,
    [switch]$UseExistingCredentials,
    [Security.SecureString]$AppPassword,
    [switch]$CheckOnly,
    [string]$Recipient,
    [string]$EnvironmentFile = '.env',
    [string]$UserSecretsId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$root = Split-Path -Parent $PSScriptRoot
$file = if ([IO.Path]::IsPathRooted($EnvironmentFile)) {
    [IO.Path]::GetFullPath($EnvironmentFile)
} else {
    [IO.Path]::GetFullPath((Join-Path $root $EnvironmentFile))
}
if (!(Test-Path -LiteralPath $file)) { throw 'Selected Development environment file is missing.' }
foreach ($key in @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT')) {
    $environmentName = [Environment]::GetEnvironmentVariable($key, 'Process')
    if ($environmentName -and $environmentName -ne 'Development') {
        throw 'Local Gmail setup is Development-only; Staging and Production secrets are not touched.'
    }
}
$fileEnvironment = Get-Content -Encoding UTF8 -LiteralPath $file |
    Where-Object { $_ -match '^ASPNETCORE_ENVIRONMENT=' } | Select-Object -Last 1
if ($fileEnvironment -and $fileEnvironment -ne 'ASPNETCORE_ENVIRONMENT=Development') {
    throw 'Selected file must be a Development profile.'
}

if (!$UserSecretsId) {
    $project = [xml][IO.File]::ReadAllText((Join-Path $root 'src/backend/BHome.Api/BHome.Api.csproj'))
    $UserSecretsId = [string]$project.Project.PropertyGroup.UserSecretsId
}
if (!$UserSecretsId -or $UserSecretsId -in @('.', '..') -or
    $UserSecretsId.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
    throw 'Invalid API UserSecretsId.'
}
$secretsPath = Join-Path $env:APPDATA "Microsoft/UserSecrets/$UserSecretsId/secrets.json"
$secrets = @{}
if (Test-Path -LiteralPath $secretsPath) {
    try {
        $json = Get-Content -LiteralPath $secretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($property in $json.PSObject.Properties) { $secrets[$property.Name] = $property.Value }
    } catch {
        throw 'Existing user-secrets JSON is invalid; refusing to replace it. Values withheld.'
    }
}

function Valid-Email([string]$address) {
    if ([string]::IsNullOrWhiteSpace($address) -or $address.Length -gt 254 -or
        $address.IndexOfAny([char[]]@("`r", "`n")) -ge 0) { return $false }
    try {
        $mailbox = [Net.Mail.MailAddress]::new($address)
        return $mailbox.Address -ceq $address -and $mailbox.Host.Contains('.')
    } catch { return $false }
}

if ($CheckOnly) {
    $effective = @{}
    foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $file) {
        if ($line -match '^([^#=\s]+)=(.*)$') { $effective[$Matches[1].Replace('__', ':')] = $Matches[2].Trim() }
    }
    foreach ($key in $secrets.Keys) { $effective[$key] = $secrets[$key] }
    $processOverrides = @(Get-ChildItem Env:Email__* -ErrorAction SilentlyContinue)
    if ($processOverrides.Count) { throw 'Process Email__* overrides are present; check effective API settings before sending.' }
    $ready = $effective['Email:Enabled'] -eq 'true' -and
        $effective['Email:DeliveryMode'] -eq 'Smtp' -and
        $effective['Email:Host'] -eq 'smtp.gmail.com' -and
        $effective['Email:Port'] -eq '587' -and
        $effective['Email:UseStartTls'] -eq 'true' -and
        $effective['NotificationChannels:Enabled'] -eq 'true' -and
        $effective['NotificationChannels:AutomationEnabled'] -eq 'true' -and
        (Valid-Email ([string]$effective['Email:Username'])) -and
        $effective['Email:Username'] -eq $effective['Email:FromEmail'] -and
        ![string]::IsNullOrWhiteSpace([string]$effective['Email:AppPassword'])
    if (!$ready) { throw 'Local Gmail SMTP is NOT configured. Current local email may be captured by Mailpit. Run Configure-LocalGmail.ps1 to opt in.' }
    if ($Recipient -and !(Valid-Email $Recipient)) { throw 'Recipient must be one valid email address.' }
    Write-Output 'PASS: Local Gmail SMTP configuration is present; all valid recipients are allowed in Development. Credentials withheld; SMTP acceptance/inbox delivery not tested.'
    return
}

# Process environment overrides User Secrets: do not misleadingly report success if they exist.
if (@(Get-ChildItem Env:Email__* -ErrorAction SilentlyContinue).Count) {
    throw 'Process Email__* overrides are set. Remove them before configuring local Gmail SMTP.'
}
if ($Recipient) { throw '-Recipient is supported only with -CheckOnly. No configuration changed.' }
if ($UseExistingCredentials) {
    if ($Sender -or $AppPassword) { throw '-UseExistingCredentials cannot be combined with -Sender or -AppPassword.' }
    if (![string]::IsNullOrWhiteSpace([string]$secrets['Email:AppPassword']) -and
        (Valid-Email ([string]$secrets['Email:Username'])) -and
        $secrets['Email:Username'] -eq $secrets['Email:FromEmail']) {
        $Sender = [string]$secrets['Email:Username']
        $AppPassword = ConvertTo-SecureString ([string]$secrets['Email:AppPassword']) -AsPlainText -Force
    } else {
        throw 'Existing SMTP credentials are missing or inconsistent in API User Secrets. Run without -UseExistingCredentials to enter them securely. No configuration changed.'
    }
}
if (!$Sender) { $Sender = Read-Host 'Gmail sender address' }
$Sender = $Sender.Trim()
if (!(Valid-Email $Sender) -or !$Sender.EndsWith('@gmail.com', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Sender must be a valid Gmail address. No configuration changed.'
}
if (!$AppPassword) { $AppPassword = Read-Host 'Gmail App Password (hidden)' -AsSecureString }
if (!$AppPassword -or $AppPassword.Length -lt 8) { throw 'App Password is missing or too short. No configuration changed.' }

$pointer = [IntPtr]::Zero
$privatePassword = $null
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AppPassword)
    $privatePassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($privatePassword -match '[\r\n]' -or [string]::IsNullOrWhiteSpace($privatePassword)) {
        throw 'Invalid App Password. No configuration changed.'
    }
    $options = @{
        'Email:Enabled' = 'true'
        'Email:DeliveryMode' = 'Smtp'
        'Email:Host' = 'smtp.gmail.com'
        'Email:Port' = '587'
        'Email:UseStartTls' = 'true'
        'Email:Username' = $Sender
        'Email:FromEmail' = $Sender
        'Email:FromName' = 'BHOME'
        'Email:TimeoutSeconds' = '30'
        'Email:AppPassword' = $privatePassword
        'NotificationChannels:Enabled' = 'true'
        'NotificationChannels:Mode' = 'Unconfigured'
        'NotificationChannels:AutomationEnabled' = 'true'
        'NotificationChannels:TimeoutSeconds' = '30'
    }
    $options | ConvertTo-Json -Compress -Depth 3 | dotnet user-secrets set --id $UserSecretsId | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not update local API user-secrets. No email was sent.' }
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $privatePassword = $null
}
Write-Output 'Configured Development Gmail SMTP in API User Secrets (credentials withheld). No .env/database/deployment change and no email sent.'
Write-Output 'Development allows all valid recipients without an allowlist. Restart the API and run Configure-LocalGmail.ps1 -CheckOnly. No email was sent.'
