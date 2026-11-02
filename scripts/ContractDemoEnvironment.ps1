$ErrorActionPreference = 'Stop'
$contractDemoRoot = Split-Path -Parent $PSScriptRoot
$contractDemoDirectory = Join-Path $contractDemoRoot '.tools/contract-demo'
$contractDemoSettings = Join-Path $contractDemoDirectory 'runtime.json'
function Import-ContractDemoEnvironment {
    if (-not (Test-Path -LiteralPath $contractDemoSettings)) { throw 'Run scripts/Initialize-ContractDemo.ps1 first.' }
    $settings = Get-Content -Raw -LiteralPath $contractDemoSettings | ConvertFrom-Json
    foreach ($entry in $settings.PSObject.Properties) { [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'Process') }
    return $settings
}
