param([switch]$BootstrapOnly)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$contractTestRoot=Split-Path -Parent $PSScriptRoot
Push-Location $contractTestRoot
try {
    node scripts/Seed-ContractDemoWorkflow.cjs
    if($LASTEXITCODE -ne 0){throw 'Contract demo bootstrap failed.'}
    if(-not $BootstrapOnly){
        node scripts/Test-ContractDemo.cjs
        if($LASTEXITCODE -ne 0){throw 'Contract browser smoke failed. See .tools/contract-demo artifacts.'}
    }
}finally{Pop-Location}
