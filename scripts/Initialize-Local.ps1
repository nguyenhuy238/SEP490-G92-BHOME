# Generates ignored local-development credentials only. Does not start services or change user-secrets.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repositoryRoot '.env'
if (Test-Path -LiteralPath $target) { throw '.env already exists; edit it deliberately instead of overwriting it.' }
function New-LocalSecret {
    $bytes = New-Object byte[] 48
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$postgresPassword = New-LocalSecret
$storagePassword = New-LocalSecret
$jwtKey = New-LocalSecret
$content = Get-Content -LiteralPath (Join-Path $repositoryRoot '.env.example') -Raw
$content = $content.Replace('replace-with-local-postgres-password', $postgresPassword)
$content = $content.Replace('replace-with-local-minio-user', 'bhome_local_admin')
$content = $content.Replace('replace-with-local-minio-password', $storagePassword)
# Root storage credentials are acceptable for this loopback-only local setup, never production.
$content = $content.Replace('replace-with-scoped-storage-access-key', 'bhome_local_admin')
$content = $content.Replace('replace-with-scoped-storage-secret-key', $storagePassword)
$content = $content.Replace('replace-with-random-key-at-least-32-bytes', $jwtKey)
[System.IO.File]::WriteAllText($target, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Created ignored .env with random local credentials. No credentials were printed.'
