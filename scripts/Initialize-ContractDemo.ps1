. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
. (Join-Path $PSScriptRoot 'ContractDemoEnvironment.ps1')
if (-not (Test-Path -LiteralPath $contractDemoSettings)) {
    New-Item -ItemType Directory -Force -Path $contractDemoDirectory | Out-Null
    function New-DemoSecret {
        $bytes = New-Object byte[] 36
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes); return [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }
    }
    $dbPassword = New-DemoSecret
    $storagePassword = New-DemoSecret
    $settings = [ordered]@{
        DOTNET_ENVIRONMENT='Development'; ASPNETCORE_ENVIRONMENT='Development'
        CONTRACT_DEMO_DB_PASSWORD=$dbPassword; CONTRACT_DEMO_STORAGE_PASSWORD=$storagePassword
        ConnectionStrings__Database="Host=127.0.0.1;Port=56432;Database=bhome_contract_demo;Username=contract_demo;Password=$dbPassword;Include Error Detail=false"
        Jwt__SigningKey=(New-DemoSecret)
        ObjectStorage__Endpoint='127.0.0.1:59000'; ObjectStorage__UseSsl='false'; ObjectStorage__Bucket='contract-demo'
        ObjectStorage__AccessKey='contract-demo'; ObjectStorage__SecretKey=$storagePassword
        ContractPdf__TemplateId='main-contract-development-v1'; ContractWorkflow__SimulatedSigningEnabled='true'
        Api__UseHttpsRedirection='false'; ASPNETCORE_URLS='http://localhost:5540'
        Cors__AllowedOrigins__0='http://localhost:5517'; Cors__AllowedOrigins__1='http://localhost:5581'
        AuthWeb__AllowedOrigins__0='http://localhost:5517'; AuthWeb__AllowedOrigins__1='http://localhost:5581'
        AuthRateLimit__PermitLimit='200'
        IdentityProtection__ActiveEncryptionVersion='demo'; IdentityProtection__ActiveHmacVersion='demo'
        IdentityProtection__EncryptionKeys__demo=(New-DemoSecret); IdentityProtection__HmacKeys__demo=(New-DemoSecret)
        BHOME_DEV_TEST_PASSWORD=('Demo!aA7'+(New-DemoSecret))
        VITE_API_MODE='api'; VITE_API_BASE_URL='http://localhost:5540'
        EXPO_PUBLIC_API_BASE_URL='https://localhost:7540'
    }
    # AES identity keys are exactly 256 bits, independent from JWT/password material.
    $keyBytes=New-Object byte[] 32; $keyRng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try { $keyRng.GetBytes($keyBytes); $settings.IdentityProtection__EncryptionKeys__demo=[Convert]::ToBase64String($keyBytes) } finally {$keyRng.Dispose()}
    $settings | ConvertTo-Json | Set-Content -LiteralPath $contractDemoSettings -Encoding UTF8
    if ($env:OS -eq 'Windows_NT') {
        $acl=New-Object Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true,$false)
        $rule=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().Name,'FullControl','Allow')
        $acl.AddAccessRule($rule); Set-Acl -LiteralPath $contractDemoSettings -AclObject $acl
    }
}
$null = Import-ContractDemoEnvironment
Push-Location $contractDemoRoot
try {
    docker compose -p bhome-contract-demo -f deploy/docker/compose.contract-demo.yml up -d --wait
    if ($LASTEXITCODE -ne 0) { throw 'Could not start isolated contract demo services.' }
    dotnet build tools/BHome.LocalDevelopment --no-incremental --no-restore --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Seed build failed. Stop the demo API before rebuilding shared assemblies.' }
    dotnet run --project tools/BHome.LocalDevelopment --no-build -- seed-contract-demo
    if ($LASTEXITCODE -ne 0) { throw 'Contract demo seed failed; no data reset was attempted.' }
    Write-Host 'Demo infrastructure seeded. Local credentials are in .tools/contract-demo/runtime.json (BHOME_DEV_TEST_PASSWORD). Do not commit or share that file.'
} finally { Pop-Location }
