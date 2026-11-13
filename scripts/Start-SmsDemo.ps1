param(
    [ValidateSet('Initialize', 'Backend', 'Web', 'Mobile')][string]$Action = 'Initialize',
    [string]$AdminConnection = $env:BHOME_COMPACT24_TEST_ADMIN
)
$ErrorActionPreference = 'Stop'
$smsRoot = Split-Path -Parent $PSScriptRoot
$smsDirectory = Join-Path $smsRoot '.tmp/sms-demo'
$smsConfigPath = Join-Path $smsDirectory 'settings.json'
function New-SmsSecret {
    $bytes = New-Object byte[] 48
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes); return [Convert]::ToBase64String($bytes) } finally { $random.Dispose() }
}
if ($Action -eq 'Initialize' -and !(Test-Path -LiteralPath $smsConfigPath)) {
    if ([string]::IsNullOrWhiteSpace($AdminConnection)) { throw 'Supply a loopback PostgreSQL admin through BHOME_COMPACT24_TEST_ADMIN or -AdminConnection. Values will not be printed.' }
    $connection = New-Object System.Data.Common.DbConnectionStringBuilder
    $connection.set_ConnectionString($AdminConnection)
    if ($connection.get_Item('Host') -notin @('127.0.0.1', 'localhost', '::1') -or $connection.get_Item('Database') -ne 'postgres') { throw 'A loopback postgres admin database is required.' }
    $connection.set_Item('Database', ('bhome_compact24_dev_' + [Guid]::NewGuid().ToString('N')))
    [IO.Directory]::CreateDirectory($smsDirectory) | Out-Null
    $settings = @{
        ConnectionStrings__Database=$connection.get_ConnectionString()
        Jwt__SigningKey=(New-SmsSecret); Jwt__Issuer='bhome-sms-demo'; Jwt__Audience='bhome-sms-demo'
        Sms__Enabled='true'; Sms__Mode='Mock'; Sms__DemoIsolated='true'; Sms__ProductionEnabled='false'
        SmsRecovery__Enabled='true'; SmsRecovery__HashKey=(New-SmsSecret)
        'Sms__DemoAccounts__11111111-1111-4111-8111-111111111111'='0900000001'
        'Sms__DemoAccounts__22222222-2222-4222-8222-222222222222'='0900000002'
        'Sms__DemoAccounts__33333333-3333-4333-8333-333333333333'='0900000003'
        NotificationChannels__Enabled='true'; NotificationChannels__AutomationEnabled='true'
        Jobs__Enabled='false'; Api__ReadDevelopmentEnvironmentFile='false'; DevelopmentDatabase__InitializeOnStartup='false'
        Api__UseHttpsRedirection='false'; ASPNETCORE_URLS='http://localhost:5288'; DOTNET_ENVIRONMENT='Development'; ASPNETCORE_ENVIRONMENT='Development'
        AuthWeb__AllowedOrigins__0='http://localhost:5178'; Cors__AllowedOrigins__0='http://localhost:5178'
        Email__Enabled='false'; Ocr__WarmupEnabled='false'; BHOME_SMS_DEMO_PASSWORD=('Demo!' + (New-SmsSecret) + '9a')
    }
    for ($index=0; $index -lt 6; $index++) { $settings['Sms__EnabledTemplates__'+$index] = 'SMS-0'+($index+1) }
    [IO.File]::WriteAllText($smsConfigPath, ($settings | ConvertTo-Json))
    [IO.File]::WriteAllText((Join-Path $smsDirectory 'ACCOUNTS.txt'), "Synthetic isolated accounts only:`r`nowner.sms-demo@sms-demo.example.invalid`r`nstaff.sms-demo@sms-demo.example.invalid`r`ntenant.sms-demo@sms-demo.example.invalid`r`nInitial password: " + $settings.BHOME_SMS_DEMO_PASSWORD + "`r`nPassword recovery changes the actual demo password. Reinitialization preserves changed passwords.")
}
if (!(Test-Path -LiteralPath $smsConfigPath)) { throw 'Run -Action Initialize first.' }
$settings = Get-Content -Raw -LiteralPath $smsConfigPath | ConvertFrom-Json
foreach ($property in $settings.PSObject.Properties) { [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process') }
# Override inherited endpoint definitions too; ASPNETCORE_URLS alone does not override Kestrel endpoints.
$smsUserSecretRoot = if ($env:APPDATA) { Join-Path $env:APPDATA 'Microsoft/UserSecrets' } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.microsoft/usersecrets' }
$smsApiSecretsPath = Join-Path $smsUserSecretRoot 'bhome-api-development/secrets.json'
$smsEndpointPort = 5290
if (Test-Path -LiteralPath $smsApiSecretsPath) {
    $smsApiSecrets = Get-Content -Raw -LiteralPath $smsApiSecretsPath | ConvertFrom-Json
    foreach ($smsProperty in $smsApiSecrets.PSObject.Properties) {
        if ($smsProperty.Name -match '^Kestrel:Endpoints:([^:]+):Url$') {
            $smsScheme = if ($Matches[1] -match 'https') { 'https' } else { 'http' }
            [Environment]::SetEnvironmentVariable($smsProperty.Name.Replace(':','__'), ($smsScheme + '://127.0.0.1:' + $smsEndpointPort), 'Process')
            $smsEndpointPort++
        }
    }
}
$env:Kestrel__Endpoints__Http__Url='http://127.0.0.1:5288'
$env:MobileDevelopment__Enabled='false'
$env:AllowedHosts='localhost;127.0.0.1'
Push-Location $smsRoot
try {
    switch ($Action) {
        'Initialize' { dotnet run --project tools/BHome.LocalDevelopment -- seed-sms-demo }
        'Backend' { dotnet run --project src/backend/BHome.Api --no-launch-profile }
        'Web' { $env:VITE_API_BASE_URL='http://localhost:5288'; $env:VITE_SMS_DEMO_ENABLED='true'; npm.cmd run dev --workspace ./src/owner-web -- --port 5178 --host localhost }
        'Mobile' { $env:EXPO_PUBLIC_API_BASE_URL='http://localhost:5288'; $env:EXPO_PUBLIC_SMS_DEMO_ENABLED='true'; npm.cmd run web --workspace ./src/mobile }
    }
    if ($LASTEXITCODE -ne 0) { throw "SMS demo action failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }
