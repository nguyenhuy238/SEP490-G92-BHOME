# SMS implementation and traceability

## Audit and scope

Baseline: `25fd35e`, branch `member/QHuy`, clean working tree. The current backend uses Compact24 persistence, Identity, user-row locking and refresh-token revocation. Existing email recovery remains compatible. `NotificationChannelWorker` already provides durable channel outbox, leases, recipient scope checks and retries; `CompactNotificationEvents` publishes committed business events. Owner Web and Mobile already have email recovery screens.

Sources: supplied SMS implementation decision (2026-11-13), locally inspected SRS `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, root AGENTS.md. Notifications map to BF-03/04 contracts, BF-05/06 billing/debt, BF-07 emergency, JOB-01/02/04, GBR-01/02/13/18. SRS JOB-02 specifies 30 days. Existing signing is preserved; this change does not approve or replace a signing provider.

UC trace: signing UC-14/15/16; expiry UC-19; finalized invoices UC-21 (DBR-06/07 remain unchanged); debt UC-23; incident submission/emergency UC-26/27. SMS password recovery and the isolated demo inbox are the explicit 2026-11-13 change request under authentication/privacy NFRs and GBR-01/02/13/18; no new SRS UC identifier is invented.

| Behavior           | Components                                                        | Acceptance                                                                                      |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Multi-mode gateway | `SmsGateway`, `EsmsSmsSender`, `MockSmsSender`, template registry | Mapping, rejections, timeout, production opt-in, no real SMS in tests                           |
| Critical alerts    | Existing notification publisher/channel worker                    | Correct event/role/scope, current debt, no draft invitation, deduplication and retry            |
| SMS recovery       | Identity + locked per-user recovery state                         | Verified phone, generic request, keyed OTP hash, limits, replay/concurrency, session revocation |
| Demo               | Bounded ephemeral inbox and designated synthetic accounts         | Authorization, recipient isolation, expiry and Production denial                                |

Phone confirmation exists, but the repository has no ownership-verification workflow. SMS recovery must fail closed for unverified phones. Synthetic demo seeding is not verification of any real user's phone. Recovery state may require an additive EF migration; delivery reuses `notifications` rather than a new parallel notification database.

## Provider contract

Verified 2026-11-13 against [eSMS SMS API](https://developers.esms.vn/esms-api/ham-gui-tin/tin-nhan-sms-otp-cskh), [Sandbox](https://developers.esms.vn/esms-api/moi-truong-test-sandbox), and [callback documentation](https://developers.esms.vn/esms-api/callback-url).

POST JSON to `SendMultipleMessage_V4_post_json/`, CSKH `SmsType=2`. Sandbox uses the documented sandbox content and `Baotrixemay`, never custom BHOME production branding. `RequestId` is limited to 50 characters and deduplicated by eSMS for 24 hours. Code 100 means acceptance only. A duplicate response or timeout is an unknown outcome, requiring review rather than blind retries. No credentials, raw provider bodies, OTPs or complete phone numbers are logged.

Orbit lookup did not find eSMS-specific endpoints; the official provider contract is used. Postman CLI is available but signed out, so owner/workspace discovery is unavailable. Automated provider checks use synthetic credentials and simulated HTTP responses; live evidence is reported separately.

## Configuration

Use `Sms__ApiKey` and `Sms__SecretKey` environment variables or the existing .NET User Secrets ID `bhome-api-development`. Never put credentials into tracked files. Defaults disable delivery. Mock additionally requires an isolated Development/Demo environment and explicit synthetic recipient mapping. Production requires `ProductionEnabled`, an approved Brandname and per-template approval. No automatic fallback to Mock.

The gateway uses proposed ASCII templates SMS-01 through SMS-06. The 459-character application limit is conservative and does not predict provider segmentation or billing. Dynamic text is bounded and normalized. Register the exact template content with eSMS before enabling Production.

## Business delivery

SMS extends the existing channel outbox. Eligible current users require a confirmed mobile number. A stable event/normalized-phone key deduplicates shared contacts; the provider RequestId stays unchanged on retries. Sender timeouts/duplicate responses enter PendingReview; permanent provider rejections do not retry. Retry attempts are bounded by the existing channel policy and stop before the provider's 24-hour deduplication limit.

Signing alerts consume `InternalSigningInvitationApproved` or `ContractSigningRequested`; draft/preparation notices do not qualify. No signing tokens enter SMS. Invoice delivery rechecks Final status and snapshot recipient entitlement; debt additionally rechecks due date and outstanding amount. Expiry is representative-Tenant-only, within 30 days. Emergency uses existing Owner/assigned-Staff routing. In-app/email/push remain independent.

The eSMS GET callback `/api/v1/sms/esms/callback` accepts production reports only from the three IPs in the verified provider documentation, with matching RequestId, provider reference and single-recipient counts. Proxy deployments must preserve the actual remote source using explicitly trusted proxy configuration; never trust arbitrary forwarded headers. Terminal reports are idempotent. Accepted/SandboxAccepted/Simulated are distinct from Delivered. Configure ingress access logging to omit callback query strings (provider callbacks can include a recipient phone).

Live Sandbox request checked 2026-11-13: documented `Sandbox=1` returned CodeResult 100. This is provider acceptance, without physical delivery. Credentials were loaded from User Secrets and no raw request/response was logged. Production is disabled; Brandname/template approval and physical delivery remain unverified.

## SMS password recovery

Existing email endpoints remain unchanged. Anonymous, no-store endpoints:

- `POST /api/v1/auth/sms-recovery/request`: `{identifier}` → generic 202 `{challengeId,retryAfterSeconds,expiresInSeconds}`.
- `POST /api/v1/auth/sms-recovery/verify`: `{identifier,challengeId,otp}` → short-lived `{authorization,expiresInSeconds}` or generic 400.
- `POST /api/v1/auth/sms-recovery/reset`: `{identifier,challengeId,authorization,newPassword,confirmPassword}` → 204 or generic 400.

Only active eligible Owner/Staff/Tenant accounts with previously confirmed Vietnamese mobile numbers qualify. Ambiguous identifiers, pending account setup, unverified/missing phones and unsupported second-factor accounts fail closed. Sandbox end-user recovery returns 503 for every identifier because Sandbox does not deliver OTPs.

HMAC-SHA256 uses a separate base64 `SmsRecovery__HashKey` of at least 32 random bytes. OTPs are bound to account/challenge/purpose; recovery grants are random 256-bit single-use values stored as HMACs. Identity security stamp and confirmed phone are rechecked at verification/reset. Defaults: five minutes, five guesses, 60-second resend cooldown. Distributed account/phone/IP request limits use hashed metadata, a PostgreSQL advisory lock and the existing audit container. The existing Auth IP limiter also covers verify/reset.

Delivery is asynchronous through the existing durable job queue: the transient delivery envelope is protected by ASP.NET Data Protection, while the challenge stores only a keyed OTP hash. Persist/protect the production Data Protection key ring using the existing deployment mechanism. No plaintext OTP or reset authorization enters durable notification records, jobs or logs. Delivery failure does not reveal account existence. The same user-row lock as session rotation serializes verification and reset across API instances; a successful reset uses Identity, consumes recovery grants and revokes sessions without changing roles/assignments/contracts.

OTP delivery retries definite transient rejections through the existing bounded job backoff, preserving the same protected payload and RequestId, and rechecking challenge expiry before each submission. Unknown submission enters PendingReview and is never automatically resubmitted; a user who actually received the code can still prove possession using normal OTP verification. Resend supersedes the previous challenge.

No schema migration is needed: technical recovery state uses immutable OUTBOX payloads with append-only state history; user-facing INBOX queries cannot expose it. Key rotation invalidates outstanding recovery challenges. Mock Inbox OTPs are short-lived and limited to configured synthetic accounts; it is not a phone verification mechanism for real users.

## Isolated demo

Run from PowerShell in the repository. `Start-SmsDemo.ps1` requires a loopback PostgreSQL admin connection with `Database=postgres`, supplied through `BHOME_COMPACT24_TEST_ADMIN` or its `-AdminConnection` parameter. Do not paste the connection string into a tracked file or shell transcript.

```powershell
./scripts/Start-SmsDemo.ps1 -Action Initialize
# Separate terminals:
./scripts/Start-SmsDemo.ps1 -Action Backend
./scripts/Start-SmsDemo.ps1 -Action Web
./scripts/Start-SmsDemo.ps1 -Action Mobile
```

Initialization creates a separate `bhome_compact24_dev_<random>` database using the existing reviewed schema initializer, then seeds Owner/Staff/Tenant identities ending in `@sms-demo.example.invalid`. Only these synthetic users are marked phone-confirmed. Existing data/passwords are preserved. Private configuration and initial synthetic credentials live under ignored `.tmp/sms-demo/`; they never enter Git. This does not change or verify any real account phone. Seeded business data is not fabricated: create/complete ordinary business workflows through the existing BHOME APIs/UI.

Owner Web: `http://localhost:5178`, backend: `http://127.0.0.1:5288`. All inherited backend endpoint definitions are rebound to loopback. Demo credentials: `.tmp/sms-demo/ACCOUNTS.txt`. Browser acceptance resets the demo Owner's actual password; its current value is stored privately in `.tmp/sms-demo/OWNER_CURRENT_PASSWORD.txt` when that acceptance is executed.

With backend and Web running, execute `node scripts/Test-SmsRecoveryDemo.mjs` for browser acceptance. It uses only the isolated Owner demo identity, reads the OTP through the authenticated Inbox, resets its actual password, checks new login/old-password rejection and updates the private account handoff. Configure `BHOME_TEST_BROWSER` if the default Windows Edge executable is unavailable. No credentials or OTPs are printed.

Open Web Notifications → **Hộp thư SMS Demo**, or `/demo/sms`. Mobile Notifications exposes the same protected inbox when `__DEV__` and `EXPO_PUBLIC_SMS_DEMO_ENABLED=true`. Owner Web requires `import.meta.env.DEV` and `VITE_SMS_DEMO_ENABLED=true`. Production builds cannot open these demo paths; the backend independently returns 404 outside isolated Mock mode. No public endpoint returns demo OTPs.

`GET /api/v1/demo/sms?recipient=<demo-user-id>&template=SMS-01` and `GET /api/v1/demo/sms/{id}` require authenticated, explicitly mapped synthetic identities. Owner may inspect mapped demo recipients; Staff/Tenant see their own messages only. Phones are masked. OTP content expires with the challenge, ordinary messages after at most 15 minutes; a background sweep removes expired content even without reads. The store is bounded, in-memory and cleared on restart. Mock delivery refuses databases containing non-synthetic email domains. No real OTP is copied to this inbox.

## Provider probe and local HTTP simulation

The explicit CLI command `dotnet run --project tools/BHome.LocalDevelopment -c Release -- test-sms-provider` uses the same gateway/HttpClientFactory adapter as the API. Configure `Sms__Enabled=true`, mode, credentials, `Sms__EnabledTemplates__0=SMS-03` and `BHOME_SMS_TEST_PHONE` privately. Sandbox uses only the documented test sender/content. Production additionally requires `Sms__ProductionEnabled=true`, `Sms__Brandname`, `Sms__ApprovedTemplates__0=SMS-03`, `Sms__LiveTestEnabled=true` and **explicit** `BHOME_SMS_CONFIRM_LIVE=true`; execute only after the user authorizes that exact live test number. Never put these switches into normal CI. The proposed test message uses room `BHOME-TEST` and current month; the exact template must already be approved.

For an offline HTTP check, run `postman simulation run postman/simulations/esms/esms.sim.yaml --port 4510 --no-history --output ndjson`. Configure synthetic credentials (`synthetic-api` / `synthetic-secret`), Sandbox mode and `BHOME_SMS_SIMULATION_URL=http://127.0.0.1:4510/esms/`, then run the CLI probe. This optional tooling-only transport override refuses real credentials/non-loopback targets and is never registered in the API. The gateway itself still validates the official HTTPS endpoint. The stand-in validates exact documented request fields; successful caller output and its request log establish real HTTP serialization, not mobile-network delivery.

`esms-unavailable.sim.yaml` injects HTTP 503. Stop/restart the simulation to change scenarios. Automated xUnit tests cover transient/permanent errors, timeouts, malformed responses and stable deduplication without external credentials. CLI simulation requires Postman locally; normal CI remains independent of it.
