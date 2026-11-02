param([ValidateSet('Api','OwnerWeb','MobileWeb')][string]$Component='Api')
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
. (Join-Path $PSScriptRoot 'ContractDemoEnvironment.ps1')
$null = Import-ContractDemoEnvironment
$env:Kestrel__Endpoints__MobileHttp__Url='http://localhost:5540'
$env:Kestrel__Endpoints__MobileHttps__Url='https://localhost:7540'
$env:EXPO_PUBLIC_API_BASE_URL='https://localhost:7540'
$env:EXPO_PUBLIC_DEV_API_BASE_URL='https://localhost:7540'
$env:EXPO_NO_DOTENV='1'
$env:Jobs__Enabled='false'
$env:Ocr__Enabled='false'
# Seed-only password is not needed by either application process.
[Environment]::SetEnvironmentVariable('BHOME_DEV_TEST_PASSWORD',$null,'Process')
Push-Location $contractDemoRoot
try {
    switch ($Component) {
        'Api' { dotnet run --project src/backend/BHome.Api --no-launch-profile --no-build }
        'OwnerWeb' { npm.cmd --prefix src/owner-web run dev -- --host localhost --port 5517 --strictPort }
        'MobileWeb' { Push-Location src/mobile; try { node ../../node_modules/expo/bin/cli start --web --localhost --port 5581 } finally { Pop-Location } }
    }
    exit $LASTEXITCODE
} finally { Pop-Location }
