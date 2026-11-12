[CmdletBinding()]
param(
    [string]$ApiBaseUrl = "http://127.0.0.1:5240",
    [string]$EnvFile = ".env.neon.dev04"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnv = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }
$pwLine = Get-Content -LiteralPath $resolvedEnv | Where-Object { $_ -match '^BHOME_DEV_TEST_PASSWORD=' } | Select-Object -First 1
if (-not $pwLine) {
    throw "Không tìm thấy BHOME_DEV_TEST_PASSWORD trong $resolvedEnv"
}
$password = ($pwLine -replace '^BHOME_DEV_TEST_PASSWORD=', '').Trim()

Write-Host "=== TEST A: TENANT LOGIN & CONTRACT VISIBILITY ==="
$tenantLoginBody = @{
    email    = "bhome.e2e.meter.tenant@example.com"
    password = $password
    device   = "BHOME-E2E-SmokeTest"
} | ConvertTo-Json

$tenantAuth = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/api/v1/auth/login" -ContentType "application/json" -Body $tenantLoginBody
$tenantHeaders = @{ Authorization = "Bearer $($tenantAuth.accessToken)" }
$tenantContractPage = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/v1/contracts" -Headers $tenantHeaders
$tenantContracts = @($tenantContractPage.items)
$tenantInvoices = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/v1/invoices?page=1&pageSize=20" -Headers $tenantHeaders

Write-Host ("Tenant Authenticated : True (Roles={0})" -f ($tenantAuth.roles -join ","))
Write-Host ("Tenant Contracts     : {0}" -f $tenantContracts.Count)
foreach ($c in $tenantContracts) {
    Write-Host ("  -> Contract Id={0}, Room={1}, Location={2}, Status={3}, Start={4}, End={5}, Rent={6}" -f $c.id, $c.roomNumber, $c.locationName, $c.status, $c.startDate, $c.endDate, $c.monthlyRent)
}
Write-Host ("Tenant Invoices      : TotalCount={0}" -f $tenantInvoices.totalCount)

Write-Host ""
Write-Host "=== 3. TEST B: STAFF LOGIN, ASSIGNED LOCATION, ROOM & METER TASKS ==="
$staffLoginBody = @{
    email    = "staff.sample@example.invalid"
    password = $password
    device   = "BHOME-E2E-SmokeTest"
} | ConvertTo-Json

$staffAuth = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/api/v1/auth/login" -ContentType "application/json" -Body $staffLoginBody
$staffHeaders = @{ Authorization = "Bearer $($staffAuth.accessToken)" }
$staffLocations = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/v1/capture/locations" -Headers $staffHeaders
$staffRooms = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/v1/capture/locations/c2400000-0000-4000-8000-000000000010/rooms" -Headers $staffHeaders
$staffRoomTasks = Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl/api/v1/capture/meter-tasks?roomId=e2e20261-1100-4000-8000-000000000010" -Headers $staffHeaders

Write-Host ("Staff Authenticated  : True (Roles={0})" -f ($staffAuth.roles -join ","))
Write-Host ("Visible Locations    : {0} ({1})" -f @($staffLocations).Count, (($staffLocations | ForEach-Object { $_.label }) -join ", "))
$e2eRoom = $staffRooms | Where-Object { $_.label -eq "E2E-METER-01" } | Select-Object -First 1
Write-Host ("Room E2E-METER-01    : Id={0}, Label={1}, Status={2}, Capacity={3}" -f $e2eRoom.id, $e2eRoom.label, $e2eRoom.status, $e2eRoom.capacity)
Write-Host ("Room Tasks Count     : {0}" -f @($staffRoomTasks).Count)
foreach ($t in $staffRoomTasks) {
    Write-Host ("  -> Task Id={0}, MeterCode={1}, Utility={2}, Purpose={3}, Period={4}, ReadingDate={5}, Status={6}, PreviousValue={7}, ConfirmedReadingId={8}" -f $t.id, $t.meterCode, $t.utilityType, $t.purpose, $t.billingPeriod, $t.readingDate, $t.status, $t.previousValue, $t.confirmedReadingId)
}
