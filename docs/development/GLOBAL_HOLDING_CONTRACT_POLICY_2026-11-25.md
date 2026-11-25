# Global Holding Contract Policy

This change replaces per-Location Holding settings with one policy per Owner/Chain. It implements the approved Owner Web policy redesign and supersedes the editable per-Location behavior documented in `HOLDING_LOCATION_CONFIGURATION_2026-11-13.md`.

## Policy

- Each Owner has one policy shared by every Location in that Owner's Chain, including Locations added later.
- The Holding period is fixed at one calendar month. The Holding deposit is fixed at one month of the Room's effective rent. Only the terms text is editable.
- Saving a policy creates an immutable version and audit record. A no-op save does not create another version.
- If no global policy exists, Holding preparation and creation return `holding_settings_required`; legacy Location values are not selected or copied automatically. This leaves the Owner to resolve any differences explicitly.
- Existing Location `operating_settings.holdingContractSettings`, Location history and existing Contracts are retained. A policy update does not rewrite Contracts, their signing/PDF snapshots, expiry values, payments, or Room state. Existing expiry processing continues to use each Contract's persisted `HoldingExpiryAt`.
- New Holding creation always checks the current server policy version and values. Missing or stale client versions are rejected; the server supplies terms, dates, rent and deposit.

## Storage and API

- The current policy and its immutable versions are stored under the Owner's existing `users.business_profile.holdingContractPolicy` JSON field. No schema migration is needed.
- `GET/PUT /api/v1/contracts/holding-settings` and `GET /api/v1/contracts/holding-settings/versions` are the Owner Web endpoints.
- Legacy `/{locationId}` endpoints remain as compatibility routes but read/write the same policy resolved for that Owner/Chain.
- Compact24 currently enforces one Owner. The legacy schema resolves the Owner through the Location's Chain ID. Ambiguous/missing scope fails closed.

## Traceability

The change concerns BF-03/04, UC-13..16 and GBR-04. It preserves the existing signed-contract snapshot and payment/activation rules; it changes only the global Holding configuration and creation-time enforcement described above.

## Verification

- Owner Web typecheck and focused Holding settings tests: PASS.
- Contract application unit tests: PASS.
- Integration project build: PASS.
- Compact24 Docker integration tests: NOT RUN successfully because Docker is unavailable in the current environment.
