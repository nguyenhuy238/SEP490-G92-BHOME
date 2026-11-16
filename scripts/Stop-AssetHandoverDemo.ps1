param([Parameter(Mandatory = $true)][string]$SessionFile)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$directory = [IO.Path]::GetFullPath((Join-Path $repo '.tmp/handover-demo'))
$resolved = (Resolve-Path -LiteralPath $SessionFile).Path
if ([IO.Path]::GetDirectoryName($resolved) -ne $directory -or [IO.Path]::GetFileName($resolved) -notmatch '^session-([a-f0-9]{32})\.json$') {
    throw 'Select the exact session JSON created under this workspace .tmp/handover-demo.'
}
$suffix = $Matches[1].Substring(0, 8)
$session = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
foreach ($entry in $session.processes) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$entry.id)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($resolved) -and $process.CommandLine.Contains('Start-AssetHandoverDemo.ps1')) {
        & taskkill.exe /PID ([int]$entry.id) /T /F | Out-Null
    }
}
foreach ($name in @($session.postgresContainer, $session.filesContainer)) {
    if ($name -notin @("bhome-handover-pg-$suffix", "bhome-handover-files-$suffix")) { throw 'Container does not belong to the selected demo session.' }
    & docker stop $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Demo app processes were stopped, but container $name could not be stopped. Start Docker Desktop and rerun this command; all data is preserved." }
}
Write-Host 'Stopped the selected demo processes and containers. All database, file and log data was preserved.'
