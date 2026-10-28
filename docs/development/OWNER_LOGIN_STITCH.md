# Owner login — Stitch 01_login

> Historical login-only handoff. The later all-screen implementation adds demo authentication,
> protected routes and Dashboard navigation without redesigning the form. See OWNER_PORTAL_STITCH.md
> and the current Owner Web README for runtime behavior and configuration.

Scope: only the Owner login screen at `/login` in `src/owner-web`.
Public Web and other Stitch screens are unchanged. Owner Web was a Vite starter with no existing
shell, router, theme or feature components. The new theme follows the Owner Stitch tokens.

## Traceability and acceptance

Reference: `stitch_bhome_owner_web_portal/stitch_bhome_owner_web_portal/01_login/{screen.png,code.html}`
in the parent workspace. Requirement mapping uses repository `AGENTS.md` sections 4, 7, 11:
GBR-01/02 access control; identity/session authentication; Vietnamese, responsive NFRs.
No additional UC number is inferred. The original report DOCX files were not independently verified
for this UI slice. Actual auth contracts were checked against `docs/api/API_CONVENTIONS.md`,
`AuthController.cs`, and the shared `SessionClient`.

- Empty required inputs do not submit. Password supports visibility toggle and is cleared after an attempt.
- Pending requests disable inputs and prevent repeat submissions; failures show a generic error.
- A valid Owner session displays success; no unfinished dashboard is created or linked.
- A non-Owner login is rejected and logout is attempted. This is a UI guard; the server remains
  responsible for authorization of every future protected resource.
- Shared AuthProvider/SessionClient handle existing JWT, refresh cookie and logout behavior;
  tokens/passwords are never persisted by this screen.
- Password recovery uses the existing endpoint in a dialog on the same screen and reports failures.
- Test normal, pending, invalid/failed, non-Owner, and reset-unavailable paths.

## Confirmed contracts and remaining integration

There is no checked-in OpenAPI JSON/YAML. No new backend DTOs or endpoints were invented.
The shared Session model/SessionClient reuse existing response properties and request bodies:
POST `/api/v1/auth/login` `{userName,password}`, POST `/api/v1/auth/refresh` `{}`,
POST `/api/v1/auth/logout`, POST `/api/v1/auth/forgot-password` `{userName}`.

- Backend currently uses Identity UserName, not a confirmed email/phone lookup. Preserve the Stitch
  label but explain that the issued username must be used. Final email/phone mapping requires a contract.
- Remember-login preference is unsupported by the API: checkbox is disabled with an explanation.
  The server controls cookie/session duration; no fake local credential persistence.
- Reset delivery adapter is currently unavailable (503). The dialog never simulates email delivery.
  A full reset-token/new-password screen is outside this screen's scope.
- Set `VITE_API_BASE_URL` in `.env.local` (required for production builds). Use HTTPS and configure
  `AuthWeb:AllowedOrigins` and CORS for the exact Owner frontend origin, with same-site deployment.
  The default Vite HTTP dev URL alone is not sufficient for Secure refresh cookies.
- `VITE_SUPPORT_PHONE` must be an approved real contact; the exported sample number/24/7 SLA is not asserted.
- Stitch's AES password claim and anomaly-detection claim are replaced with wording supported by
  the actual password hashing/session implementation. No cryptography changes.
- Inter uses Google Fonts with Roboto/Arial fallback. MUI X is already installed; the login screen
  has no grid/date controls requiring MUI X widgets.
- Authentication success stays on this screen until a separately implemented Owner route exists.
  No backend schema, migration, business mutations or mock authentication were added.

## Files and verification

Created under `src/owner-web/`:

- `src/features/auth/pages/LoginPage.tsx`: responsive Stitch composition, recovery dialog, success state.
- `src/features/auth/components/LoginForm.tsx`: reusable presentation form and password visibility.
- `src/features/auth/hooks/useOwnerLogin.ts`: shared-client orchestration and error handling.
- `src/features/auth/pages/LoginPage.test.tsx`: nine isolated tests using synthetic responses.
- `src/theme/theme.ts`: Owner design tokens and Vietnamese MUI locale.
- `vitest.config.ts`: scoped test runner using existing frontend test setup.
- `.env.example`: API origin and optional approved support phone configuration.

Modified `src/owner-web/src/App.tsx` (provider/router composition), `src/owner-web/src/index.css`
(remove starter page constraints), `src/owner-web/index.html` (Vietnamese metadata/Inter),
`src/owner-web/package.json` and root `package-lock.json` (test dependencies and scripts),
`src/owner-web/tsconfig.app.json` (allow shared client's existing constructor parameter properties).
This document is also new. Existing Public Web, shared client implementation and backend are unchanged.

Executed from repository root:

- `npm.cmd run test --workspace owner-web`: PASS, 9/9 tests.
- `npm.cmd run typecheck --workspace owner-web`: PASS.
- `npm.cmd run lint --workspace owner-web`: PASS.
- `npm.cmd run build --workspace owner-web`: PASS; Vite warns about the 548.20 kB JS chunk
  (173.88 kB gzip). Bundle splitting remains a future optimization as more screens are added.
- `git diff --check`: PASS.

Verification used the available Node 24.22.1; package engines request Node 22. Repeat in CI's
supported Node version before release. No live API login, real email delivery, cookie/origin
integration or visual browser comparison was verified. Browser automation reported no available
browsers. Layout was implemented against the exported HTML tokens and the supplied reference image.
Old repository-wide frontend tests reference missing prior app paths; the new Owner test script
intentionally scopes to this screen. Repository-wide tests/builds were not claimed as passing.
