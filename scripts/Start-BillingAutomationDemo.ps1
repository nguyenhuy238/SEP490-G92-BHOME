param(
    [ValidateSet('Api','OwnerWeb','MobileWeb')][string]$Component='Api',
    [switch]$PauseWorkerForSetup,
    [int]$ApiPort=5540,[int]$HttpsPort=7540,[int]$WebPort=5517,[int]$MobilePort=5581
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
. (Join-Path $PSScriptRoot 'ContractDemoEnvironment.ps1')
$settings=Import-ContractDemoEnvironment
if($settings.DOTNET_ENVIRONMENT -notin @('Development','Testing') -or $settings.ConnectionStrings__Database -notmatch '^Host=(127\.0\.0\.1|localhost);.*Database=bhome_contract_demo;'){throw 'Isolated automation demo configuration required.'}
foreach($port in @($ApiPort,$HttpsPort,$WebPort,$MobilePort)){if($port -lt 1024 -or $port -gt 65535){throw 'Invalid development port.'}}
$env:Kestrel__Endpoints__MobileHttp__Url="http://localhost:$ApiPort"
$env:Kestrel__Endpoints__MobileHttps__Url="https://localhost:$HttpsPort"
$env:VITE_API_MODE='api';$env:VITE_API_BASE_URL="http://localhost:$ApiPort"
$env:EXPO_PUBLIC_API_BASE_URL="https://localhost:$HttpsPort";$env:EXPO_PUBLIC_DEV_API_BASE_URL=$env:EXPO_PUBLIC_API_BASE_URL
$env:EXPO_NO_DOTENV='1';$env:Jobs__Enabled=(!$PauseWorkerForSetup).ToString();$env:Ocr__Enabled='false'
$env:Cors__AllowedOrigins__2="http://localhost:$WebPort";$env:Cors__AllowedOrigins__3="http://localhost:$MobilePort"
$env:AuthWeb__AllowedOrigins__2="http://localhost:$WebPort";$env:AuthWeb__AllowedOrigins__3="http://localhost:$MobilePort"
[Environment]::SetEnvironmentVariable('BHOME_DEV_TEST_PASSWORD',$null,'Process')
Push-Location $contractDemoRoot
try {
    switch($Component){
        'Api'{dotnet .tools/jobs-run/bin/BHome.Api/debug/BHome.Api.dll}
        'OwnerWeb'{npm.cmd --prefix src/owner-web run dev -- --host localhost --port $WebPort --strictPort}
        'MobileWeb'{npm.cmd --prefix src/mobile run web -- --localhost --port $MobilePort}
    }
    exit $LASTEXITCODE
}finally{Pop-Location}
