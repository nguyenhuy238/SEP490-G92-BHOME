# Compatibility entry point. Development no longer needs a recipient migration; never writes settings or sends mail.
param(
    [switch]$UseConfiguredTestRecipient,
    [string]$EnvironmentFile = '.env',
    [string]$UserSecretsId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
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
Write-Output 'Development accepts every valid email address. No allowlist or TestRecipient migration is required. SMTP credentials, User Secrets and .env were preserved; no email was sent.'
