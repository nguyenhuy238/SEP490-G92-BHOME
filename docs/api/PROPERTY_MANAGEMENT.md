# Property configuration API

Current baseline: **2026-11-09**, native **Location → Room**, Compact24.
[Runtime inventory](API_RUNTIME_ROUTES.md) and [implementation status](API_IMPLEMENTATION_STATUS.md)
record the implementation SHA, counting methodology and executed validation.

| Resource | Current behavior |
| --- | --- |
| Location | Owner edits name/address/active state, with optimistic version and closure guards |
| Room | Direct locationId, roomNumber, optional floor, capacity 1–32767; configuration cannot set OnHold/Occupied |
| Physical Asset | Real Location/Room or common-area asset; condition, version, workflow guards, evidence and history |
| BillingPolicy | Location or explicit Room scope; exact decimal rate; effective dates, overlap checks and audited replacement |

Current DTOs: [PropertyContracts.cs](../../src/backend/BHome.Application/PropertyManagement/PropertyContracts.cs).
LocationWrite, RoomWrite and PolicyWrite reject unmapped fields, including obsolete
RoomType fields even when null. `roomId:null` selects Location fee scope. Rates use
decimal strings. Permissions and billing/payment state remain server-authoritative.
Invalid scope/input, authorization and stale-state errors use the applicable service
400/401/403/404/409 policy.

Owner has management access. Staff reads permitted resources only at currently
assigned Locations and uses separately authorized operational actions. Tenant cannot
browse configuration. Every object lookup retains server-side scope checks. Signed
contracts and finalized invoices use their existing amendment/adjustment workflows.

[Owner setup](OWNER_SETUP_COMPACT24.md) covers local desired inventory versus physical
verification, advanced utility evidence/calculations and operating policies.
[Shared configuration](SHARED_CONFIGURATION.md) covers reusable global defaults,
catalog, packages, fees, policy content, application, usage and Location copy.
Shared data becomes local configuration only after explicit successful application.
Room templates do not restore the historical operational RoomType.

Owner Web API mode uses persisted property/setup/shared APIs. Mobile Setup uses native
Location/Room APIs. Explicit mock mode is separate. Applied defaults may fill capacity
during explicit Room creation; rent still requires its own Owner-confirmed policy.
Physical assets require actual verification.

The [previous document](history/PROPERTY_MANAGEMENT_before_2026-11-09.md) preserves the
superseded Chain/RoomType design as history and is not an active implementation contract.
