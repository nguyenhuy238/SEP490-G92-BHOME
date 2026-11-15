# Real contract signing in Step 6

Scope: UC-14/15/16, DBR-03; the explicit Step 6 integration decision approved in this session. Applies to Holding and Main contracts. No database migration is required.

The later user-approved unified Sandbox/Live payment correction supersedes the preview-only payment notes below. See [unified payment verification](SEPAY_UNIFIED_PAYMENT_2026-11-15.md): payment environment is independent of genuine signatures, normal Step 7 uses a common QR API, and Sandbox receipts use the existing reconciliation/deposit lifecycle with environment-isolated data.

## Restore Holding Step 7 sandbox QR — user-approved 2026-11-15

The user explicitly requested restoring QR on the existing Holding Step 7 and selected sandbox rather than Live. `HoldingPayment` had static text instead of a QR API call. It now loads the existing `GET /api/v1/integrations/sepay/testing/holdings/{id}/transfer-instructions`, displays the PNG, account, outstanding amount and stable backend transfer code, and offers retry. It never fabricates a paid state or calls simulation/activation.

The Test-only endpoint permits a preview for a real approved Holding only after genuine signatures and an intact snapshot. Existing anonymous/account signing remains unchanged. On Neon the deployment must retain its explicit secure external Test database opt-in; QR preview additionally permits a location explicitly bound to a SePay Test receiving account. Simulation and sandbox activation still require a demo contract. `PreviewOnly` marks real-contract QR responses, and the UI explains that Test receipts cannot pay or activate a real contract; the existing SePay environment-mismatch check is unchanged.

The user's P.203 contract belongs to a newer Test location that had no receiving account, whereas the earlier sandbox binding targeted the old Test location. The existing sandbox bank configuration was copied to the current location and an additional SePay receiving-account binding added to development user-secrets. The existing source binding remains; no Live settings or signing simulation flags were enabled for this location. Contract/payment/signature states were not changed.

Verification: three API/PostgreSQL tests passed (genuine signing then Staff sandbox QR, stable code and no payment/activation effects, existing sandbox QR guards, existing Holding deposit approval/expiry rules); 21 mobile Holding-flow tests passed, including sandbox rendering and no activation. Mobile typecheck/lint and diff whitespace checks passed. Changed files: `HoldingContractFlow.tsx`, `holdingSandbox.ts`, `SePayHoldingPreviewController.cs`, and related tests. No migration required.

Runtime verification on the existing P.203 contract: backend readiness HTTP 200, Staff QR API HTTP 200, and the Android emulator accessibility hierarchy contains the rendered `QR chuyển khoản sandbox` image after scrolling the payment card into view. No payment or activation was submitted.

## Deferred contact email — approved 2026-11-15

Source: explicit user decision to stop reserving email on unactivated onboarding profiles (UC-14/15/16, account lifecycle/DBR-03). Holding Step 2 is local state only. The existing `POST /api/v1/capture/residents` is called when opening CCCD in Step 3, without email. The backend accepts profiles without email and does not persist contact email from profile creation, including legacy clients that still submit it. Draft saving drops `TenantEmail`; the mobile Main draft no longer collects that field.

The existing `POST /api/v1/contracts/{id}/signing-invitations` accepts an optional `recipientEmail` and contract-scoped `contacts: [{residentId,email}]`. All IDs must belong to the scoped contract, all residents must be verified, and every contact must be a valid distinct email. Existing contact fields remain a compatibility fallback for older records. The immutable invitation recipient remains necessary for OTP verification and evidence; it is not a user or global email reservation. Other people’s contact addresses are never exposed by signing-status responses.

`ContractSigningInvitation.ContactEmails` uses Compact24's existing JSON history, with no new Neon table/column migration. Main activation reads the accepted invitation's contacts, creates/links accounts with existing email uniqueness and explicit-link checks, and promotes contact emails in the same transaction as activation. Holding activation still creates no accounts and does not promote contact emails. Existing signed PDFs, financial checks and lifecycle remain unchanged.

Online cleanup: 21 unlinked/unactivated resident contact emails cleared and audited; contact sets preserved for 14 existing invitations before clearing. Accounts, profiles with any activated contract, and emails already belonging to accounts were excluded. No contracts, PDFs, signature evidence or accounts deleted. A subsequent read-only preview found zero remaining eligible profile emails.

Changed components: capture DTO/repository, anonymous invitation DTO/service/domain history, activation readiness/provisioning, shared signing/contact clients, HoldingNewTenant, ContractSigningStep, mobile MainDraftScreen, OwnerHoldingSigning and web InternalSigningPanel, plus related tests.

Verification: 13 API/PostgreSQL signing integration tests passed, including deferred email through Holding/Main and Main activation, two same-email profile creations without reservation, rejection of foreign resident contacts and no accounts before activation. 102 mobile tests and 18 Owner web tests passed; both clients passed typecheck/lint and `git diff --check` passed. Three additional legacy `MainDraftReleaseBeforeAccountsTests` remain failing on expected HTTP statuses for sandbox/owner-simulation/consent-only endpoints (403 versus 404 and 400 versus 409); they are not reported as passed. No manual complete phone signing run was performed for this change. Runtime readiness returned HTTP 200 after restart.

## Approved Owner signing change — 2026-11-15

The user explicitly approved Owner signing without an email OTP for both Holding and Main. This supersedes the Owner OTP requirement described in the original integration notes below. Tenant OTP is unchanged.

`POST /api/v1/contracts/{id}/signing` accepts `method: "OWNER_SESSION"` and `consent: true`. The authenticated account must have the Owner role and match `OwnerSignerId`. The existing PDF preparation, incremental BHOME seal, storage hashes, audit, idempotency and lifecycle completion are reused. No OTP challenge or OTP email is issued for this method. The method is offered only to Owners and is their default. External signed-PDF upload and MySign remain available. Completed signatures cannot be replaced.

An explicit new Owner consent may supersede only that Owner's unfinished legacy OTP attempt. The old attempt is marked Failed and audited before a new signature is prepared. Already completed Tenant/Owner signatures are retained. Anonymous representatives still sign first; the Owner's source hash must match their accepted PDF. With an account, the Tenant keeps the existing authenticated OTP API. Full signing yields PendingActivation, never automatic Active. Steps 1–5, payment, completion, approval, reconciliation and activation rules are unchanged.

This is electronic consent authenticated by the Owner account session and sealed by BHOME, not the Owner's personal CA-certified digital signature. A saved image is applied only after explicit signing consent on each contract.

Verification of this change: 11 real API/PostgreSQL integration tests passed (Holding/Main, authenticated and anonymous Tenant, legacy OTP replacement, explicit consent/role rejection, replay, preserved PDF signatures and PendingActivation); 34 signing infrastructure tests passed; 13 Owner web and 43 mobile component tests passed. Both clients passed typecheck and lint; diff whitespace checks passed. Backend restarted with the updated Release build. These are automated integration/component results; a complete manual browser/phone signing run against the online database was not performed for this change.

## Signing without a Tenant account

The representative receives the existing email invitation, verifies its OTP, reviews the immutable PDF and submits their drawn signature and exact-document consent. Owner then signs that accepted PDF using the existing authenticated OTP, external PDF upload, or enabled MySign provider. Owner must match `OwnerSignerId`. Staff can follow and send invitations within their existing Location access; they cannot sign as either party.

The ordering is intentional: the existing invitation renderer adds the representative's acceptance before the Owner's cryptographic signature is created. The Owner signs incrementally on those bytes. The backend checks the snapshot and the Owner signature's source SHA-256 against the accepted Tenant PDF. It stores the Owner's separate `ContractSignature`, method, time, signed PDF hash and final internal evidence. Existing completed evidence is not rewritten.

Non-demo contracts can no longer finish Owner signing through the old consent-only `owner-confirmation` endpoint. Owner uses the existing signing endpoints. Legacy demo screens remain separate; the real Step 6 never calls a simulation API.

## Existing endpoints reused

- `GET /api/v1/contracts/signing-methods`
- `GET /api/v1/contracts/{id}/signing/layout`
- `GET /api/v1/contracts/{id}/signing/pages/{page}`
- `POST /api/v1/contracts/{id}/signing`
- `GET /api/v1/contracts/{id}/signing/otp`
- `POST /api/v1/contracts/{id}/signing/otp/confirm`
- `POST /api/v1/contracts/{id}/signing/otp/resend`
- `GET /api/v1/contracts/{id}/signing/upload-source`
- `PUT /api/v1/contracts/{id}/signing/upload` (`application/pdf`, Owner only)
- Existing `signing/sync`, `signing/recover`, signature-image and certificate APIs.
- `GET /api/v1/contracts/{id}/document`
- Existing `internal-signing`, `signing-invitations` and `/api/v1/contract-signing/*` token/session APIs for the representative without an account.

Signing initiation and OTP confirmation retain their existing idempotency keys. Invitation token authentication remains separate from account Bearer authentication.

## Navigation and scope

`ContractSigningStep` is shared by mobile Holding and Main Step 6. It reloads contract/signing status on mount, every five seconds, and on explicit refresh. It rechecks the backend immediately before invoking the existing payment navigation callback. `PendingActivation` is valid after signing; `Active` is not required.

Only Step 6 rendering and its navigation wiring changed. Steps 1–5, payment/completion components, deposit calculation, bank QR, reconciliation, activation and Holding approval rules are unchanged. The existing Holding lifecycle may show its payment screen after the refreshed contract reaches `PendingActivation`.

## Verification

Real ASP.NET API + disposable local PostgreSQL databases and real PDF signing/verifier implementations were exercised. Test notification providers capture synthetic emails; they do not send messages to real people. External PDF tests use synthetic certificates and real cryptographic signatures, not fabricated successful signing outcomes.

- Seven integration tests cover Holding/Main with and without a Tenant account, Owner OTP, representative invitation OTP/drawing, authenticated Tenant OTP, external PDF upload, invalid uploads, invalid/expired OTP, expired/revoked invitations, resend cooldown, unauthorized Staff, replay, preserved PDF bytes, signature integrity, `PendingActivation`, and no automatic activation.
- Thirty-four existing infrastructure signing tests pass.
- Mobile component tests verify backend-confirmed completion for both contract kinds/account cases and reject navigation on network failure; regression tests cover existing draft, progress, payment/completion and legacy demo screens.
- Owner web tests verify the real Owner OTP path for Holding and Main and reject consent-only completion in that path.

Final targeted results: 7 API/PostgreSQL integration tests, 34 signing infrastructure tests, 66 mobile tests and 11 Owner web tests passed. Mobile/Owner web typechecks and linters passed; `git diff --check` passed. The mobile tests exercise the actual Holding and Main wizard navigation into their existing Step 7 for both account cases; API transport is stubbed in component tests and real in the backend integration/SMTP tests.

An additional explicitly authorized live SMTP test passed for Holding and Main, using the recipient supplied by the user at runtime. It sends invitation and Owner OTP emails marked `[TEST BHOME Step 6]`, confirms the codes through the real APIs, verifies the signed PDFs and stops the Main contract at `PendingActivation`. SMTP acceptance is confirmed; inbox/spam arrival is not. The test uses disposable local PostgreSQL and does not activate any real tenancy. The live test is skipped unless both its explicit recipient and disposable test-admin variables are supplied.

Physical-device interaction and real Viettel MySign credentials/approvals remain untested. MySign is optional; OTP does not require a MySign account. The currently running development backend must be restarted to load the changed assemblies.

## Files changed for this integration

- Backend: `ContractWorkflowService.cs`, signing methods in `ContractService.cs`, `AnonymousContractSigningService.cs`.
- Shared client: signing actions in `packages/client-core/src/contracts.ts`, upload-verification wording in `signing.ts`.
- Mobile Step 6: new `ContractSigningStep.tsx`, wiring in `HoldingContractFlow.tsx` and `RentalContractFlow.tsx`, signature-image selection and signed-state presentation in `ContractSigningPanel.tsx` and `SigningSetup.tsx`.
- Owner web: real invitation/Owner signing in `InternalSigningPanel.tsx`, PNG signature upload in `OwnerSigningPanel.tsx`, signing-action wiring in `ContractDetailPanel.tsx`.
- Tests: `contract-signing-step.test.tsx`, Holding/Main flow tests, Owner signing-panel tests, `AnonymousSigningTests.cs`, authenticated OTP/upload API tests, Compact24 regression wrappers, opt-in `LiveStep6SigningTests.cs`.

Other uncommitted changes already present in the workspace are outside this integration.

## Certificate semantics and remaining limits

OTP/drawing with a BHOME PDF seal is electronic acceptance, not the participant's CA-certified personal digital signature. Development seals are self-signed. External upload verification checks issuer-name configuration, validity at signing time, signature integrity and unchanged contract content; it does not validate a full CA trust chain or certificate revocation.

No changes are made to the existing activated-account lifecycle. Existing authenticated Tenant signing remains in place. Existing approved/reviewed PDF sources must be available, email/OTP keys configured, real signing methods enabled, and the contract must not be a demo artifact.
