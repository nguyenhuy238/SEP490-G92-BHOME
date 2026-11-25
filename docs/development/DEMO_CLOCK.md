# Demo Clock — BHOME (Development, Staging and Production)

Demo Clock is a server-owned business calendar for the BHOME academic demonstration. It is not a system-clock override. The real clock continues to control JWT, OTP, invitation sessions, evidence upload expiry, network timeouts and integration/security timestamps. The existing reviewed Staging and Production deployments discover the capability by default, with the real date until an Owner changes it. Remote/shared Development databases are not supported.

## Use the normal local Owner Portal (port 5173)

For an existing approved workstation-local snapshot named bhome_neon_local_YYYYMMDD, use the normal API and Owner Web. Add the following to the private root .env (use the exact existing snapshot name):

```dotenv
DemoClock__Enabled=true
DemoClock__AllowLocalDevelopment=true
DemoClock__DevelopmentDatabaseName=bhome_neon_local_20261115
DevelopmentDatabase__InitializeOnStartup=false
Jobs__Enabled=false
BillingAutomation__AutomaticJobsEnabled=false
StaffAssignments__AutoReconcileEnabled=false
OwnerSetup__AssetSyncEnabled=false
NotificationChannels__AutomationEnabled=false
```

The guard also requires loopback PostgreSQL and object storage, the local bhome-private bucket and no live bank integration. The ordinary Development launcher loads these options, and the usual Owner Web automatically discovers the authenticated endpoint. Start the normal API with scripts/Start-Api.ps1 and open http://localhost:5173. Use npm run mobile:dev for the matching Mobile API. Do not enable these flags if the database or storage is remote. No snapshot is created or replaced by the feature. Existing data persists; normal manual email/signing integrations may still send real requests. Reset the clock before ending the demo. To restore ordinary Development worker configuration, disable the clock and restore the previous local worker settings, then restart the API.

## Start the local demo

From the repository root, with Docker running, initialize the isolated fixture environment once (safe to rerun, no reset):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1 -DemoClock
```

Then run these in separate terminals:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component Api -DemoClock
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component OwnerWeb -DemoClock
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component MobileWeb -DemoClock
```

- Owner Web: `http://localhost:5517`; API: `http://localhost:5540`; Mobile Web: `http://localhost:5581` (uses local HTTPS API port 7540; trust the local development HTTPS certificate if prompted).
- Use synthetic accounts `owner.contract.demo`, `staff.contract.demo`, `tenant1.contract.demo` (email suffix `@example.invalid`). The password is kept in the ignored `.tools/contract-demo/runtime.json` file; never commit, log or share it.
- Database is `bhome_contract_demo` on local port 56432, object storage bucket `contract-demo` on local port 59000. Existing data is not reset; the initializer only prepares an empty database or verifies the existing reviewed schema. The Demo Clock seed does not create the legacy historical signed-contract test fixture or run background jobs.

## Demonstration sequence

1. In Owner Web, set **Ngày demo** to `2026-11-01` and click **Áp dụng**. The current simulated date appears above the main content. Create the contract through the normal workflow; perform Staff move-in and meter-baseline tasks using the existing screens. Use a fresh room, or a fixture whose electricity/water meters were installed on or before the chosen date (for example an available lifecycle demo room). Do not move the calendar backwards to make an existing later installation appear valid.
2. Advance to the scheduled meter day, using the date input or **+1 ngày**, **+7 ngày**, **+30 ngày**. Use the existing manual actions under `/billing-automation`, which still enforce task uniqueness, contract eligibility, meter installation dates, configured reading dates and staff permissions.
3. Advance to the draft/final dates, create the draft and explicitly publish the eligible invoice. Changing the clock does not itself run a job, publish an invoice, create a payment or change a ledger entry. External payments/signing integrations and background jobs are disabled in this mode.
4. Staff and Tenant Mobile Web poll the same server calendar. Normal date filters and current-month views use the simulated business date. Select **Ngày thực** to resume the real calendar.

The simulation is process-local and resets on API restart. All ordinary business mutations still persist to the isolated demo database. Changing the date or returning to real time does not roll back previously created contracts, readings, invoices or payments. Other local clients should not change the date during an in-flight business mutation. Run each scenario in chronological order after setting the initial demo date.

## API and safeguards

`GET /api/v1/demo-clock` — authenticated Owner, Staff and Tenant read the same server date and version. `PUT /api/v1/demo-clock` — Owner only; send `businessDate` (`YYYY-MM-DD`, or `null` for real time) and `expectedVersion`. A stale version returns 409. API returns 404 when disabled. The host refuses explicitly enabled incompatible configuration; automatic discovery leaves the feature disabled when deployment anchors or payment/job guards do not match.

Focused validation: `dotnet test tests/backend/BHome.Application.UnitTests --filter FullyQualifiedName~DemoBusinessClockTests`, `dotnet test tests/backend/BHome.Infrastructure.UnitTests --filter FullyQualifiedName~DemoClockGuardTests`, and `npm run test --workspace ./src/mobile -- demoClock.test.ts`.

## Use the existing Staging and Production deployments

Release the API and Owner Web together through the normal reviewed develop/main CI/CD. No separate backend, database, Docker stack, tunnel, or extra build flag is required. The API automatically enables the capability on the matching BHOME deployment anchors: existing PostgreSQL database and private MinIO bucket, disabled business workers, Staging SePay Test, and Production live banking disabled. This does not change provider configuration or activate a simulated date. Each environment has an independent in-memory clock which starts at the real date.

Optional private environment settings:

```dotenv
DemoClock__Enabled=true
DemoClock__OwnerUserId=
```

Blank OwnerUserId allows authenticated Owners to change dates; set an actual Owner UUID from GET /api/v1/session to restrict control to that account. Staff and Tenant can read but never change the clock. Explicit Enabled=false disables the feature. Older private environment files without DemoClock keys need no edit if they match the reviewed deployment configuration. Existing explicit false overrides automatic discovery. Production remains unavailable while real bank integrations are enabled; never switch SePay to Test in Production just to bypass this guard. The demo does not simulate bank callbacks, signing or email delivery.

- Staging Owner: https://owner-staging.103.146.23.157.sslip.io
- Production Owner: https://owner.103.146.23.157.sslip.io
- Mobile: normal Web/Expo/native builds automatically discover the clock from their authenticated API, including npm run mobile:staging. Explicit EXPO_PUBLIC_DEMO_CLOCK_ENABLED=false disables discovery; do not set it for demo builds.
- Choose the initial date, execute the normal workflow chronologically, and click **Ngày thực** after the demonstration. Restarting an API resets only its own clock to real time.

**Important:** the calendar is shared by all users of one API instance, not isolated per account or location. Use synthetic accounts and rooms and coordinate a demo window with other users. Data persists in the environment's existing database; resetting the date does not undo contracts, readings, invoices or payments. The clock does not support multiple replicas. Auth, OTP, provider timestamps and timers remain real. The four individual manual billing actions are available to Owners authorized for the demo; developer batch run-now and notification-publishing endpoints remain disabled on deployed environments. No automatic publication or background billing jobs are enabled.
