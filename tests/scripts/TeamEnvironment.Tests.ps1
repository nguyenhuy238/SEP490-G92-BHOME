$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$work = Join-Path ([IO.Path]::GetTempPath()) ('bhome-env-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
function Assert([bool]$condition, [string]$message) { if (!$condition) { throw $message } }
try {
    foreach ($name in @('DeveloperA', 'DeveloperB')) {
        $directory = Join-Path $work $name
        New-Item -ItemType Directory -Path $directory | Out-Null
        Copy-Item -LiteralPath (Join-Path $repositoryRoot '.env.example') -Destination (Join-Path $directory '.env.example')
        & (Join-Path $repositoryRoot 'scripts/Initialize-Local.ps1') -RepositoryRoot $directory
        $before = [IO.File]::ReadAllText((Join-Path $directory '.env'))
        & (Join-Path $repositoryRoot 'scripts/Initialize-Local.ps1') -RepositoryRoot $directory
        Assert ($before -ceq [IO.File]::ReadAllText((Join-Path $directory '.env'))) 'Existing environment was overwritten.'
        Assert ($before.Contains('SePay__Enabled=false')) 'Local SePay default changed.'
        Assert ($before.Contains('AuthenticationEmail__WebInvitationUrl=http://localhost:5173/accept-invitation')) 'Local callback is incorrect.'
        Assert ($before.Contains('AnonymousSigning__PublicSigningUrl=https://localhost:5176/contract-signing')) 'HTTPS local signing callback is incorrect.'
        $otpKey = [regex]::Match($before, '(?m)^AnonymousSigning__OtpHmacKey=([^\r\n]+)')
        Assert ($otpKey.Success) 'Signing key was not generated.'
        Assert ([Convert]::FromBase64String($otpKey.Groups[1].Value).Length -ge 32) 'Signing key must contain at least 32 random bytes.'
        Assert (!$before.Contains('Jwt__SigningKey=replace-with')) 'JWT key was not generated.'
    }
    Assert ([IO.File]::ReadAllText((Join-Path $work 'DeveloperA/.env')) -cne [IO.File]::ReadAllText((Join-Path $work 'DeveloperB/.env'))) 'Developers must get independent local credentials.'
    foreach ($file in @('Initialize-Local.ps1', 'Initialize-TeamEnvironment.ps1', 'Start-Api.ps1')) {
        $tokens = $null; $errors = $null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $repositoryRoot "scripts/$file"), [ref]$tokens, [ref]$errors) | Out-Null
        Assert ($errors.Count -eq 0) "PowerShell parse failed: $file"
    }
    Write-Output 'PASS: independent local profiles, safe rerun, local URLs, generated keys, PowerShell syntax.'
} finally {
    foreach ($name in @('DeveloperA', 'DeveloperB')) {
        foreach ($file in @('.env', '.env.example')) {
            $path = Join-Path $work "$name/$file"
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
        }
        $directory = Join-Path $work $name
        if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory }
    }
    Remove-Item -LiteralPath $work
}
