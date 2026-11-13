# Shared configuration API

Owner-only, authenticated routes under `/api/v1/shared-configuration/{resource}`.
Resources: `room-type-templates`, `asset-catalog`, `asset-templates`, `fee-templates`,
`policy-templates`. The compatibility room-template route describes defaults only;
it introduces no operational RoomType or hierarchy.

GET collection accepts search, status, page (1+), pageSize (1–100) and returns
items/total/page/pageSize. Every edition is returned; status filtering is explicit.
GET `/{id}`, POST collection and PUT `/{id}` use shared document metadata and
`{name, description, data, expectedVersion}`. Data is strictly validated per resource.
Names are limited to 150 characters for compatibility with local configuration.
Money and fractional quantities preserve exact decimal strings. Counts are integers.

POST `/{id}/publish`, `/{id}/archive` and `/{id}/versions` require expectedVersion.
Versions creates a Draft edition in the same family; only one Draft per family is
allowed. POST `/{id}/duplicate` additionally requires a distinct name and creates a
new family. GET versions returns family editions; GET history returns revisions of
that document. Published payloads are immutable. Archive retains data and references.

Room defaults: capacity 1–32767, positive area, distinct amenities, optional referenceRent.
Catalog: category, unit, non-negative referencePrice. These are reference data.
Asset templates: items with published catalogId/catalogVersion, quantity, required,
trackingMode Serialized/BulkQuantity. The server resolves and freezes catalog fields;
duplicate catalog families are rejected. Fee: category, chargeCode, method,
referenceRate, unit, scope Location/Room, effectiveFrom/To. Native charge compatibility
and four decimal-place limits apply. Canonical fee units are `VND/month` for Rent
and ServiceFee (FixedPerRoomPerMonth), `kWh` for Electricity (Metered), and `m³`
for Water (Metered). The server normalizes supported legacy display labels (including
`m3` and `VND / tháng`) and rejects incompatible units. Reserved codes are `RENT`,
`ELECTRICITY`, and `WATER`; service codes must be distinct from these. Applying a
fee creates a native policy whose category and method determine the billing unit;
no new unit or method is introduced into contract or invoice calculations.
Policy: content and effectiveFrom.

POST `/{id}/apply-preview` accepts locationId, expectedVersion, conflictStrategy Reject,
optional roomId (required for Room fee scope), includeOptionalItems. It returns planned
changes, conflicts, unsupportedReferences, canProceed and targetState. It writes no
business/audit/application records. POST `/{id}/apply` requires that targetState plus
a UUID Idempotency-Key header. A changed source/target or conflicting configuration
returns 409; unsupported input returns 400. Same key and payload returns the original
result; changed payload returns 409. The whole write and provenance are transactional.

Room application creates local RoomDefaults, available through Owner-only GET
`/api/v1/locations/{locationId}/room-defaults`. Explicit Room creation can consume
capacity; area/amenities/reference rent remain reference configuration. Asset application
creates a local Draft package; publish/assignment/verification remain separate. Optional
items can be excluded as a group; required items are always included. Policy application
creates a Draft local policy; existing signing and activation flows remain authoritative.
Fee application creates a native policy and requires a current/future source effective
date and no overlapping target charge. No implicit replacement is performed.

GET `/{id}/applications?page=1&pageSize=20` returns committed family usage, exact
sourceId/sourceVersion/sourceEdition, actual target, actor/time/status and created
references. Total and locationsUsing are database-derived across all editions.
LocationsUsing counts historical distinct target Locations, including subsequently
inactive Locations; it does not imply a live binding or automatic propagation.
One family may be applied once per Location; applying another edition requires an
explicit local change through its existing configuration workflow.

Storage and ownership: see the shared configuration persistence decision. Staff,
Tenant and anonymous requests cannot access the shared namespace.

## Location configuration copy

Owner-only POST `/api/v1/location-configuration/copy-preview` and `/copy` accept
sourceLocationId, targetLocationId, groups, conflictStrategy Reject. Supported groups
are RoomDefaults, AssetTemplates, FeePolicies and OperatingPolicies. Source and target
must be distinct active Locations. Preview returns changes, conflicts, unsupported
references, sourceState, targetState and canProceed. Execution requires both state
hashes and a UUID Idempotency-Key; all selected writes and provenance commit together.
Committed operations retain the exact source document IDs/versions/kinds and the
confirmed source/target state hashes, alongside the created target references.

FeePolicies additionally requires an explicit current/future effectiveFrom. It copies
only source policies effective on that date, retaining their end dates and exact rates,
and starts the independent target policies on the selected date. Empty source groups,
overlapping target charges and repeated configuration names are reported as conflicts.
Room-scoped fees require mapping and are explicitly rejected by this operation.
Assets and policies copy as Drafts. Room defaults remain reference data. Source IDs and
versions are captured by the confirmed source-state hash and operation provenance.
No Tenant, contract, financial transaction, physical Asset, meter or evidence is copied.

## Owner Web integration

API mode uses typed clients and server pagination for every library. Draft forms,
published editions, duplication, archive confirmation, family history, application
preview and persisted usage are connected. Asset packages select real published
catalog editions. Decimal inputs remain strings. Failed writes retain the form;
an ambiguous apply/copy retry retains the same payload and UUID key.

Copy is available from Location management and the native Location workspace.
Explicit Room creation can select applied local defaults to fill capacity; it still
requires the user to save a new Room through the native API. The existing prototype
library/context/copy wizard is isolated behind explicit development mock mode.
Mutation invalidation refreshes persisted setup and usage queries.

## JSON contract details

Every SharedDocument returns id, resource, familyId, edition, version, name,
description, status, managementScope, createdBy/createdAt, updatedBy/updatedAt and
data. Edition is a family edition number; version is one document's concurrency
counter. Dates use ISO yyyy-MM-dd; event timestamps are UTC ISO-8601. Data decimal
responses accept exact strings or safe integral JSON numbers; forms submit decimal
strings. Payload envelopes reject unknown members and missing data.

Example room-default request (illustrative, not executed evidence):

```json
{
  "name": "Two-person room defaults",
  "description": "Reference configuration for explicit setup",
  "expectedVersion": 0,
  "data": {
    "capacity": 2,
    "area": "25.0001",
    "amenities": ["Balcony"],
    "referenceRent": "3500000.0001"
  }
}
```

Apply returns a SharedOperation containing id, kind, key, fingerprint, actorId,
appliedAt, sourceId/sourceLocationId, familyId, sourceVersion/sourceEdition, resource,
targetLocationId, status, createdReferences, sourceReferences (id/version/kind),
sourceState and targetState. Copy operations use source Location plus per-document
sourceReferences; shared edition fields are zero/not applicable for Location copy.
Completed retries return this recorded result even after a Location is deactivated;
new previews/executions still require active Locations.
