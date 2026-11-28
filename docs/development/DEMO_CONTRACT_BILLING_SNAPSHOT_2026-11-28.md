# Demo contract billing snapshot — 2026-11-28

Scope: the approved academic Owner quick-create action (`development/onboarding-seed`), BF-03/04 and BF-05, UC-13..17 and UC-20..21, GBR-04/07..09. No change to role or Location authorization, payment verification, or finalized invoice rules.

Production verification of release PR #195 found `contract_price_snapshot_invalid` when billing a newly created synthetic demo contract. The immutable-price guard correctly prevented finalization. Policy rates round-trip through PostgreSQL with scale 4, while native contract VND amounts have scale 0; JSON document hashes preserve decimal scale. The seed path must normalize contract rent before building its snapshot, as the regular contract sealing path already does.

Affected path: `DevelopmentOnboardingSeedService` → Compact24 PostgreSQL contract storage → `ContractChargeSnapshot.IsIntact` → `ContractBillingPrices.Read`.

Acceptance: after creating through the real Owner API and reloading from PostgreSQL with its residents, the hash remains intact and all three agreed billing charges are available without missing inputs. Existing cross-role, cross-Location, idempotency and real-inventory checks in `OwnerQuickCreateUsesExistingRoomAndRealConfigurationWithoutDuplicateContract` remain in force. A hash mismatch must continue to block billing; existing signed records must not be silently rehashed.

Verification: the focused PostgreSQL regression was executed before the fix and failed at `ContractChargeSnapshot.IsIntact`; after normalizing rent it passed (1 passed, 0 skipped). PostgreSQL 18 was started on a temporary loopback port with a dedicated cluster and shut down after the run. The test never used a working or Production database. The RENT charge is bound to the same whole-VND amount, matching regular contract snapshot construction. No schema migration or production data repair is proposed.
