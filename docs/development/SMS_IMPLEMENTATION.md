# SMS implementation and traceability

## Audit and scope

Baseline: `25fd35e`, branch `member/QHuy`, clean working tree. The current backend uses Compact24 persistence, Identity, user-row locking and refresh-token revocation. Existing email recovery remains compatible. `NotificationChannelWorker` already provides durable channel outbox, leases, recipient scope checks and retries; `CompactNotificationEvents` publishes committed business events. Owner Web and Mobile already have email recovery screens.

Sources: supplied SMS implementation decision (2026-11-13), locally inspected SRS `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, root AGENTS.md. Notifications map to BF-03/04 contracts, BF-05/06 billing/debt, BF-07 emergency, JOB-01/02/04, GBR-01/02/13/18. SRS JOB-02 specifies 30 days. Existing signing is preserved; this change does not approve or replace a signing provider.

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

No schema migration is needed: technical recovery state uses immutable OUTBOX payloads with append-only state history; user-facing INBOX queries cannot expose it. Key rotation invalidates outstanding recovery challenges. Mock Inbox OTPs are short-lived and limited to configured synthetic accounts; it is not a phone verification mechanism for real users.
