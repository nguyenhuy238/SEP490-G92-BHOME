# Tenant Invoice Detail — redesign 11/11/2026

Scope: the user's attached redesign specification, BF-05/UC-20..24, invoice/payment/adjustment API contracts and existing Mobile theme. UI hierarchy and navigation only; no backend, schema, calculation, authorization, reconciliation or seeded-data change.

## Screen hierarchy

- Invoice detail keeps the existing BHOME header and fixed bottom navigation. A compact summary shows room/period, separate issuance/payment labels, one outstanding-amount emphasis, due date and a backend-derived overdue warning. Drafts show a provisional total and never request payment instructions. If payment state fails to load, the summary shows the invoice total with its proper label, without inventing a zero balance or unpaid status.
- Charges use compact rows, aligned amounts and theme dividers. Rows can still disclose original names, confirmed electricity/water readings, authoritative usage, prices, day counts, policy/version and correction information. The issued total remains separate from adjusted payable amounts.
- Payment details are collapsed by default. Expansion retains original issued amount, signed approved adjustments, effective payable, paid/outstanding amounts, excess requiring review and verified payment history. All monetary strings pass through the existing exact formatters.
- The main adjustment section reads only request count/latest status and provides history/new-request navigation. Existing Tenant role checks and server request validation remain in force for both Draft and Final invoices. No new client-side eligibility policy was invented.

## Existing route reuse

- `invoice` with `invoiceId` opens the main detail.
- `invoice` with `invoiceId` and `view=payment` opens the dedicated payment view. Bank data and QR come exclusively from the existing transfer-instructions API. No bank-name lookup, replacement QR, account-number transformation or transfer-reference change was added.
- `adjustment` with `invoiceId` opens the existing request/effect/detail panel on a secondary screen. `newRequest=true` opens the existing request form. Existing `focus=adjustment` entry points also select adjustment presentation.
- Stack back returns to the existing invoice/list and its filters; a direct-link fallback opens the referenced invoice. No sensitive financial fields are placed in navigation parameters.

The QR view has adjacent 44 px copy controls for exact amount, account number and transfer description, a centered server QR with white padding, the demo warning and the reconciliation notice. It does not render mismatched instructions or instructions after payment becomes settled. The existing 30-second payment refresh and foreground checks remain; instruction refresh stops when the screen loses focus.

Only `colors` theme tokens are used for this invoice view: navy/blue for actions/information, green for Paid, red for overdue/errors/rejections, amber for pending/review, neutral for unknown/issuance labels. Cards have subtle borders and 12 px corners. There are no added vertical scroll containers, gradients, decorative assets or dependencies.

## Verification

- Full Mobile tests under the bundled supported Node 22 runtime: 74 test files, 912 tests passed. Covers main-detail lazy loading, status separation, large amounts, read-only navigation, exact clipboard values, payment settlement hiding QR, mismatched transfer suppression, adjustments, excess without fabricated refund success, back navigation and API access errors.
- TypeScript and Mobile ESLint checks passed. Expo web export passed, output in ignored `.tools/tenant-invoice-redesign-web`.
- Browser/native preview access was unavailable (browser host/native pipe unavailable). No visual or physical-device acceptance at 360–400 px is claimed.

Primary files: `TenantInvoicesScreen.tsx`, `TenantInvoiceCharges.tsx`, `TenantPaymentPanel.tsx`, `TenantAdjustmentPanel.tsx`, `InvoiceDetailUi.tsx`, `features/tenant/useTenantInvoicePayment.ts`. Existing invoice regression tests were updated for the new navigation hierarchy; unrelated screens and backend were not edited.
