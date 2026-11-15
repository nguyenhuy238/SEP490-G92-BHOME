# Unified SePay payment verification — 2026-11-15

Source: explicit user approval to exercise the complete payment lifecycle in Sandbox using the same business services as Live, with environment-isolated data and no real transfer. Traceability: BF-06, UC-22/23/25, GBR-10/18, JOB-03; contract lifecycle UC-14/15/16 and DBR-03.

## Root cause and resulting behavior

The public webhook was reachable and returned HTTP 200, but transaction `BH74751109` was durably classified `ManualReview / sepay_environment_mismatch`. The code used `Contract.IsDevelopmentDemo` both for simulated signatures and for payment-environment matching. P.203 had genuine signatures (`IsDevelopmentDemo=false`), while its bank transaction and receiving account belonged to SePay Test.

`Contract.PaymentMode` now records the payment data environment independently of signature simulation. New contracts use the configured SePay environment only for an explicitly bound receiving location and permitted Test deployment; conversions/renewals retain the source payment environment. Older records retain their previous fallback until explicitly bound. Compact24 stores this field in the existing contract JSON state, without a new Test table or a database-column migration. Production signing/contract snapshots and existing PDFs are not rewritten.

The selected P.203 contract in the explicitly configured Neon development database was bound to payment mode Test. No Live bank, payment, contract, or account was modified. The existing Test receipt remains marked Test. There is one reconciliation/allocation path and one payment history, with environment checks on the contract, receiving account, code and receipt.

## APIs and processing

- `GET /api/v1/contracts/{id}/deposit-payment/transfer-instructions`: common scoped Holding QR endpoint for Test or Live. Uses existing deposit totals, receiving accounts, reference registry and VietQR generator. Staff/Owner/Tenant scope is checked through the existing contract service. Approved, intact signed contracts and matching provider/account environment are required.
- `GET /api/v1/contracts/{id}/holding-deposit`: existing payment projection, now polled by Holding Step 7 every five seconds. A completed payment refreshes the parent contract and removes the old payable QR.
- `POST /api/v1/integrations/sepay/webhook`: existing raw-body HMAC authentication, inbox, canonical receipt identity, transaction locks and business reconciliation.
- Existing `sepay_environment_mismatch` events can be re-evaluated after an explicit environment correction. The original receipt is reused. Already allocated receipts become duplicate deliveries; money is not allocated twice. Other review reasons are not blindly reset.
- `GET /api/v1/contracts/{id}/initial-payment` and `POST .../initial-payment/transfer-instructions`: existing Main initial-payment status and total QR. The total is remaining security deposit plus first monthly rent and signed fixed service fees, less amounts already allocated. Per-person fees use the contract's resident count; usage-based charges are not guessed before readings. Signed charge snapshots are preferred over current mutable pricing. Holding credit is already an allocation to the Main deposit and is subtracted once, not twice.
- New Holding conversions request initial-payment collection by default, preserving the existing common Main payment/activation service.

Historical explicit simulation/preview endpoints remain for their earlier fixtures, but the normal Holding payment screen no longer calls a Test-only route. Changing a deployment to Live uses the common endpoint/services with Live configuration and Live data; it does not require another payment implementation.

## Email and onboarding correction

The Main onboarding UI still required an early email despite the earlier backend deferral. Its email field/validation and capture payload were removed. Both onboarding paths create identity records without email. Draft signer validation accepts verified residents without a stored email; the invitation step collects it. The backend still drops draft `TenantEmail` and promotes invitation contacts only during Main activation. Existing account emails are preserved.

## Executed verification

- 33 API/PostgreSQL integration tests passed across SePay, real Holding/Main signing, environment mismatch/recovery, account provisioning, amount/reference matching and duplicate delivery. The final common Holding QR endpoint was then checked again in two focused tests.
- The full genuine-signature Sandbox chain passed on a disposable local database: Holding QR → signed webhook → verified Holding deposit → Owner activation/OnHold → Main conversion/holding-credit allocation → genuine Main signatures → total QR including fixed room/person fees → signed webhook → deposit and rent/fee allocations → existing activation job → Main Active, source Holding Converted, room Occupied and Tenant provisioning.
- Replaying the same event and a new provider event for the same bank reference did not create another allocation. A mismatch-recovery test verified the original receipt identity was retained.
- Example exercised total: security deposit 200,000 minus credited Holding deposit 100,000, plus first rent 3,000,000 and signed fixed fees 160,000 = QR 3,260,000 VND.
- 109 mobile tests passed, including deferred Main onboarding, Main draft review and Holding/Main signing/payment navigation. Owner web signing/release tests and both client typecheck/lint checks were also run.

### Existing Neon Sandbox transaction

The previously received Sandbox payload was replayed through the public HTTPS webhook with the existing HMAC configuration; this was a replay of stored provider data, not a new bank transfer. Both requests returned HTTP 200. The resulting canonical event is Completed, with 3,200,000 VND verified and exactly one allocation. Genuine signatures, signed snapshot and account count were preserved.

Android emulator inspection confirmed the existing P.203 screen now shows “Tiền cọc đã được xác minh” and 3,200,000 VND verified. Its price is locked; contract remains PendingActivation and room Available until the required existing Owner Holding-activation action. This condition is not bypassed or replaced by a payment success flag. The Main full lifecycle was verified in the disposable integration environment; no real tenancy was automatically activated on Neon.

## Changed files

- Domain/persistence: `Contract.cs`, `Compact24DomainModel.cs`.
- Contract environment capture/defaults: `ContractService.cs`, `ContractWorkflowService.cs`, `ContractHoldingService.cs`, `MainDraftService.cs`, `ContractContracts.cs`, `ContractSigningMethods.cs`.
- Payment services: `SePayService.cs`, `SePayRepository.cs`, `MainInitialPayments.cs`, `MainInitialPaymentLedger.cs`, `DepositReceiptAllocation.cs`, `ReceiptExcessRepository.cs`, new `ContractDepositInstructionsService.cs`.
- API/client: `PaymentTransactionsController.cs`, legacy preview response in `SePayHoldingPreviewController.cs`, shared `contracts.ts` and `payments.ts`.
- Mobile: `HoldingContractFlow.tsx`, onboarding people/validation/capture service, Main draft signer/review and corresponding tests.
- Integration tests: `AnonymousSigningTests.cs`, `SePayIntegrationTests.cs`.

No SePay Live setting was enabled. Actual Live provider delivery and a physical-device banking transfer were not performed.

## Final checks and remaining issue

The final SePay integration rerun passed all 19 tests after the manual invoice allocation environment check was updated in `PaymentService.cs`. Owner web tests passed all 18 tests. The final backend build was restarted locally.

The final readiness probe returns HTTP 503 because the Neon function `bhome24_work_order_guard` differs from the repository schema definition. Read-only checks found no missing column definitions, indexes or triggers. This unrelated WorkOrder schema discrepancy was not overwritten and the readiness check was not weakened. Payment webhook reconciliation and the verified deposit UI were checked successfully, but this database readiness issue remains unresolved.
