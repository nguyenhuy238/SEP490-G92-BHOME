# Self-contained configuration checks; no provider credentials, Docker daemon or network.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$name = '.env.sepay.script-test-' + [guid]::NewGuid().ToString('N') + '.local'
$path = Join-Path $repo $name
try {
    foreach ($file in @('Initialize-SePaySandbox.ps1','Start-SePaySandbox.ps1','Test-SePayConnection.ps1','Test-SePayWebhook.ps1')) {
        $tokens = $null; $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$tokens, [ref]$parseErrors) | Out-Null
        if ($parseErrors.Count) { throw ('PowerShell parser rejected ' + $file) }
    }
    & (Join-Path $PSScriptRoot 'Initialize-SePaySandbox.ps1') -EnvironmentFile $name -PostgresPort 55439
    $first = [IO.File]::ReadAllText($path)
    if ($first -notmatch 'POSTGRES_PORT=55439' -or $first -notmatch 'Port=55439;' -or
        $first -notmatch 'Database=bhome_compact24_dev_[a-f0-9]{32};' -or $first -match 'replace-with-random-') { throw 'Generated Sandbox configuration is incomplete.' }
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'Initialize-SePaySandbox.ps1') -EnvironmentFile $name } catch { $rejected = $true }
    if (-not $rejected -or [IO.File]::ReadAllText($path) -cne $first) { throw 'Initializer must preserve an existing private profile.' }
    $invalidName = 'tracked-sepay-settings.txt'
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'Initialize-SePaySandbox.ps1') -EnvironmentFile $invalidName } catch { $rejected = $true }
    if (-not $rejected -or (Test-Path (Join-Path $repo $invalidName))) { throw 'Initializer must refuse a tracked output path.' }
    # Reject a Live profile before even trying Docker or writing its connection string.
    [IO.File]::WriteAllText($path, $first.Replace('SePay__Mode=Test','SePay__Mode=Live'), [Text.UTF8Encoding]::new($false))
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'Start-SePaySandbox.ps1') -EnvironmentFile $name -DatabaseOnly } catch { $rejected = $true }
    if (-not $rejected) { throw 'Sandbox launcher must reject Live configuration.' }
    Write-Output 'PASS: PowerShell parsing, random isolated profile, port selection, no overwrite, ignored output and Test-only guard.'
} finally {
    # Only the exact unique file created by this test is removed; never remove a user's profile.
    if ((Split-Path $path -Parent) -eq $repo -and (Split-Path $path -Leaf) -match '^\.env\.sepay\.script-test-[a-f0-9]{32}\.local$') {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}
