# BF01 — Location setup and independent configuration (2026-11-13)

Status: Owner-approved direction, implementation tracked separately. Supersedes the setup UX restrictions of the 2026-11-09 configuration decision; the Compact24 Location -> Room model and isolation rules remain in force.

## Traceability

- BF01 / UC04–UC07 / FE01: Location, room configuration, room creation, assets, rent and fees.
- GBR01–03: server-side Owner authorization and location scope.
- GBR08–09: effective-dated pricing; signed terms and finalized invoices remain historical.
- GBR13: audit, configuration versions, no destructive history rewrite.
- BF03–05 / UC13–21: contract preparation, handover, utility and invoice consumption of real operational records.
- UC31–35: investment and expense records remain actual financial events, not template estimates.

## Decisions

1. Shared library documents are reusable reference configurations. Only Published documents are selectable for setup. Applying a template creates an independent local snapshot, with source/version provenance. Creating or editing a local configuration must not mutate or implicitly create a global template.
2. RoomDefaults is the versioned local room configuration; the legacy RoomType aggregate, RoomTypeId foreign key, and legacy billing scope remain retired. Room creation captures local-default provenance plus actual capacity/area/amenities. A later edit of defaults does not silently alter existing rooms, signed contracts, or invoices.
3. Setup wizard: (1) location details and optional copy source/selected configuration, (2) room defaults, (3) generated rooms, (4) asset requirements, (5) rent and service fees, (6) operating policy, (7) review and confirm. Draft edits are not operational writes. Source reads exclude tenants, contracts, invoices, payments, physical assets and residence history. Copy selected reusable configurations, not room-specific billing references unless explicitly mapped to a new room. Never copy a source RoomId.
4. Final setup is one backend-authorized transaction, with an idempotency key, validation and auditable results. Create Location, local defaults, rooms, billing policies, asset requirements/assignments, and operating policy together. A failed setup cannot appear complete. Re-reading the committed location is the success criterion.
5. Actual pricing uses existing BillingPolicy location/room scopes and effective dates. Reference rent becomes real rent only after Owner confirms. Existing-room price changes require an explicit effective-date operation; no silent propagation. Supported charging methods are FixedPerRoomPerMonth and Metered; do not invent per-person calculation.
6. Asset catalog/guidance, desired inventory, and verified physical assets are distinct. Setup creates requirements and assignments, not evidence of physical installation or purchases. Keep Serialized/BulkQuantity. Updating a template must not affect a room assigned another template. Existing occupied-room guards remain.
7. OperatingPolicy is a versioned location-wide document under the existing contract binding model. The wizard combines selected rule sections into a single publishable document, with explicit Owner confirmation of content and effective date. Existing signed snapshots are immutable.
8. Location details expose the same persisted configuration, rooms, assets, pricing, utility meters, operating policy, expenses and history. Missing data is not the same as a failed API request. Investment/expense actuals are not copied or generated from defaults.
9. No destructive migration or implicit legacy-room backfill. Existing rooms without provenance remain explicitly unassigned; only an approved explicit operation may associate them. Configuration metadata can use existing Compact24 versioned document containers rather than introducing a retired FK.

## Acceptance gates

- Real UI: create from scratch and copy selected source configurations, edit destination capacity, generate rooms, set asset requirements, confirm fees/policy, save, reload and inspect every tab.
- API/DB: local defaults and room provenance persist; source/shared template unchanged; idempotent retries; invalid setup rolls back; room/location scopes checked; no legacy catalog writes.
- Integration: resolved prices and contract draft use actual room policies; invoice uses existing approved billing rules; no changes to finalized invoices or signed contract snapshots; no copied operational records.
- Finance: existing location-scoped expense API retains actual amounts and evidence; no synthetic purchase cost inferred from template.

Implementation and executed test evidence must be reported separately. This decision does not certify completion or production readiness.
