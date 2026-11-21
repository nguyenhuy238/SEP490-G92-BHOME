# Serve the anonymous contract signing page on the HTTPS URL embedded in local emails.
# This is intentionally a separate Vite process from the Owner HTTP portal on :5173.
# Do not echo signing tokens, OTPs, API secrets, or browser URLs containing fragments.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repositoryRoot 'src/owner-web'
$certRoot = Join-Path $repositoryRoot '.tools/team-tls'
$certificate = if (Test-Path -LiteralPath (Join-Path $certRoot 'localhost.pem')) {
    Join-Path $certRoot 'localhost.pem'
} else { Join-Path $certRoot 'localhost.crt' }
if (!(Test-Path -LiteralPath $certificate) -or !(Test-Path -LiteralPath (Join-Path $certRoot 'localhost.key'))) {
    throw 'Missing localhost HTTPS certificate/key in .tools/team-tls. Run local environment/certificate preparation first.'
}
$listener = Get-NetTCPConnection -LocalPort 5176 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'https://localhost:5176/contract-signing' -TimeoutSec 6
        if ($response.StatusCode -eq 200) {
            Write-Output 'Signing HTTPS portal is already serving /contract-signing on localhost:5176. Reusing it.'
            return
        }
    } catch {}
    throw 'Port 5176 is occupied but the HTTPS signing page is not healthy. Stop the conflicting process before retrying.'
}
Write-Output 'Starting BHOME local anonymous signing portal: https://localhost:5176/contract-signing'
Write-Output 'Keep this terminal open while testing emailed signing links. localhost links only work on this workstation.'
$oldHttps = [Environment]::GetEnvironmentVariable('BHOME_WEB_HTTPS', 'Process')
try {
    $env:BHOME_WEB_HTTPS = 'true'
    Push-Location $webRoot
    try { & npm.cmd run dev } finally { Pop-Location }
} finally {
    if ($null -eq $oldHttps) { Remove-Item Env:BHOME_WEB_HTTPS -ErrorAction SilentlyContinue }
    else { $env:BHOME_WEB_HTTPS = $oldHttps }
}
