# Generates ignored local-development credentials only. Does not start services or change user-secrets.
param([string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$target = Join-Path $repositoryRoot '.env'
if (Test-Path -LiteralPath $target) { Write-Output '.env exists; preserved without changes.'; return }
function New-LocalSecret {
    $bytes = New-Object byte[] 48
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$postgresPassword = New-LocalSecret
$storagePassword = New-LocalSecret
$jwtKey = New-LocalSecret
$content = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $repositoryRoot '.env.example') -Raw
$content = $content.Replace('replace-with-local-postgres-password', $postgresPassword)
$content = $content.Replace('replace-with-local-minio-user', 'bhome_local_admin')
$content = $content.Replace('replace-with-local-minio-password', $storagePassword)
# Root storage credentials are acceptable for this loopback-only local setup, never production.
$content = $content.Replace('replace-with-scoped-storage-access-key', 'bhome_local_admin')
$content = $content.Replace('replace-with-scoped-storage-secret-key', $storagePassword)
$content = $content.Replace('replace-with-random-key-at-least-32-bytes', $jwtKey)
$content = $content.Replace('replace-with-random-key-at-least-32-characters', (New-LocalSecret))
$content = $content.Replace('AnonymousSigning__OtpHmacKey=', ('AnonymousSigning__OtpHmacKey=' + (New-LocalSecret)))
$stream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    try { $writer.Write($content) } finally { $writer.Dispose() }
} finally { $stream.Dispose() }
Write-Output 'Created ignored .env with random local credentials. No credentials were printed.'
