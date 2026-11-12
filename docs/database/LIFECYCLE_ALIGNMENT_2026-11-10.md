# Compact24 lifecycle alignment

Requirement: BR-01/05/07 approved 10/11/2026. Runtime remains Compact24 with 24 physical tables.

- Add nullable residents.contact_email for pre-account contact identity. A case-insensitive unique index rejects conflicting resident associations. Existing records are preserved; no invented email backfill.
- contracts active check requires activation actor/time, while Tenant account creation follows Main activation. Holding may be active without a login account. Authorization, confirmed identity, signature and verified payment remain service invariants.
- Anonymous invitations use typed contracts.history projections, following the existing Compact24 writer. Only token/OTP/session hashes and private evidence object references persist. Raw delivery credentials are never part of committed data.
- Do not edit or rerun the immutable initial baseline on a populated database. Apply 20261110000100_LifecycleAlignment through the reviewed Compact24 migration workflow, on a verified authorized target only.
- Never migrate the working database as part of tests. The new regression test migrates and deletes only its own random disposable loopback database.
- A previous-property-schema compatibility option does not substitute for this lifecycle migration; deploy all required columns before the changed runtime is served.

Rollback is intentionally not destructive: do not drop contact/evidence data automatically; use a reviewed forward recovery plan.
