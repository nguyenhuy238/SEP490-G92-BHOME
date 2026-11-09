# Shared configuration persistence decision

Approved scope: the Team Leader's implementation request of 2026-11-09, recorded
in CONFIGURATION_SCOPE_DECISION_2026-11-09.md. This extends configuration setup;
it does not restore Chain or operational RoomType aggregates.

## Ownership and storage

The current permission model gives Owner management access across BHOME Locations.
Shared documents therefore belong to the explicit `BHOME` management scope, with
the authenticated creator recorded separately. This is not a multi-organization
tenancy model. Staff, Tenant and Guest cannot read or mutate the library.

Reuse Compact24 `operational_tasks` COMMAND records. The schema explicitly permits
COMMAND records with nullable Location, requires a unique source key, references
the real creator through assigned_user_id, and enforces append-only JSON history.
Global documents have SQL NULL location_id; no surrogate Location is introduced.
Each shared version is one independently identified command document. Application
and copy command records carry the actual target Location. Record types and source
key namespaces isolate them from jobs and operational tasks. No schema migration
is necessary. Existing FK, unique-key and history guards remain enabled.

The store provides server pagination and filtering. A transaction-level global
advisory lock serializes library name/family/reference checks and applications.
Cross-Location operations additionally acquire the existing Location locks in sorted
UUID order before reading current state or writing. Native configuration services
join that transaction. A failure rolls back target writes and provenance together.

Catalog references are validated against immutable published catalog versions;
the referenced version and descriptive fields are frozen into the template item.
Archive never deletes referenced documents. There is no arbitrary JSON update API:
resource-specific validators whitelist payloads. These guards, retained version
records and serialized writes preserve reference integrity without new tables.

## Lifecycle

`familyId` groups editions; `edition` identifies the immutable business edition.
`version` is optimistic concurrency for one document. Drafts can be edited;
Published data cannot. New edition creates a new Draft document with the same
family; duplicate creates a new family. Archive retains payload and history.
Names are unique, case-insensitively, across non-archived families per resource.
All Owners share this namespace. Published catalog items use the same lifecycle.

Applying creates independent local defaults, Draft asset templates, native fee
policies or Draft operating policies. It does not create Rooms, physical Assets,
occupancy or signed obligations. Preview returns a content/state hash and no writes.
Execution requires Reject strategy, the confirmed hash and a durable UUID key.
Usage derives from committed application records. Copy uses the same transaction
and provenance rules; unsupported physical or Room-specific references are reported
and rejected, never silently skipped. Financial writes retain native date/rate and
overlap validation. Reference rent remains a suggestion for explicit setup only.

Validation trace: GAP-005/006; BF-01, GBR-01/02/08/18, DBR-07; tests cover lifecycle,
permissions, version conflicts, exact decimals, immutable source snapshots,
preview purity, retries, rollback, and preservation of physical/financial records.
