$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$testId = 'bhome-local-signing-test-' + [guid]::NewGuid().ToString('N')
$scratch = Join-Path $repo ".tools/$testId"
$secretFolder = Join-Path ([Environment]::GetFolderPath('ApplicationData')) "Microsoft/UserSecrets/$testId"
$secretFile = Join-Path $secretFolder 'secrets.json'
function Assert-Signing($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    New-Item -ItemType Directory -Path "$scratch/scripts", "$scratch/src/backend/BHome.Api" -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/Initialize-LocalSigning.ps1') -Destination "$scratch/scripts/Initialize-LocalSigning.ps1"
    [IO.File]::WriteAllText("$scratch/scripts/Use-LocalTools.ps1", '')
    [IO.File]::WriteAllText("$scratch/src/backend/BHome.Api/BHome.Api.csproj", "<Project><PropertyGroup><UserSecretsId>$testId</UserSecretsId></PropertyGroup></Project>")
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$scratch/scripts/Initialize-LocalSigning.ps1" 2>&1
    Assert-Signing ($LASTEXITCODE -eq 0) 'Initialization failed.'
    $settings = Get-Content -LiteralPath $secretFile -Raw | ConvertFrom-Json
    $first = $settings.'AnonymousSigning:OtpHmacKey'
    Assert-Signing ([Convert]::FromBase64String($first).Length -eq 32) 'Expected random 256-bit key.'
    Assert-Signing (-not (($output -join '') -like "*$first*")) 'Key must not appear in output.'
    $settings | Add-Member -NotePropertyName 'Synthetic:Unrelated' -NotePropertyValue 'preserved'
    $settings | ConvertTo-Json | Set-Content -LiteralPath $secretFile -Encoding UTF8
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$scratch/scripts/Initialize-LocalSigning.ps1" 2>&1
    Assert-Signing ($LASTEXITCODE -eq 0) 'Repeat initialization failed.'
    $settings = Get-Content -LiteralPath $secretFile -Raw | ConvertFrom-Json
    Assert-Signing ($settings.'AnonymousSigning:OtpHmacKey' -eq $first) 'Repeat must preserve the key.'
    Assert-Signing ($settings.'Synthetic:Unrelated' -eq 'preserved') 'Unrelated settings must survive.'
    foreach ($invalid in @('invalid-base64', [Convert]::ToBase64String((New-Object byte[] 8)))) {
        $settings.'AnonymousSigning:OtpHmacKey' = $invalid
        $settings | ConvertTo-Json | Set-Content -LiteralPath $secretFile -Encoding UTF8
        # A rejected child process writes stderr; inspect exit code without propagating its error stream.
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$scratch/scripts/Initialize-LocalSigning.ps1" *> $null
        $rejected = $LASTEXITCODE -ne 0
        $ErrorActionPreference = $previousPreference
        Assert-Signing $rejected 'Invalid existing key must be rejected.'
        Assert-Signing ((Get-Content -LiteralPath $secretFile -Raw | ConvertFrom-Json).'AnonymousSigning:OtpHmacKey' -eq $invalid) 'Invalid existing key must not be rotated.'
    }
    Write-Output 'PASS: key generation, private output, idempotency, unrelated settings and invalid-key rejection.'
} finally {
    # Both resolved paths are bounded to this unique test; never touch the API user-secrets ID.
    foreach ($path in @($scratch, $secretFolder)) {
        $resolved = [IO.Path]::GetFullPath($path)
        if ((Split-Path -Leaf $resolved) -ne $testId -or $testId -notmatch '^bhome-local-signing-test-[a-f0-9]{32}$') { throw 'Unsafe test cleanup path.' }
        if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    }
}
