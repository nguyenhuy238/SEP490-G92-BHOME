[CmdletBinding()]
param(
    [ValidateSet('tenant.sample@example.invalid')][string]$TenantEmail = 'tenant.sample@example.invalid',
    [ValidateSet('--inspect', '--seed', '--verify')][string]$Mode = '--inspect',
    [string]$EnvironmentFile = '.env.neon.dev04'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$envPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$saved = @{}
try {
    foreach ($line in [IO.File]::ReadAllLines($envPath)) {
        if ($line -match '^([A-Za-z][A-Za-z0-9_-]+)=(.*)$') {
            $name = $Matches[1]; $value = $Matches[2]
            $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
    foreach ($name in @('DOTNET_ENVIRONMENT', 'BHOME_DATABASE_BRANCH', 'Jobs__Enabled', 'NotificationChannels__AutomationEnabled', 'ContractPdf__TemplateId')) {
        if (-not $saved.ContainsKey($name)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    }
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:BHOME_DATABASE_BRANCH = 'development'
    $env:Jobs__Enabled = 'false'
    $env:NotificationChannels__AutomationEnabled = 'false'
    $env:ContractPdf__TemplateId = 'main-contract-development-v1'
    Push-Location $repo
    try {
        & dotnet build tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj --no-restore -m:1 /nr:false /p:UseSharedCompilation=false -v:q
        if ($LASTEXITCODE -ne 0) { throw 'Tenant fixture tool build failed.' }
        & dotnet tools/BHome.LocalDevelopment/bin/Debug/net8.0/BHome.LocalDevelopment.dll seed-tenant-mobile-demo $TenantEmail $Mode
        if ($LASTEXITCODE -ne 0) { throw 'Tenant fixture command failed; see redacted diagnostic above. Existing credentials are preserved.' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
