param([ValidateSet('Inspect', 'Apply')][string]$Mode = 'Inspect')

# Local-only disposable-data reset. Inspect is the default; Apply makes a
# private full backup before running the transaction-protected SQL companion.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $root '.env'
$containerName = 'bhome-neon-local-postgres'
$databaseName = 'bhome'
$databaseUser = 'bhome_local'
$sqlPath = Join-Path $PSScriptRoot 'Reset-StaffTenantTestData.sql'

if (-not (Test-Path -LiteralPath $environmentPath) -or -not (Test-Path -LiteralPath $sqlPath)) {
    throw 'Missing the local .env or companion reset SQL file.'
}
$values = @{}
foreach ($line in Get-Content -LiteralPath $environmentPath) {
    if ($line -match '^([A-Za-z][A-Za-z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
}
$connection = $values['ConnectionStrings__Database']
if (-not $connection -or $connection -notmatch '(?i)(^|;)\s*host\s*=\s*(127\.0\.0\.1|localhost)\s*(;|$)' -or
    $connection -notmatch '(?i)(^|;)\s*port\s*=\s*5434\s*(;|$)' -or
    $connection -notmatch '(?i)(^|;)\s*database\s*=\s*bhome\s*(;|$)' -or
    $connection -notmatch '(?i)(^|;)\s*username\s*=\s*bhome_local\s*(;|$)' -or
    $values['POSTGRES_DB'] -ne 'bhome' -or $values['POSTGRES_PORT'] -ne '5434' -or
    $values['DevelopmentDatabase__AllowRemoteDatabase'] -ne 'false') {
    throw 'The local .env target is not the expected loopback-only bhome fixture; reset refused.'
}

$inspectionJson = & docker inspect $containerName
if ($LASTEXITCODE -ne 0 -or -not $inspectionJson) { throw 'Local PostgreSQL container was not found.' }
$container = ($inspectionJson | ConvertFrom-Json)[0]
$ports = $container.NetworkSettings.Ports.'5432/tcp'
if ($container.State.Status -ne 'running' -or -not $ports -or $ports.Count -ne 1 -or
    $ports[0].HostIp -ne '127.0.0.1' -or $ports[0].HostPort -ne '5434' -or
    $container.Config.Image -notmatch '^postgres:18') {
    throw 'Container identity/port does not match isolated local PostgreSQL; reset refused.'
}
$containerEnvironment = @{}
foreach ($entry in $container.Config.Env) {
    $pair = $entry -split '=', 2
    if ($pair.Count -eq 2 -and $pair[0] -in @('POSTGRES_DB', 'POSTGRES_USER')) {
        $containerEnvironment[$pair[0]] = $pair[1]
    }
}
if ($containerEnvironment['POSTGRES_DB'] -ne $databaseName -or
    $containerEnvironment['POSTGRES_USER'] -ne $databaseUser) {
    throw 'Unexpected database container credentials; reset refused.'
}

$countsQuery = @'
SELECT 'Owners',count(*) FROM users WHERE 'Owner'=ANY(roles)
UNION ALL SELECT 'Staff',count(*) FROM users WHERE 'Staff'=ANY(roles)
UNION ALL SELECT 'Tenant',count(*) FROM users WHERE 'Tenant'=ANY(roles)
UNION ALL SELECT 'Assignments',coalesce(sum(jsonb_array_length(staff_assignments)),0) FROM locations
UNION ALL SELECT 'Contracts',count(*) FROM contracts
UNION ALL SELECT 'Operational work (not Owner setup)',count(*) FROM operational_tasks
 WHERE ((task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
        (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%')) IS NOT TRUE
UNION ALL SELECT 'Owner setup records',count(*) FROM operational_tasks
 WHERE (task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
       (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%')
UNION ALL SELECT 'Locations',count(*) FROM locations
UNION ALL SELECT 'Rooms',count(*) FROM rooms
UNION ALL SELECT 'Assets',count(*) FROM assets
UNION ALL SELECT 'Billing policies',count(*) FROM billing_policies;
'@
Write-Output "Target: local Docker $containerName, 127.0.0.1:5434/$databaseName ($Mode)"
Write-Output 'Current counts (label|rows):'
$countsQuery | & docker exec -i $containerName psql -X -U $databaseUser -d $databaseName -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Database preflight failed.' }
if ($Mode -eq 'Inspect') { return }

$backupDirectory = Join-Path $root '.artifacts\private-backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$containerBackup = "/tmp/bhome-before-staff-tenant-reset-$stamp.dump"
$backup = Join-Path $backupDirectory "bhome-before-staff-tenant-reset-$stamp.dump"
try {
    & docker exec $containerName pg_dump -Fc -U $databaseUser -d $databaseName -f $containerBackup
    if ($LASTEXITCODE -ne 0) { throw 'Backup creation failed; no data deleted.' }
    & docker exec $containerName pg_restore -l $containerBackup | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed; no data deleted.' }
    & docker cp "${containerName}:$containerBackup" $backup | Out-Null
    if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $backup).Length -lt 4096) {
        throw 'Private backup transfer failed; no data deleted.'
    }
} finally {
    & docker exec $containerName rm -f $containerBackup | Out-Null
}
Write-Output "Verified private backup: $backup"
Get-Content -LiteralPath $sqlPath -Raw | & docker exec -i $containerName psql -X -U $databaseUser -d $databaseName -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw "Reset failed and SQL transaction was rolled back. Restore backup if necessary: $backup"
}
Write-Output 'Reset transaction COMMITTED. Counts after reset:'
$countsQuery | & docker exec -i $containerName psql -X -U $databaseUser -d $databaseName -At -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Post-reset count query failed.' }
