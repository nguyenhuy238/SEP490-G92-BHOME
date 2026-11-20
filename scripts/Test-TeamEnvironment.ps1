# Synthetic, offline regression test. Does not inspect or change the real .env.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tool = Join-Path $PSScriptRoot 'Initialize-TeamEnvironment.ps1'
$fixtureDirectory = Join-Path $repo ('.tools/team-env-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixtureDirectory) | Out-Null
$fixture = Join-Path $fixtureDirectory '.env'
$privateValue = 'SYNTHETIC_PRIVATE_VALUE'
function Assert([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}
try {
    $original = [IO.File]::ReadAllText((Join-Path $repo '.env.example')) + "`nEmail__AppPassword=$privateValue`n"
    [IO.File]::WriteAllText($fixture, $original)
    $check = (& $tool -EnvironmentFile $fixture -CheckOnly -SkipNetworkChecks) -join "`n"
    Assert ($check.Contains('PASS: local team configuration')) 'Baseline .env.example does not match the team profile.'
    Assert ([IO.File]::ReadAllText($fixture) -eq $original) 'CheckOnly wrote to the environment file.'

    $drifted = $original.Replace('Email__Host=127.0.0.1', 'Email__Host=smtp.gmail.com')
    $drifted += "`n# BHOME Cloudflare email origin (managed by Configure-CloudflareEmailLinks.ps1)`nAuthWeb__AllowedOrigins__4=https://old-tunnel.example.invalid`n"
    [IO.File]::WriteAllText($fixture, $drifted)
    $rejected = $false
    try { & $tool -EnvironmentFile $fixture -CheckOnly -SkipNetworkChecks | Out-Null } catch { $rejected = $true }
    Assert $rejected 'CheckOnly did not detect drift.'
    Assert ([IO.File]::ReadAllText($fixture) -eq $drifted) 'CheckOnly modified the drifted fixture.'

    $output = (& $tool -EnvironmentFile $fixture -SkipNetworkChecks) -join "`n"
    Assert (-not $output.Contains($privateValue)) 'Setup output contained a private value.'
    $updated = [IO.File]::ReadAllText($fixture)
    Assert ($updated.Contains('Email__Host=127.0.0.1')) 'Capture host was not repaired.'
    Assert ($updated.Contains('Email__AppPassword=' + $privateValue)) 'Existing private value was modified.'
    Assert (-not $updated.Contains('https://old-tunnel.example.invalid')) 'Old managed tunnel origin remains.'
    Assert ($updated.Contains('AnonymousSigning__PublicSigningUrl=https://localhost:5176/contract-signing')) 'Local signing callback was not set.'
    Assert ($updated.Contains('Cors__AllowedOrigins__4=http://localhost:8081')) 'Expo Web localhost CORS origin was not configured.'
    Assert ($updated.Contains('Cors__AllowedOrigins__5=http://127.0.0.1:8081')) 'Expo Web loopback CORS origin was not configured.'
    & $tool -EnvironmentFile $fixture -SkipNetworkChecks | Out-Null
    Assert ([IO.File]::ReadAllText($fixture) -eq $updated) 'Repeated setup is not idempotent.'
    & $tool -EnvironmentFile $fixture -CheckOnly -SkipNetworkChecks | Out-Null

    [IO.File]::WriteAllText($fixture, $original + "`nEmail__Host=duplicate`n")
    $rejected = $false
    try { & $tool -EnvironmentFile $fixture -SkipNetworkChecks | Out-Null } catch { $rejected = $true }
    Assert $rejected 'Duplicate key was not rejected.'
    [IO.File]::WriteAllText($fixture, $original.Replace('POSTGRES_PORT=5434', 'POSTGRES_PORT=5432'))
    $rejected = $false
    try { & $tool -EnvironmentFile $fixture -SkipNetworkChecks | Out-Null } catch { $rejected = $true }
    Assert $rejected 'Mismatched PostgreSQL port was not rejected.'

    Write-Output 'PASS: team profile, read-only check, safe drift repair, secrets, tunnel removal, idempotency, duplicate keys and PostgreSQL port mismatch.'
} finally {
    if ([IO.Directory]::Exists($fixtureDirectory)) {
        [IO.Directory]::Delete($fixtureDirectory, $true)
    }
}
