$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$contractExportRoot=Split-Path -Parent $PSScriptRoot
$env:EXPO_NO_DOTENV='1'
$env:EXPO_PUBLIC_API_BASE_URL='https://localhost:7540'
$env:EXPO_PUBLIC_DEV_API_BASE_URL='https://localhost:7540'
Push-Location (Join-Path $contractExportRoot 'src/mobile')
try {
    foreach($contractPlatform in @('ios','android')) {
        $destination=Join-Path $contractExportRoot ".tools/contract-workflow/mobile-$contractPlatform"
        node ../../node_modules/expo/bin/cli export --platform $contractPlatform --output-dir $destination
        if($LASTEXITCODE -ne 0){throw "Expo export failed: $contractPlatform"}
    }
}finally{Pop-Location}
