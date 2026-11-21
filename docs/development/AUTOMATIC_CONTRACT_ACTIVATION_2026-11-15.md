# Automatic Holding and Main activation

## Approved scope

The user's explicit decision on 2026-11-15 replaces the earlier requirement for an Owner activation click after signing. Applies to newly created Holding and Main contracts, including Main converted from Holding. Creation, Owner approval of Holding, signatures/PDF evidence, payment calculations, reconciliation and renewal/amendment workflows retain their existing rules. Traceability: contract signing/activation (UC-15 / GBR-04), payment-confirmed occupancy, existing contract lifecycle and room-transition invariants.

## Implementation

- Reuse the existing durable `activate-paid-main-contract` job and stable per-contract key for Holding and Main. The persisted job name is retained for compatibility.
- The common scheduler probes existing activation readiness before enqueueing. It runs through the existing scheduler contributor and the existing automation worker, including when SePay ingestion is disabled. Thus manual verified bank receipts also use the same activation rules.
- Main initial-payment allocation no longer queues activation prematurely; the common scheduler waits for all prerequisites, including effective date. It uses the existing initial-payment ledger to check required deposit, first rent and charges.
- The worker acquires the existing payment-ledger, Location and Room locks and reloads contract state. Holding uses the same extracted readiness/evidence/room-transition implementation as the retained compatibility command. Main uses its existing activation service.
- Both signatures must match the signed snapshot, and stored PDF evidence bytes are reverified. Holding approval, exact verified deposit, price lock, expiry, room conditions and conflicts still apply. Main retains required initial-payment, identity, signed terms, effective-period, occupancy and account-provisioning checks.
- Holding becomes Active and Room OnHold. Main becomes Active and Room Occupied; source Holding becomes Converted and existing Tenant provisioning runs. Automatic audit entries distinguish system activation from a manual Owner command; the approved Owner remains the existing lifecycle reference.
- An already Active contract returns without changing activation timestamp, room version, provisioning or audit. Webhook receipt/allocation deduplication is unchanged.
- Shared actions no longer expose manual activation for Main/Holding. Mobile and Owner web refresh backend state every five seconds. Waiting messages describe automatic processing. Renewal/amendment commands remain unchanged. Existing HTTP commands are retained for compatibility, but neither normal flow requires them.

## Files

Backend: `ContractService.cs`, `ContractHoldingService.cs`, `MainContractActivationJob.cs`, `MainInitialPaymentLedger.cs`, `SePayAutomationWorker.cs`, `DependencyInjection.cs`.

Clients: shared `contracts.ts`; mobile `HoldingContractFlow.tsx`, `RentalContractFlow.tsx`, `ContractScreen.tsx`; Owner web `ContractDetailPanel.tsx`, `pages/AnonymousSigningPage.tsx`. Corresponding contract action/navigation tests were updated.

Tests: `AnonymousSigningTests.cs`, `ContractOtpSigningApiTests.cs`, mobile holding/rental/contract-section tests and Owner web `Contracts.test.tsx`.

## Executed verification

- 28 ASP.NET/PostgreSQL integration tests passed across anonymous signing and SePay reconciliation. Full signed Holding -> QR -> authenticated webhook -> automatic activation -> Main conversion -> full initial payment -> automatic activation was exercised. Repeated callback and scheduler delivery preserved one allocation and stable activation/room state.
- 6 real PDF signing regression tests passed for registered Tenant accounts (Owner session, emailed OTP and external signed PDF coverage). Updated OTP/session cases check incomplete signatures, missing payment, automatic activation and repeated execution for Holding/Main.
- 68 mobile tests passed; mobile typecheck/lint passed.
- 15 Owner web contract tests passed. Owner web lint reported an unrelated undefined component, and typecheck failed at `src/features/incidents/IncidentWorkspace.tsx:788`: `IncidentEvidencePreview` is undefined. This file was not changed for activation.
- Tests use disposable loopback PostgreSQL databases and captured test email; no real transfer or SePay Live switch was performed.

Artifacts: `.tmp/automatic-activation-tests/automatic-activation.trx`, `automatic-registered.trx`, and `.tmp/automatic-activation-build.log`.

## Development runtime

The final Release backend build passed with zero warnings/errors and was started on the existing development ports. Readiness returned HTTP 200. The existing paid P.201 Holding (`9674a03e-8553-4192-b473-b554cd92f1ce`) transitioned from PendingActivation to Active through the durable job (attempt 1), without an Owner activation request. Existing incomplete-signature contracts remained PendingSigning. No new bank transaction was generated for this verification. Main activation was verified on disposable test databases, not by creating a new tenancy in Neon.

The Android emulator's existing P.201 screen automatically refreshed to “Giữ chỗ thành công” / “Đã giữ phòng”; this UI requires both contract Active and room OnHold. The UI hierarchy is saved in `.tmp/automatic-activation-ui.xml`.
