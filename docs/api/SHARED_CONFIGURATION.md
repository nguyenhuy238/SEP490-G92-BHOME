# Shared configuration API

Owner-only, authenticated routes under `/api/v1/shared-configuration/{resource}`.
Resources: `room-type-templates`, `asset-catalog`, `asset-templates`, `fee-templates`,
`policy-templates`. The compatibility room-template route describes defaults only;
it introduces no operational RoomType or hierarchy.

GET collection accepts search, status, page (1+), pageSize (1–100), and optional
`latestOnly=true` and returns items/total/page/pageSize. By default every edition is
returned for compatibility. `latestOnly` selects one current edition per family
before searching and paging. With `status=Published`, it selects the latest
published edition; with `status=Archived`, it lists only fully archived families.
GET `/{id}`, POST collection and PUT `/{id}` use shared document metadata and
`{name, description, data, expectedVersion, publishImmediately?}`. Data is strictly
validated per resource. Names are limited to 150 characters for compatibility with
local configuration, normalized for whitespace, Unicode and case-insensitive
uniqueness across families, including archived names.
Money and fractional quantities preserve exact decimal strings. Counts are integers.

Owner Web sends `publishImmediately=true`: creation or completion of a legacy
Draft persists a Published document atomically, so it is immediately selectable.
Updating an unused Published document keeps its ID and edition and advances its
concurrency version; updating an already applied document creates a new Published
edition with a new ID in the same family. An unchanged valid Published payload
returns the current document without a new revision or edition. Application and
setup provenance, including nested catalog references in published/archived
templates, prevent changes to a used edition. A stale edit returns 409. Existing
configuration copies are independent and historical source editions remain intact.

POST `/{id}/publish`, `/{id}/archive`, `/{id}/restore` and `/{id}/versions` require
expectedVersion. The legacy lifecycle remains supported when the optional flags
are omitted: versions creates a Draft edition in the same family; only one Draft
per family is allowed. POST `/{id}/duplicate` additionally requires a distinct name
and creates a new family; `publishImmediately=true` creates it as Published.
GET versions returns family editions; GET history returns revisions of that
document. `wholeFamily=true` on archive archives every active edition atomically;
on restore it reactivates the latest archived edition after validation of its name
and nested dependencies. Older editions remain archived. Archive retains data and
references. A stale or unpublished nested catalog reference prevents publication
or restoration; existing copied configuration is unaffected.

Fee templates reject overlapping effective periods against another Published family
with the same category, method, charge code and scope when published, including
`SaveAsync` with `publishImmediately=true` (409 `overlapping_shared_fee_period`).
Legacy Draft saves may overlap because Drafts are not selectable and do not reserve
an effective period. PropertyManagement UTC12 exercises Owner Web's save-and-publish
command and verifies rejection leaves the existing Published version unchanged.
This shared-library check is separate from target Location validation when applying a fee.

Room defaults: capacity 1–32767, positive area, distinct amenities, optional referenceRent.
Catalog: category, unit, non-negative referencePrice. These are reference data.
Asset templates: items with published catalogId/catalogVersion, quantity, required,
trackingMode Serialized/BulkQuantity. The server resolves and freezes catalog fields;
duplicate catalog families are rejected. Fee: category, chargeCode, method,
referenceRate, unit, scope Location/Room, effectiveFrom/To. Native charge compatibility
and four decimal-place limits apply. Canonical fee units are `VND/month` for Rent
and ServiceFee (FixedPerRoomPerMonth), `VND/person/month` for ServiceFee
(FixedPerPersonPerMonth), `kWh` for Electricity (Metered), and `m³` for Water
(Metered). The server normalizes supported display labels (including `m3`,
`VND / tháng`, and `VND / người / tháng`) and rejects incompatible units.
Reserved codes are `RENT`, `ELECTRICITY`, and `WATER`; service codes must be
distinct from these. Applying a fee creates a native policy whose category and
method determine the billing unit and are frozen in subsequently bound contract
terms. Existing signed contracts do not adopt the newly applied fee.
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

GET `/{id}/applications?page=1&pageSize=20` returns committed family usage from
direct application and Location setup provenance, exact
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

API mode uses typed clients and server pagination for every library. The library
uses grouped latest editions, atomic save/duplicate, whole-family archive/restore,
family history, application preview and persisted usage. The setup wizard offers
only the latest Published edition of each family for new selections, but keeps
previously selected data and exact provenance in its draft; refreshing the library
does not replace selected snapshots. Legacy drafts remain available to complete.
Asset packages select real published catalog editions. Decimal inputs remain
strings. Failed writes retain the form;
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
  "publishImmediately": true,
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
