# Main initial checkout: work in progress

This branch contains the current implementation snapshot, not a completed Main Contract release.

The agreed behavior is one QR for the remaining security deposit, first month's rent and applicable fixed service fees. Verified Holding allocations must not be charged twice. Owner signing is the acceptance; a separate Owner approval stage is not required.

Implemented scaffolding includes a backend order snapshot, a MainInitial payment-code kind, separate deposit/rent allocations, an activation guard and a Mobile payment card. The SQL change adds `payment_allocations.target_initial_contract_id` and supporting guards. **It has not been deployed to Neon.** Do not deploy the new schema reference or restart the API against the old schema without completing and validating the upgrade procedure.

The combined-payment integration test previously failed during reconciliation and still requires investigation. In the latest pre-push run, Docker Desktop was unavailable: 14 environment/scope tests passed and 2 PostgreSQL integration tests were skipped. These skipped tests do not establish payment correctness. The backend compiles, Mobile/Owner Web typechecks pass, and 66 targeted Mobile tests pass.

Remaining work includes completing reconciliation and schema-upgrade verification; extending signing/testing and the remaining Main lifecycle UI; implementing the agreed step sequence without a separate Owner approval; and verifying Holding inheritance, initial-payment accounting, account provisioning and email delivery end to end. No payment or account should be treated as successful based on frontend state.

Private environment files, provider credentials and workstation helper scripts remain excluded from Git.
