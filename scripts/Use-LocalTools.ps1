# Optional, process-local PATH: dot-source this file when ignored .tools downloads exist.
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$localDotnet = Join-Path $repositoryRoot '.tools/dotnet'
if (Test-Path -LiteralPath (Join-Path $localDotnet 'dotnet.exe')) {
    $env:DOTNET_ROOT = $localDotnet
    $env:PATH = "$localDotnet;$env:PATH"
}
$localNode = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot '.tools') -Directory -Filter 'node-v22*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($localNode) { $env:PATH = "$($localNode.FullName);$env:PATH" }
