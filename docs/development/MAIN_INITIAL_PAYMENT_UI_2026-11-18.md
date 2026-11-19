# Main initial-payment screen aligned with Holding QR

## Scope

User requested that the Main initial-payment UI follow the existing Holding payment/QR screen. No backend/payment/account rules or database changes.

## Changes

- `src/mobile/src/features/contracts/MainInitialPaymentCard.tsx` reuses `HoldingSectionCard`, `HoldingStatusBadge` and `HoldingInfoRow`.
- Display outstanding amount prominently and show the applied holding credit separately. Deposit, charge lines and verified amounts remain available under an accessible expand/collapse control.
- Use a separate transfer card with the existing Holding-style QR frame, aligned bank/account/amount rows, selectable transfer reference and QR reload action.
- Display Test mode as a warning badge and contextual note; reserve red alerts for actual errors.
- Reuse `ContractLoading` for initial loading; preserve signing/account eligibility, submission lock, server polling, stale-amount QR hiding and backend-only paid confirmation.
- `src/mobile/src/__tests__/main-initial-payment.test.tsx` adapts to the grouped layout and verifies that detailed charges remain available on expansion.

## Validation

- 19 tests passed: `main-initial-payment` and `rental-contract-flow`.
- Mobile TypeScript check and focused ESLint passed; UI detector reported no findings.
- Browser visual check of the actual React Native components via React Native Web at 360 and 430 px, using the app's Inter font files and synthetic in-memory payment responses. Initial, generated QR, expanded details and paid states captured in ignored `.tools/main-payment-ui/`; no horizontal overflow at either width. The preview harness substitutes only safe-area/Expo icon plumbing, not the payment UI.
- Native emulator was already displaying an activated contract, so no real contract state was changed to return it to payment for visual QA.
- Metro served the updated bundle with HTTP 200. No real payment, activation or email was performed during checks.
