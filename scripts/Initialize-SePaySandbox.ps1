param([string]$EnvironmentFile = '.env.sepay.local', [ValidateRange(1024,65535)][int]$PostgresPort = 55432)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repo $EnvironmentFile }
$target = [IO.Path]::GetFullPath($target)
if ((Split-Path $target -Parent) -ne $repo -or (Split-Path $target -Leaf) -notmatch '^\.env\.sepay(?:\.[a-zA-Z0-9-]+)?\.local$') {
    throw 'Use an ignored .env.sepay[.name].local file in the repository root.'
}
if (Test-Path -LiteralPath $target) { throw 'Private profile already exists; it will not be overwritten. Choose another EnvironmentFile for a new sandbox.' }
function New-SePayLocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$content = [IO.File]::ReadAllText((Join-Path $repo '.env.sepay.example'))
$content = $content.Replace('replace-with-local-container-name', 'bhome-sepay-' + [guid]::NewGuid().ToString('N').Substring(0,12))
$content = $content.Replace('replace-with-database-id', [guid]::NewGuid().ToString('N'))
$content = $content.Replace('replace-with-location-id', [guid]::NewGuid().ToString())
$content = $content.Replace('replace-with-random-postgres-password', (New-SePayLocalSecret))
$content = $content.Replace('replace-with-random-jwt-key', (New-SePayLocalSecret))
$content = $content.Replace('replace-with-random-webhook-secret', (New-SePayLocalSecret))
$content = $content.Replace('replace-with-random-fixture-password', ('Aa1!' + (New-SePayLocalSecret)))
$content = $content.Replace('POSTGRES_PORT=55432', 'POSTGRES_PORT=' + $PostgresPort).Replace(';Port=55432;', ';Port=' + $PostgresPort + ';')
[IO.File]::WriteAllText($target, $content, [Text.UTF8Encoding]::new($false))
Write-Output 'Created a private isolated Sandbox profile. Fill the receiving bank fields and SePaySandbox__AccountHolder; add your own API token if polling is needed. No secret was printed.'
