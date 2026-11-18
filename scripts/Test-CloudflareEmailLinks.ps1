# Offline regression tests: never connect to Cloudflare or touch the real .env file.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'Configure-CloudflareEmailLinks.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('bhome-email-url-test-' + [Guid]::NewGuid().ToString('N') + '.env')
$secret = 'do-not-print-this-secret'
$original = @"
Email__AppPassword=$secret
AuthenticationEmail__WebResetUrl=http://localhost:5173/reset-password
AuthenticationEmail__WebInvitationUrl=http://localhost:5173/accept-invitation
AuthenticationEmail__WebVerificationUrl=http://localhost:5173/confirm-email
AuthenticationEmail__TrustedOrigins__0=http://localhost:5173
AuthenticationEmail__MobileResetUrl=bhome://reset-password
AuthenticationEmail__TrustedOrigins__1=bhome://reset-password
"@
function Assert([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}
function Expect-Rejection([string]$origin) {
    $rejected = $false
    try {
        & $script -PublicWebOrigin $origin -EnvironmentFile $fixture -Apply -SkipRemoteProbe 3>$null | Out-Null
    } catch { $rejected = $true }
    Assert $rejected ("Invalid origin unexpectedly accepted: " + $origin)
    Assert ([IO.File]::ReadAllText($fixture) -eq $original) 'Invalid origin changed the environment file.'
}
try {
    [IO.File]::WriteAllText($fixture, $original)
    $output = (& $script -PublicWebOrigin 'https://owner.example.com' -EnvironmentFile $fixture -SkipRemoteProbe 3>$null) -join "`n"
    Assert ([IO.File]::ReadAllText($fixture) -eq $original) 'Default preview modified the environment file.'
    Assert ($output.Contains('Preview only')) 'Preview message was missing.'
    Assert (-not $output.Contains($secret)) 'Preview exposed an environment secret.'

    foreach ($invalid in @(
        'http://owner.example.com',
        'https://localhost',
        'https://127.0.0.1',
        'https://owner.example.com:8443',
        'https://owner.example.com/subpath',
        'https://owner.example.com/?token=abc',
        'https://user:pass@owner.example.com',
        'https://owner.example.invalid'
    )) { Expect-Rejection $invalid }

    & $script -PublicWebOrigin 'https://owner.example.com' -EnvironmentFile $fixture -Apply -SkipRemoteProbe 3>$null | Out-Null
    $updated = [IO.File]::ReadAllText($fixture)
    Assert ($updated.Contains('AuthenticationEmail__WebResetUrl=https://owner.example.com/reset-password')) 'Reset callback was not updated.'
    Assert ($updated.Contains('AuthenticationEmail__WebInvitationUrl=https://owner.example.com/accept-invitation')) 'Invitation callback was not updated.'
    Assert ($updated.Contains('AuthenticationEmail__WebVerificationUrl=https://owner.example.com/confirm-email')) 'Verification callback was not updated.'
    Assert ($updated.Contains('AuthenticationEmail__TrustedOrigins__0=https://owner.example.com')) 'Trusted origin was not updated.'
    Assert ($updated.Contains('AnonymousSigning__PublicSigningUrl=https://owner.example.com/contract-signing')) 'Contract signing URL was not updated.'
    Assert ($updated.Contains('AuthWeb__AllowedOrigins__0=https://owner.example.com')) 'Cookie-auth Origin allowlist was not updated.'
    Assert ($updated.Contains('Email__AppPassword=' + $secret)) 'Unrelated SMTP secret was changed.'
    Assert ($updated.Contains('AuthenticationEmail__MobileResetUrl=bhome://reset-password')) 'Mobile deep link was changed.'
    Assert ($updated.Contains('AuthenticationEmail__TrustedOrigins__1=bhome://reset-password')) 'Mobile trusted origin was changed.'

    & $script -PublicWebOrigin 'https://owner.example.com' -EnvironmentFile $fixture -Apply -SkipRemoteProbe 3>$null | Out-Null
    Assert ([IO.File]::ReadAllText($fixture) -eq $updated) 'Repeated Apply was not idempotent.'

    [IO.File]::WriteAllText($fixture, $original + "`nAuthenticationEmail__WebInvitationUrl=https://duplicate.example.com/")
    $rejectedDuplicate = $false
    try {
        & $script -PublicWebOrigin 'https://owner.example.com' -EnvironmentFile $fixture -Apply -SkipRemoteProbe 3>$null | Out-Null
    } catch { $rejectedDuplicate = $true }
    Assert $rejectedDuplicate 'Duplicate keys were not rejected.'
    Assert ([IO.File]::ReadAllText($fixture).Contains('https://duplicate.example.com/')) 'Duplicate-key rejection modified the fixture.'

    Write-Output 'PASS: preview, invalid origins, account email and contract signing URLs, cookie origins, secret preservation, idempotency and duplicate-key rejection.'
} finally {
    if ([IO.File]::Exists($fixture)) { [IO.File]::Delete($fixture) }
}
