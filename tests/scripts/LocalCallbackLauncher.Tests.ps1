$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Join-Path $repo 'scripts/Start-LocalPublicLinks.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ('bhome-local-callback-tests-' + [Guid]::NewGuid().ToString('N'))
$profile = Join-Path $work '.env'
$secretDirectory = Join-Path $work 'Microsoft/UserSecrets/bhome-api-development'
$secretFile = Join-Path $secretDirectory 'secrets.json'
$saved = @{}
foreach ($name in @('APPDATA', 'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'BHOME_WEB_HTTPS', 'PATH', 'DOTNET_ROOT')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
function Assert([bool]$condition, [string]$message) { if (!$condition) { throw $message } }
function npm.cmd {
    $probe.LaunchCount++
    $probe.Arguments = @($args)
    $probe.LaunchDirectory = (Get-Location).Path
    Assert ($env:BHOME_WEB_HTTPS -eq 'true') 'Callback portal must use HTTPS.'
    if ($probe.FailLaunch) { throw 'Synthetic frontend failure.' }
    $global:LASTEXITCODE = 0
}
function Start-Process { throw 'Callback launcher must not start tunnels or background helpers.' }
function Invoke-RestMethod { throw 'Callback launcher must not contact a tunnel/provider.' }
function dotnet { throw 'Callback launcher must not change user-secrets.' }
New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
try {
    $env:APPDATA = $work
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:BHOME_WEB_HTTPS = 'false'
    [IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Development`nAnonymousSigning__PublicSigningUrl=https://localhost:5176/contract-signing`n")
    [IO.File]::WriteAllText($secretFile, '{"Unrelated:Setting":"synthetic-preserve"}')
    $profileHash = (Get-FileHash -LiteralPath $profile).Hash
    $secretHash = (Get-FileHash -LiteralPath $secretFile).Hash
    $probe = [pscustomobject]@{ LaunchCount = 0; FailLaunch = $false; Arguments = @(); LaunchDirectory = '' }
    & $launcher -EnvironmentFile $profile
    Assert ($probe.LaunchCount -eq 1) 'Expected one frontend invocation.'
    Assert ($probe.LaunchDirectory -eq (Join-Path $repo 'src/owner-web')) 'Expected the current Owner Web workspace.'
    # PowerShell removes the argument terminator when invoking a function mock.
    Assert (($probe.Arguments -join ' ') -eq 'run dev --host localhost --port 5176 --strictPort') 'Expected develop-compatible host/port flags.'
    Assert ($env:BHOME_WEB_HTTPS -eq 'false') 'HTTPS override leaked into the caller.'
    Assert ($profileHash -eq (Get-FileHash -LiteralPath $profile).Hash) 'Local profile was overwritten.'
    Assert ($secretHash -eq (Get-FileHash -LiteralPath $secretFile).Hash) 'User-secrets were overwritten.'
    foreach ($key in @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'Deployment__Environment')) {
        foreach ($environment in @('Staging', 'Production')) {
            [IO.File]::WriteAllText($profile, "$key=$environment`n")
            $before = (Get-FileHash -LiteralPath $profile).Hash
            $rejected = $false
            try { & $launcher -EnvironmentFile $profile } catch { $rejected = $_.Exception.Message.Contains('not Development') }
            Assert $rejected 'Deployment profiles must be rejected before launching.'
            Assert ($probe.LaunchCount -eq 1) 'A deployment profile started the frontend.'
            Assert ($before -eq (Get-FileHash -LiteralPath $profile).Hash) 'Rejected profile was changed.'
        }
    }
    [IO.File]::WriteAllText($profile, "ASPNETCORE_ENVIRONMENT=Development`n")
    foreach ($key in @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT')) {
        [Environment]::SetEnvironmentVariable($key, 'Staging', 'Process')
        $rejected = $false
        try { & $launcher -EnvironmentFile $profile } catch { $rejected = $_.Exception.Message.Contains('only supports Development') }
        Assert $rejected 'Deployment process environment must be rejected.'
        [Environment]::SetEnvironmentVariable($key, 'Development', 'Process')
    }
    $locationBefore = (Get-Location).Path
    $probe.FailLaunch = $true
    $rejected = $false
    try { & $launcher -EnvironmentFile $profile } catch { $rejected = $_.Exception.Message -eq 'Synthetic frontend failure.' }
    Assert $rejected 'Frontend failure was swallowed.'
    Assert ((Get-Location).Path -eq $locationBefore) 'Working directory was not restored after failure.'
    Assert ($env:BHOME_WEB_HTTPS -eq 'false') 'HTTPS override was not restored after failure.'
    Assert ($secretHash -eq (Get-FileHash -LiteralPath $secretFile).Hash) 'User-secrets changed after rejected launches.'
    Write-Output 'PASS: local HTTPS launch, config/secret preservation, six deployment-profile rejections, process guards and failure cleanup.'
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    foreach ($path in @($profile, $secretFile)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path } }
    foreach ($path in @($secretDirectory, (Split-Path -Parent $secretDirectory), (Join-Path $work 'Microsoft'), $work)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
}
