# Location setup Wizard integration — 2026-11-09

## Traceability

- Requested behavior: preserve the existing eight-step Owner Web Location setup Wizard and replace demo Room Type/Room data with server-confirmed configuration.
- Requirement scope: BF-01, UC-04–UC-07, GBR-08 and DBR-02.
- Authorization: Owner writes; authenticated scoped reads remain enforced by `Permissions.Property`.
- Data affected: Location-scoped `RoomType`, `Room.RoomTypeId`, Room Type-scoped `BillingPolicy`, and bulk Room creation.

## Delivered foundation

- `GET/POST /api/v1/room-types` and `GET/PUT /api/v1/room-types/{id}`.
- `RoomWrite` and `RoomDto` expose `roomTypeId` and validate that the active Room Type belongs to the same Location.
- `POST /api/v1/locations/{locationId}/rooms/bulk-create` validates the complete request under the Location lock before adding any Room.
- Billing policy requests accept either `roomId` or `roomTypeId`; resolved prices prefer Room, then Room Type, then Location scope.
- Owner Web API mode reads and edits Location Room Types and requires a Room Type when creating/editing a Room.

## Remaining setup aggregate work

The existing Location API still persists only name, address and active state. The Wizard-specific fields (code, floor count, contacts, description and setup lifecycle), resumable draft, preview and idempotent atomic commit require an approved persisted setup aggregate. Asset-template, fee-template and policy-template application APIs already exist and must be orchestrated by that aggregate rather than by a partially successful browser request chain.

Until that aggregate exists, API mode must not claim that all eight Wizard steps were committed atomically. Existing post-creation Location tabs remain the supported server-backed editing workflow for assets, billing, utilities and operating policies.

## Acceptance evidence

- Application unit tests cover Room Type linkage and rejection of duplicate bulk Room numbers.
- Owner Web component test covers creation of a Room with its selected Room Type.
- Full Backend build may fail to copy output when a locally running `BHome.Api` process locks the Debug binaries; this is an environment lock, not compile evidence for the API executable.
