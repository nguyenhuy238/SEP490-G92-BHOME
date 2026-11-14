# Development only. Keep the OTP key stable across launches and out of process arguments/logs.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$project = [xml][IO.File]::ReadAllText((Join-Path $repo 'src/backend/BHome.Api/BHome.Api.csproj'))
$secretsId = [string]$project.Project.PropertyGroup.UserSecretsId
if (-not $secretsId) { throw 'API project has no Development UserSecretsId.' }
$secretsPath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) "Microsoft/UserSecrets/$secretsId/secrets.json"
$existing = if (Test-Path -LiteralPath $secretsPath) {
    (Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json).'AnonymousSigning:OtpHmacKey'
} else { $null }
if (-not [string]::IsNullOrWhiteSpace($existing)) {
    $valid = $false
    try { $valid = [Convert]::FromBase64String($existing).Length -ge 32 } catch [FormatException] { }
    if (-not $valid) { throw 'Existing OTP key is invalid. Correct it deliberately; this script never rotates an existing key.' }
    Write-Output 'Development OTP key is configured; existing key preserved.'
    return
}
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
@{ 'AnonymousSigning:OtpHmacKey' = [Convert]::ToBase64String($bytes) } |
    ConvertTo-Json -Compress | dotnet user-secrets set --id $secretsId | Out-Null
[Array]::Clear($bytes, 0, $bytes.Length)
if ($LASTEXITCODE -ne 0) { throw 'Could not configure Development OTP key.' }
Write-Output 'Created a private Development OTP key. Restart the API to apply it. No key was printed.'
