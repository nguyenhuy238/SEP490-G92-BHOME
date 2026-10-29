param([switch]$IncludeDockerTests)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
function Assert-Success { if ($LASTEXITCODE -ne 0) { throw "Validation command failed with exit code $LASTEXITCODE." } }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    dotnet restore src/backend/BHome.sln; Assert-Success
    dotnet build src/backend/BHome.sln --no-restore; Assert-Success
    if ($IncludeDockerTests) { dotnet test src/backend/BHome.sln --no-build }
    else { dotnet test src/backend/BHome.sln --no-build --filter 'Category!=Docker' }
    Assert-Success
    dotnet format src/backend/BHome.sln --verify-no-changes --no-restore; Assert-Success
    npm.cmd ci --no-fund --no-audit; Assert-Success
    npm.cmd run lint; Assert-Success
    npm.cmd test; Assert-Success
    powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1; Assert-Success
    # Build-time, browser-visible validation URL only.
    if (-not $env:VITE_API_BASE_URL) { $env:VITE_API_BASE_URL = 'https://localhost:7240' }
    npm.cmd run build; Assert-Success
    npm.cmd run format:check; Assert-Success
    docker compose --env-file .env.example config --quiet; Assert-Success
}
finally { Pop-Location }
