# Local Staff onboarding fixture

The **Sinh hợp đồng mẫu** button on `http://localhost:8081/workspace/onboarding` appears in a development build after a Staff user has selected an assigned Location. It does not replace the real onboarding/signing/payment flow.

## Server guard and configuration

The authenticated endpoint `POST /api/v1/development/onboarding-seed` requires the `Staff` role and a **currently assigned** Location. It rejects requests unless:

- The backend environment is `Development`.
- The PostgreSQL connection Host is `localhost`, `127.0.0.1` or `::1`, and the database name starts with `bhome_`.
- `DevelopmentContractSeed:Enabled=true` is explicitly configured through local user-secrets or the process environment (`DevelopmentContractSeed__Enabled`).
- `DevelopmentContractSeed:TenantPassword` contains a valid synthetic Tenant password, configured **only in local user-secrets or the process environment** (`DevelopmentContractSeed__TenantPassword`). Do not commit or log this value. The Develop environment-file loader does not import the `DevelopmentContractSeed` prefix from `.env`.

After changing the local environment, restart `scripts/Start-Api.ps1` (restarting only Expo does not restart the backend).

## What one click creates

- A new uniquely named `TEST-*` Room inside the selected Location, without altering an existing Room.
- A separate active test Tenant account with a hashed password, plus a synthetic encrypted and verified Resident identity (not a real CCCD).
- A labeled development-only Main Contract fixture in `Active` state, with an immutable agreed price snapshot and room-level RENT/ELECTRICITY/WATER test policies.
- Two active meters and their **Initial** tasks, plus the **Move-in/Handover** task through `IContractHandoverRepository.EnsureMoveInTaskAsync`, the same task builder used by normal activation.
- **Four real, room-linked physical assets** (bed, desk, two chairs as one quantity-tracked group, air conditioner), with persisted `AssetMetadata`, a scoped published `AssetTemplate`, `AssetTemplateAssignment`, `DesiredAssets`, and `AssetVerification` mappings. Staff's draft inventory must contain these groups with actual physical quantities; this is not a text-only checklist or an empty-inventory fixture.
- The test fixture **does not create fake evidence photos or mark Staff handover complete**. Real photos and human-confirmed inventory/meter readings are still needed before Owner Ready / Tenant confirmation.

The synthetic contract **does not carry real signed PDF evidence or verified payments**. It is intentionally inserted directly at the post-activation testing checkpoint; it is not evidence of successful signing or financial settlement. Automated jobs and external payment actions are not enabled by this feature.

The result displays the synthetic Tenant login and the password from local configuration so it can be copied into a test session. The password is only stored as an Identity hash in PostgreSQL. A stable `Idempotency-Key` prevents duplicate creation when retrying an uncertain HTTP response.

All room, asset, template, verification, tenancy, and task writes share the same transaction; the seed will not leave a partial room/inventory on failure. The HTTP controller is intentionally thin and delegates persistence to the infrastructure development-seed service.

Do not use this endpoint for staging, production, real tenants, or externally hosted PostgreSQL databases.
