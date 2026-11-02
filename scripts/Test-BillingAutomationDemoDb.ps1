$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ContractDemoEnvironment.ps1')
$settings=Import-ContractDemoEnvironment
if($settings.DOTNET_ENVIRONMENT -notin @('Development','Testing') -or $settings.ConnectionStrings__Database -notmatch '^Host=(127\.0\.0\.1|localhost);.*Database=bhome_contract_demo;'){throw 'Isolated automation demo database required.'}
$fixture=Get-Content -Raw -LiteralPath (Join-Path $contractDemoDirectory 'automation-fixture.json') | ConvertFrom-Json
$location=[Guid]::Parse($fixture.locationId).ToString()
$invoice=[Guid]::Parse($fixture.invoiceId).ToString()
$period=[DateTime]::ParseExact($fixture.period,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture).ToString('yyyy-MM-dd')
if($location -ne 'fa090000-0000-4000-8000-000000000010'){throw 'Unexpected fixture namespace.'}
# Validated GUID/date literals only; all statements below are SELECTs against the isolated container.
$query=@"
SELECT jsonb_build_object(
 'period','$period',
 'periodicTasks',(SELECT COUNT(*) FROM "OperationalTasks" WHERE "LocationId"='$location' AND "Purpose"=1 AND "BillingPeriod"='$period'),
 'taskDuplicates',(SELECT COUNT(*) FROM (SELECT 1 FROM "OperationalTasks" WHERE "LocationId"='$location' AND "Purpose"=1 AND "BillingPeriod"='$period' GROUP BY "BillingRoomId","BillingUtilityType","BillingPeriod" HAVING COUNT(*)>1) x),
 'invoices',(SELECT COUNT(*) FROM "Invoices" WHERE "LocationId"='$location' AND "BillingPeriod"='$period'),
 'invoiceDuplicates',(SELECT COUNT(*) FROM (SELECT 1 FROM "Invoices" WHERE "LocationId"='$location' AND "BillingPeriod"='$period' GROUP BY "RoomId","BillingPeriod" HAVING COUNT(*)>1) x),
 'originalFinalTotal',(SELECT "Total" FROM "Invoices" WHERE "Id"='$invoice'),
 'invoiceViewers',(SELECT COUNT(*) FROM "InvoiceRecipients" WHERE "InvoiceId"='$invoice'),
 'verifiedAllocations',(SELECT COUNT(*) FROM "PaymentAllocations" WHERE "InvoiceId"='$invoice'),
 'issuedEvents',(SELECT COUNT(*) FROM "InvoiceIssuedEvents" WHERE "InvoiceId"='$invoice'),
 'paymentEvents',(SELECT COUNT(*) FROM "PaymentConfirmedEvents" WHERE "InvoiceId"='$invoice'),
 'failedAttempts',(SELECT COUNT(*) FROM "BillingAutomationAttempts" a JOIN "BillingAutomationExecutions" e ON a."ExecutionId"=e."Id" WHERE e."LocationId"='$location' AND a."Status"='Failed'),
 'notificationDuplicates',(SELECT COUNT(*) FROM (SELECT 1 FROM "UserNotifications" WHERE "LocationId"='$location' GROUP BY "RecipientUserId","EventKey" HAVING COUNT(*)>1) x),
 'readNotifications',(SELECT COUNT(*) FROM "UserNotifications" WHERE "LocationId"='$location' AND "ReadAt" IS NOT NULL),
 'unreadNotifications',(SELECT COUNT(*) FROM "UserNotifications" WHERE "LocationId"='$location' AND "ReadAt" IS NULL),
 'externalStates',(SELECT jsonb_agg(DISTINCT "DeliveryState") FROM "UserNotifications" WHERE "LocationId"='$location'),
 'completedWorkerJobs',(SELECT COUNT(*) FROM "BackgroundJobs" j JOIN "BillingAutomationPlans" p ON j."PayloadJson"->>'PlanId'=p."Id"::text WHERE p."LocationId"='$location' AND j."State"='Completed'),
 'adjustmentOutcomes',(SELECT jsonb_agg(d."Outcome") FROM "InvoiceAdjustmentDecisions" d JOIN "InvoiceAdjustmentRequests" r ON r."Id"=d."RequestId" WHERE r."InvoiceId"='$invoice')
);
"@
$result=$query | docker exec -i bhome-contract-demo-postgres-1 psql -v ON_ERROR_STOP=1 -U contract_demo -d bhome_contract_demo -t -A
if($LASTEXITCODE -ne 0){throw 'Read-only database proof failed.'}
$proof=$result | ConvertFrom-Json
foreach($key in @('taskDuplicates','invoiceDuplicates','notificationDuplicates')){if($proof.$key -ne 0){throw "Duplicate invariant failed: $key"}}
if($proof.invoiceViewers -ne 3 -or $proof.verifiedAllocations -ne 1 -or $proof.issuedEvents -ne 1 -or $proof.paymentEvents -ne 1 -or $proof.failedAttempts -lt 1 -or $proof.completedWorkerJobs -lt 3 -or [string]$proof.originalFinalTotal -ne [string]$fixture.originalTotal){throw 'Demo business/worker evidence incomplete.'}
$proof | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $contractDemoDirectory 'automation-db-proof.json') -Encoding UTF8
Write-Host 'PASS isolated PostgreSQL proof: unique tasks/invoices/notifications, three viewers, one verified allocation/event, preserved Final and durable failure/retry.'
$proof | Format-List
