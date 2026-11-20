# Main signing invitation correction on Mobile

## Problem

The shared signing screen exposed pending invitation email correction only for Holding. Main contracts could have a live invitation for an earlier email while Staff needed to correct the recipient. An attempted fresh invitation with different contact information is correctly rejected as `signing_invitation_already_active`, but the shared error formatter displayed the generic HTTP 409 message suggesting a changed document.

Read-only local diagnosis of P.102 found its snapshot intact, its Owner signature signed against the current snapshot, no Tenant acceptance, a live OTP-verified invitation with an expired session, valid agreed charges and no competing binding contracts. The diagnostic used a read-only transaction and did not print tokens, identity data or document contents. No signing evidence or invitations were changed for diagnosis.

## Change

- `ContractSigningStep.tsx`: expose the existing email correction/resend controls for both Holding and Main. Keep the existing explicit `resend: true` operation, server status refresh, duplicate submission lock and resend cooldown. An expired/revoked invitation still follows the fresh-invitation flow.
- `internalSigning.ts`: explain an existing active invitation specifically and direct Staff to refresh and use resend to change its recipient.
- `contract-signing-step.test.tsx`: extend resend/correction coverage to Main with Owner already signed, and duplicate email feedback to Main resend.

No backend rules, database values, account activation rules or signed PDF bytes changed. The existing backend resend preserves the reviewed PDF, replaces the invitation token/OTP/session and promotes the email to the resident only after completed OTP-verified signing. No real email was sent during verification.

## Verification

- 45 Mobile signing tests passed across `contract-signing-step` and `holding-signing-flow`.
- Mobile TypeScript check and focused ESLint passed.
- UI detector reported no findings.
- Metro returned HTTP 200 for the updated Mobile bundle; API restart was unnecessary.
