# Holding Contract Mobile — BF-03A integration, 12/11/2026

Scope: the explicit Holding creation/integration request supplied on 12/11/2026. Reuse the existing BF-03A services and DTOs; no schema, backend business-rule or endpoint changes. This request permits Owner management of Holding contracts on Mobile; Main contract Owner restrictions remain unchanged.

## Current UI — room, Holding applicant, confirmation

The latest correction replaces existing Tenant/representative selection with information entry for a new Holding applicant. The current creation steps are Chọn phòng → Người giữ chỗ → Xác nhận. There is no Tenant selector, automatic account creation or automatic account linking.

- Step 1 retains the authorized Available room list, automatic locationId resolution, preparation and Holding readiness checks. No location dropdown is added.
- Step 2 uses `HoldingNewTenant` in Holding context. Name and email are accepted by the existing `POST /api/v1/capture/residents` DTO (roomId, displayLabel, residentType=0, email). The actual returned ID is retained as representativeResidentId. Staff opens the existing IdentityWizard for manual identity entry or CCCD OCR, review and explicit confirmation via the existing capture/identity APIs. Failed OCR still allows manual entry. Owner can record basic information but cannot bypass Staff-only identity confirmation. No CCCD images are newly persisted by this implementation.
- The backend requires verified Residents for Holding creation, but HoldingDraftInput permits tenantUserId=null. The Holding payload now sends null for an unlinked applicant, or the actual linked ID if the backend returns one. Main draft payload validation is preserved. No dummy ID or nickname substitutes for verified identity.
- Step 3 reviews room/location, entered email and verified full name/date of birth when supplied by the identity-confirmation callback. Raw CCCD numbers and images are not copied into the contract review summary. The existing dates, expiry, deposit and terms remain mapped to HoldingDraftInput. The signing Owner is resolved uniquely from preparation and displayed read-only. Draft creation does not approve, sign, pay or activate.
- The duplicate local back header and refresh icon are removed. WorkspaceShell retains its existing top back control and bottom navigation; the wizard uses a secondary step-back action. Query errors have an inline retry. Created profile references and entered information survive going back from confirmation.

Backend limitations: ResidentInput and HoldingDraftInput do not provide a phone field for this applicant path, so no unsaved phone input is invented. The shared IdentityWizard gains an optional verified-name/date callback used by Holding only; Main/Tenant Onboarding validation, routes and confirmation behavior remain intact. A signing Owner must be uniquely identifiable; multiple eligible Owners without a backend designation block creation. Accountless Holdings use the backend's existing internal-signing mode and remain subject to its separate Owner approval/signing/deposit/activation requirements and configured signing/notification services.

Changed files for this correction: `packages/client-core/src/contracts.ts`, `src/mobile/src/features/contracts/ContractDraftForm.tsx`, `HoldingNewTenant.tsx`, `src/mobile/src/features/onboarding/IdentityWizard.tsx` (optional callback only), `src/mobile/src/components/WorkflowControls.tsx` (optional email keyboard), `src/mobile/src/__tests__/holding-draft.test.tsx`, `holding-new-tenant.test.tsx`, and this note. Eight focused test files passed 72 tests, including existing onboarding and anonymous-signing checks. Mobile/client-core type checks passed. Lint status is reported with the task response. No live provider/bank or shared-data acceptance is claimed.

## History — preceding three-step representative selection

The latest supplied redesign request replaces inline new-tenant creation with the existing-representative selection flow. `ContractDraftForm.tsx` now reuses the same Heading, OnboardingStepper, rounded white Box, ChoiceField and Action components as Tenant Onboarding. The reference Onboarding screen is not edited for this redesign.

1. Chọn phòng: one searchable Phòng giữ chỗ field, automatic location resolution, selected-room readiness/preparation loading, concise loading/empty/error states, and Tiếp tục gated on valid room data.
2. Người đại diện: verified non-CoOccupant records for the selected room; explicit Owner-only Tenant account linking when needed. There is no signing Owner dropdown. A unique Owner from preparation is resolved internally and shown read-only in step 3. Missing or multiple Owner results block progression/submission: the current DTO has no explicit designation field, so the frontend never guesses or selects the first of multiple accounts.
3. Xác nhận: read-only room/location/representative/Owner summary and the existing required dates, expiry time, deposit amount and terms. Tạo hợp đồng giữ chỗ creates only the draft and opens actual contract details via the existing onCreated handoff.

Header back navigation and step-back buttons retain valid input. Changing the room clears dependent representative/Owner references. No Location dropdown, template-introduction page, technical template metadata, new navigation route or backend change is introduced. `ChoiceField` gains an optional placeholder; its default remains unchanged for other screens.

Current redesign files: `src/mobile/src/features/contracts/ContractDraftForm.tsx`, `src/mobile/src/components/WorkflowControls.tsx`, `src/mobile/src/__tests__/holding-draft.test.tsx`, and this implementation note. The six-file focused run passed 52 tests. These include three-step navigation, back-state preservation, exact DTO and UTC mapping, duplicate prevention, readiness changes and role boundaries. Typecheck/lint results are reported with the task response. No live provider or shared-data acceptance is claimed.

## History — preceding inline new-tenant change, superseded in the creation UI

The subsequent request replaces the existing-representative selector with new-tenant input inside Holding creation. `HoldingNewTenant.tsx` collects name and email, then calls the existing `POST /api/v1/capture/residents` with the selected roomId and residentType=0. The backend Resident ID becomes the internal representativeResidentId; no existing person is silently selected. Staff can open the existing IdentityWizard in manual-entry or OCR mode. Owner can create basic information but cannot confirm identity on behalf of Staff. Existing verification and Tenant-link validation before creating the Holding draft remain in force.

After a Resident is created, the room is locked to its actual room. Parent form state retains the Resident ID, name and email when moving back from terms or refreshing preparation. Duplicate clicks are blocked; an ambiguous creation response blocks automatic retry. Account linking remains an explicit Owner operation. New tests cover DTO mapping, identity entry/OCR reuse, role restrictions, input validation, duplicate prevention and restoring the created profile. The current focused four-file run passed 53 tests. The earlier full-suite result below applies to the preceding integration version, not a new full-suite run after this change.

Additional changed files: `src/mobile/src/features/contracts/HoldingNewTenant.tsx` and `src/mobile/src/__tests__/holding-new-tenant.test.tsx`, plus the existing creation form, shared contract client, Tenant-link wording and holding-draft tests.

## Navigation

Contract list / Staff Holding shortcut → configuration → terms and confirmation → create draft → actual contract detail.

Configuration has three main fields: Phòng giữ chỗ, Người đại diện, Owner ký hợp đồng. There is no introduction or Location dropdown. The room picker supports search and includes the location name. A header back arrow and refresh icon replace footer back/reload buttons. There are two creation steps; going back retains the entered draft. Staff can open the existing onboarding/CCCD flow with the selected room/location when verified representatives are missing. OCR and manual confirmation retain their existing permissions.

Approval, signing, deposit, activation, cancellation and conversion remain status-based actions in contract detail. Creating a draft does not approve, sign, pay, activate or change the room locally.

## Screen/API mapping

- Creation room picker: `GET /api/v1/capture/locations` and paginated `GET /api/v1/rooms?roomStatus=Available&page=...&pageSize=100`. Only authorized locations and numeric Available rooms are considered. No global room list is inferred from preparation.
- Room eligibility: `GET /api/v1/rooms/{roomId}/readiness?purpose=Holding`. Require matching room/purpose, Ready, isReady=true, no blockers and no unverified conditions. Failed checks do not produce selectable data.
- Configuration: `GET /api/v1/contracts/configuration`, loaded silently. After room selection call `GET /api/v1/contracts/preparation?locationId=...` and recheck readiness. The selected room must also match the returned location and Available status.
- Tenant linking: verified, non-CoOccupant representatives come from preparation. An unlinked record shows an informational state. Only Owner can load `GET /api/v1/contracts/preparation/accounts` and explicitly invoke `POST /api/v1/contracts/preparation/residents/{residentId}/account`. Staff cannot invoke these APIs. Linking is never automatic.
- Draft creation: `POST /api/v1/contracts/holdings` with the existing HoldingDraftInput and Idempotency-Key. The existing payload includes roomId, ownerSignerId, tenantUserId, representativeResidentId, one residentId, startDate/endDate, expiresAt, holdingDeposit, terms and reservedCapacity. Deadline input uses Vietnam time and is sent as UTC. Readiness is checked again with the supplied startDate before submission. Identical retries retain their idempotency key.
- After creation: the existing contract-detail loader uses `GET /api/v1/contracts/{id}`. No status is fabricated.
- Owner approval: `POST /api/v1/contracts/{id}/holding-approval` through the existing confirmed action form. Staff only sees pending approval.
- Signing/documents: reuse the existing previews, signing, signing/sync, signing recovery and document APIs/components. Owner signing controls apply only to the designated Owner signer; Tenant signing remains scoped to the actual Tenant. No successful signature is simulated by this change.
- Deposits: `GET /api/v1/contracts/{id}/holding-deposit`, `GET/POST /api/v1/contracts/{id}/deposit-verifications`. Owner deposit actions are offered after approval and backend-confirmed signature evidence.
- Receipt allocation: Owner explicitly opens the payment selector, loads paginated `GET /api/v1/payment-transactions`, then `GET /api/v1/payment-transactions/{transactionId}/deposit-context?contractId=...`. The selected context must match the actual transfer and contract. A human-confirmed `POST /api/v1/payment-transactions/{transactionId}/allocate-holding-deposit` sends contractId, actual payer data, expectedReference and Idempotency-Key. Existing external-payer attestations may be selected; this UI does not invent payer identities. Context problems block submission. Only an Allocated response produces a success message; contract/deposit data is subsequently reloaded.
- Activation: Owner-only `POST /api/v1/contracts/{id}/holding-activation`, enabled by activation-readiness. After successful mutations, contract data, deposit data and `GET /api/v1/rooms/{roomId}` are fetched again. Existing mutation invalidation refreshes dependent room/contract queries. Room status comes from the backend.
- Later management: preserve `holding-cancellation` and `holding-conversion`. Cancellation collects the existing cause enum, reason and human confirmation. Staff conversion remains available for an eligible active Holding. History and versions use the existing history/versions endpoints.

## Location and Owner mapping

The selected Room DTO supplies locationId. It is retained in form values and used to fetch preparation, rather than sent as a new field in HoldingDraftInput. RoomId remains the authoritative room reference in the create DTO. Representative records are restricted to that room. Owner choices come from that location's preparation response; a single choice is selected automatically. The backend currently returns eligible active Owner accounts without a separate Owner–Location relationship in this DTO; the frontend adds no invented association rule.

## Changed implementation files

- `packages/client-core/src/contracts.ts`
- `src/mobile/src/components/WorkflowControls.tsx`
- `src/mobile/src/features/contracts/ContractDraftForm.tsx`
- `src/mobile/src/features/contracts/useHoldingPreparation.ts`
- `src/mobile/src/features/contracts/HoldingTenantLink.tsx`
- `src/mobile/src/features/contracts/HoldingDepositAllocation.tsx`
- `src/mobile/src/features/contracts/ContractScreen.tsx`
- `src/mobile/src/features/contracts/ContractWorkflowPanel.tsx`
- `src/mobile/src/features/contracts/ContractActionForm.tsx`
- `src/mobile/src/features/contracts/contractSections.ts`

Tests updated/added: `src/mobile/src/__tests__/holding-draft.test.tsx`, `holding-allocation.test.tsx`, `contract-sections.test.tsx`, `holding-disposition.test.tsx`, `owner-mobile-decisions.test.ts`; `tests/mobile/ocr/staffDashboard.test.tsx` reflects the existing Holding shortcut.

## Validation and remaining dependencies

The focused six-file test run passed 66 tests, including room source/selection, readiness, account-link permissions, Owner/Staff action boundaries, activation gating, actual allocation payload, duplicate prevention and retry keys. Mobile and client-core type checks passed; Mobile lint and changed client-core lint passed. The full Mobile suite under the project's Node 22.23.4 passed 981/984 tests (83/85 files). The remaining failures are outside the Holding flow: two Tenant meter-history cases lack useLocalSearchParams in the router mock, and one Tenant invoice-flow case supplies invoice-shaped data to the confirmed-reading screen. They were reported without changing unrelated product behavior. The initial full-suite attempt under the host Node also triggered Expo startup runtime expectations; rerunning under the configured Node 22 resolved those runtime-related failures.

No live signature-provider, bank allocation or activation acceptance was performed against shared data. Provider credentials/certificates, verified resident/account linkage, approved templates, policies and operational room readiness are existing backend prerequisites. Unconfigured dependencies remain errors or blockers; they are not replaced by mock data.
