[CmdletBinding()]
param(
    [string]$EnvFile = ".env.neon.dev04",
    [ValidateSet("--dry-run", "--inspect", "--seed", "--verify", "--cleanup")]
    [string]$Mode = "--seed"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }
if (-not (Test-Path -LiteralPath $resolvedEnv)) {
    throw "Không tìm thấy file môi trường: $resolvedEnv"
}

foreach ($line in Get-Content -LiteralPath $resolvedEnv) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $parts = $trimmed -split "=", 2
    if ($parts.Length -eq 2) {
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
}

$env:DOTNET_ENVIRONMENT = "Development"
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:DevelopmentDatabase__AllowPreviousPropertySchema = "true"

Push-Location $repoRoot
try {
    $dllPath = Join-Path $repoRoot "tools/BHome.LocalDevelopment/bin/Debug/net8.0/BHome.LocalDevelopment.dll"
    if (-not (Test-Path -LiteralPath $dllPath)) {
        & dotnet build "tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj" --no-restore -m:1 /nr:false /p:UseSharedCompilation=false
        if ($LASTEXITCODE -ne 0) {
            throw "Không thể biên dịch BHome.LocalDevelopment."
        }
    }
    & dotnet $dllPath seed-e2e-meter-workflow $Mode
    if ($LASTEXITCODE -ne 0) {
        throw "Lệnh seed-e2e-meter-workflow ($Mode) thất bại với mã thoát $LASTEXITCODE."
    }
}
finally {
    [Environment]::SetEnvironmentVariable("BHOME_DEV_TEST_PASSWORD", $null, "Process")
    Pop-Location
}
