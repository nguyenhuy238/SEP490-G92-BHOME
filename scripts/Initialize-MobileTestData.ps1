param([string]$EnvironmentFile = '.env')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$configPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$previous = @{}
$credentialsPath = Join-Path $repo '.tools/mobile-test/accounts.json'
try {
    foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
        if ($line -match '^([A-Za-z][A-Za-z0-9_]*__[A-Za-z0-9_]+)=(.*)$') {
            $key = $Matches[1]
            $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $Matches[2], 'Process')
        }
    }
    foreach ($key in @('DOTNET_ENVIRONMENT', 'BHOME_DEV_TEST_PASSWORD')) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }
    $env:DOTNET_ENVIRONMENT = 'Development'
    if (-not (Test-Path -LiteralPath $credentialsPath)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $credentialsPath) | Out-Null
        $bytes = New-Object byte[] 24
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $accounts = [ordered]@{
            ownerEmail = 'owner.mobile.test@example.invalid'
            staffEmail = 'staff.mobile.test@example.invalid'
            tenantEmail = 'tenant.mobile.test@example.invalid'
            password = ('Mobile!7aA' + [Convert]::ToBase64String($bytes))
        }
        $accounts | ConvertTo-Json | Set-Content -LiteralPath $credentialsPath -Encoding UTF8
        if ($env:OS -eq 'Windows_NT') {
            $acl = New-Object Security.AccessControl.FileSecurity
            $acl.SetAccessRuleProtection($true, $false)
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'Allow')))
            Set-Acl -LiteralPath $credentialsPath -AclObject $acl
        }
    }
    $accounts = Get-Content -LiteralPath $credentialsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $env:BHOME_DEV_TEST_PASSWORD = $accounts.password
    Push-Location $repo
    try {
        $artifacts = Join-Path $repo '.tools/mobile-test-build'
        dotnet build tools/BHome.LocalDevelopment --artifacts-path $artifacts --verbosity quiet
        if ($LASTEXITCODE -ne 0) { throw 'Mobile test seed build failed.' }
        & dotnet (Join-Path $artifacts 'bin/BHome.LocalDevelopment/debug/BHome.LocalDevelopment.dll') seed-mobile-test
        if ($LASTEXITCODE -ne 0) { throw 'Mobile test seed failed. Existing data was not reset.' }
    } finally { Pop-Location }
    Write-Output 'Test credentials: .tools/mobile-test/accounts.json (private local file, do not commit/share).'
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
