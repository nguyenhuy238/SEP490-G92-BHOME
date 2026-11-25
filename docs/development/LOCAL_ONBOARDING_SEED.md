# Owner quick-create demo contract (BF-03 / UC-13–17, GBR-01/04/18, DBR-02)

Owner Web shows **Tạo HĐ test** beside Demo Clock when the server reports that the Owner may control that clock. Staff Mobile no longer provides the generator.

## Server guard

`POST /api/v1/development/onboarding-seed` requires Owner authentication and an active Owner account. The endpoint is enabled in approved demo-clock environments, including the reviewed academic Staging/Production deployments, and the pre-existing explicitly enabled local Development fixture. The server checks the same designated Owner restriction as Demo Clock outside Development. `DevelopmentContractSeed:Enabled=false` explicitly disables the generator.

For the pre-existing local opt-in without Demo Clock, the environment must be Development and the database must have a loopback host and a `bhome_` name. The endpoint is unavailable for an ordinary non-demo deployment. Never enable the feature against real tenant data.

`DevelopmentContractSeed:TenantPassword` is optional; a random strong test password is generated if none is configured. The password is hashed by Identity, returned only on the first successful creation response and never logged. If that response was lost, the same idempotency key returns the existing contract and email, without returning its password.

## Request and persisted result

The Owner selects an existing Location and vacant Room. Request body: `{ locationId, roomId, expectedBusinessDate }`, with a UUID `Idempotency-Key` header. The optional expected business date is checked for new writes; an already committed request replays its existing result.

Under the standard contract transaction (payment ledger, Location advisory lock, Room lock), the service checks active Location, available Room, capacity, room type, operational blockers, overlapping contracts and effective existing rates/meters. It requires a valid rent/electricity/water policy and one active electricity and water meter, installed by the business date; advanced utility profiles require normal contract review.

Quick-create also requires at least one existing physical asset in the canonical room inventory (`development_seed_assets_required` otherwise), so a configured requirement alone cannot be mistaken for a real asset linked to the test contract. The contract-linked move-in inventory task captures the existing asset IDs and expected quantities, retaining every configured group, including groups that still lack physical assets. The handover draft exposes the same room inventory. No observations or confirmations are prefilled. Configure and record the room's actual assets before creating a test contract.

The transaction creates an explicitly demo-only active 12-month Main Contract starting on the current business date, a synthetic Tenant account, encrypted synthetic Resident identity, an agreed price snapshot using existing configured rent and all effective fee policies, and the canonical handover/initial meter tasks. The Room becomes Occupied. Existing room assets, meters and configuration are retained. No new room or fabricated physical inventory is created.

The test contract expressly has zero deposit and no initial payment obligation. No real or fabricated signed PDF, bank payment, photo or confirmed meter reading is generated. Staff must complete handover using actual evidence/confirmation required by the workflow. Normal contract signing, payment, and activation rules are unchanged.

A stable request key and the locked availability check prevent duplicate contracts and concurrent occupancy. No jobs or integrations are enabled by the shortcut.
