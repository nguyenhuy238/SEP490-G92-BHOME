# Account invitation and password setup

## Scope and cause

Approved request: complete invitation acceptance, password setup and password visibility without changing account roles, assignment rules, invitation issuance/resend or password policy. Identity/account provisioning requirements are mapped to the existing account-invitation, credential-reset and session-revocation services.

Previously, Web copied `userName` from the URL into its email field and treated the presence of link fields as validation. It displayed manual email/token inputs when the link was missing. Mobile always displayed editable email/token fields. The backend verified a one-time invitation but selected its candidate user from the client-supplied username. Acceptance itself already used a user-row lock and a transaction. Web invitation inputs had no visibility buttons; Reset/Change confirmation fields shared another field's visibility state.

## Resulting flow

1. Owner issues/resends the existing Staff or eligible Tenant invitation. Existing encrypted email outbox and one-time grant mechanisms are retained.
2. Email opens `/accept-invitation#userName=...&token=...` (native alternative remains `bhome://accept-invitation?...`). Existing links remain compatible; a token-only link is also supported.
3. The page captures link credentials in component memory, removes them from the address/router parameters, and POSTs only the token to `/api/v1/auth/accept-invitation/validate`.
4. Backend resolves the user by the stored token hash, locks and validates the grant, purpose-bound Identity token, active account, expiry, consumption and security stamp. Only a valid invitation returns its email. Invalid states return no email and render no setup form.
5. The recipient sees a read-only verified email and enters password/confirmation. Each password has an independent visibility button. Field errors, loading and duplicate-submit prevention are provided.
6. Web/native submit only token and password to the existing `/api/v1/auth/accept-invitation`. The backend determines the account by token. Legacy usernames are accepted only if they match that token's account; they never select another account.
7. Success replaces the setup route with login. Web login shows a setup-success notice. Tenant/Staff sign into the mobile application under their existing role; the Owner portal's role restriction is unchanged.

Invalid, expired, consumed, inactive/revoked, already-activated and connection-error states have Vietnamese messages. Connection errors permit retry using the token retained in memory. Superseded invitations whose hash has been replaced return Invalid; no historical token store was added simply to classify them as Revoked. Reopening a scrubbed URL after a full browser reload requires opening the original email link again; tokens are deliberately not saved in browser storage.

## Security and email URLs

- Existing password hashing, security-stamp checks, session revocation and grant consumption remain inside the transaction. Concurrent acceptance is serialized with the existing user-row lock; exactly one request succeeds.
- Weak password rejection does not consume the grant. Account roles, resident links and location assignments are never taken from acceptance request fields. Request fields attempting to supply Owner role/location are ignored and the stored role is preserved.
- Validation is POST, bounded to 4096 token characters, rate-limited under the existing Auth policy and returned with the controller's no-store policy. No token or password logging was added; no localStorage/sessionStorage persistence is used.
- Web credentials remain in the email URL fragment and are scrubbed after capture. A global no-referrer meta policy was added. Legacy query links are accepted and scrubbed, but newly generated Web emails continue using fragments.
- Existing trusted-origin allowlisting remains. Production now also rejects HTTPS loopback URLs, preventing a configured `https://localhost` invitation link from being delivered. Development permits explicitly trusted loopback addresses.
- Dev `WebInvitationUrl` now uses `https://assume-vol-travels-benjamin.trycloudflare.com/accept-invitation`, with its origin added to the dev allowlist. User-secrets and ignored `.env` files were updated; no credentials are included in source. Old delivered emails are immutable. A new Quick Tunnel hostname requires updating this configuration again.
- No database migration or additional invitation table is needed.

## Changed files

Backend:
- `BHome.Application/IdentityAccess/IAccountInvitations.cs`: bounded validation request/result; optional legacy username; validation interface method.
- `BHome.Infrastructure/IdentityAccess/AccountInvitations.cs`: token-based user resolution, preview validation, retained atomic acceptance.
- `BHome.Infrastructure/IdentityAccess/AuthenticationEmailOptions.cs`: reject production loopback callbacks.
- `BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs`: anonymous rate-limited POST validation route under existing no-store controller.

Shared client: `packages/client-core/src/internalSigning.ts` adds validation and allows token-only acceptance while retaining old client compatibility.

Owner web:
- `features/auth/pages/AcceptInvitationPage.tsx` and its test: automatic validation, read-only email, error states, password controls and redirect.
- New `features/auth/components/PasswordField.tsx`; reused in Reset/Change confirmation fields.
- `LoginForm.tsx`, `ResetPasswordPage.tsx`, `ChangePasswordDialog.tsx`: independent confirmation visibility and preserving mouse focus.
- `LoginPage.tsx`: successful invitation notice. `index.html`: no-referrer.

Mobile:
- `screens/AcceptInvitationScreen.tsx`: same validation/acceptance API and token scrubbing; no editable email/manual token.
- New `components/PasswordField.tsx`, reused in `PasswordRecoveryScreen.tsx`; existing login/change screens already had visibility controls. Login gains explicit accessible visibility labels.
- `password-recovery.test.tsx`, `anonymous-onboarding.test.tsx`, new `password-field.test.tsx`.

Backend tests: `tests/backend/BHome.IntegrationTests/Compact24/AuthenticationEmailTests.cs`.

## Verification actually executed

- 31 Owner web tests passed across Accept Invitation, Login, Reset Password and Change Password. Coverage includes URL scrubbing with retained token, ignoring untrusted URL email, token-only/legacy query links, read-only email, absent/duplicate/invalid/expired/used/revoked/already-active tokens, validation retry, independent visibility, preserved value/focus, password/mismatch errors and single acceptance submit.
- 14 mobile tests passed across recovery/anonymous onboarding and native password-field controls. Mobile typecheck and lint passed.
- 10 ASP.NET/PostgreSQL integration tests passed (9 authentication-email regressions plus 1 additional Tenant acceptance/login case). Owner invitation -> durable email generation -> captured test email link -> validation -> token-only acceptance -> login is tested for Staff/Tenant. Tests verify expiry, invalid/replaced/revoked grants, wrong username, weak-password rollback, duplicate consumption, concurrent acceptance, role/location tampering and scoped access. This uses disposable PostgreSQL and a captured test email provider; it is not a real Gmail mailbox delivery test.
- The AccountProvisioning unit suite ran: 15/18 passed, including all four AcceptAsync cases (valid, weak password, consumed and expired). Three failures concern unchanged CreateStaff/UpdateStaff/invite-creation behavior: UTC03 expects rejection of an 11-character Staff creation credential; UTC09 expects `reason_required` but receives `invalid_operations_input`; UTC12 expects a pending Tenant's `IsActive` to be false while current issuance sets it true and blocks login through unconfirmed setup. These behaviors were not changed to make the suite green.
- Headless Chrome checked the actual Vite page at 1280x850 and 390x844: verified-email read-only, hidden/default independent password toggles, address scrubbing, no horizontal overflow and one acceptance followed by login navigation. This visual/browser check used synthetic API fixtures, not a live account token. Screenshots: `.tmp/account-invitation-desktop.png`, `.tmp/account-invitation-mobile.png`.
- Backend Debug build succeeded through integration/unit test compilation. Runtime restarted with this build. Readiness returned HTTP 200, and an invalid-token POST returned `{ status: "Invalid", email: null }`.
- Public verification initially found HTTP 502 because the signing/account Cloudflare tunnel targeted port 5174 while the only running Vite server was on 5173. The frontend was restarted on 5174 to preserve the existing Cloudflare hostname and issued email links. After recovery, the public account page and validation POST returned HTTP 200; validation returned `Cache-Control: no-store,no-cache`.
- Owner web typecheck and full `npm run build` remain blocked at unchanged `src/features/incidents/IncidentWorkspace.tsx:788`: undefined `IncidentEvidencePreview`. Owner web lint reports that same existing undefined-component warning; no auth warnings remain.
- Prettier was applied to changed client files, and `git diff --check` passed.

Artifacts: `.tmp/account-invitation-tests/account-invitation-final.trx`, `account-tenant.trx`, `account-provisioning.trx`; `.tmp/account-invitation-*.log`; browser script `.tmp/account-invitation-browser.cjs`.

Not executed: production deployment, actual Gmail invitation acceptance, native device keyboard/eye interaction on a physical phone, or a full browser-to-live-email-to-production-database test. No real account was activated or password changed for this verification. Full CI cannot be claimed green because of the listed web build and unit-suite failures.
