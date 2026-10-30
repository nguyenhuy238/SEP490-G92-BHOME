# API conventions

Use HTTPS, REST, JSON and `/api/v1/<resource>` routes. `GET /api/v1/session` is an authenticated
foundation probe returning a minimal `userId` DTO. `POST /api/v1/auth/login` verifies existing Identity
accounts. `/health/live`, `/health/ready` and development Swagger are operational exceptions to the
prefix. Readiness requires connectivity and no pending EF migrations. Business endpoints are added
from finalized requirements.

## Existing-account login

`POST /api/v1/auth/login` allows anonymous JSON requests with required `email` (maximum 256
characters, email format) and `password` (maximum 1024 characters). Email-only login was approved
on 28 October 2026 (FE-02 / UC-01). Identity normalizes the trimmed email for a case-insensitive
lookup; passwords remain unchanged. UserName and phone login are not accepted. Ambiguous legacy
normalized emails receive the generic 401 denial without issuing a session. Account provisioning
and tenant activation remain separate workflows.
Passwords are passed unchanged to Identity. Kestrel limits this endpoint's request body to 16 KiB.
Oversized bodies return sanitized HTTP 413 ProblemDetails; the global handler preserves that status.

On success, HTTP 200 returns `userId`, `roles`, `accessToken`, ISO-8601 `expiresAt`, `sessionId`,
`refreshToken` and `sessionExpiresAt`. An optional `device` label is bounded to 256 characters and
never used as an authorization signal. Roles come
only from Identity persistence; extra request properties cannot select roles. Responses use
`Cache-Control: no-store` and `Pragma: no-cache`. Send the token as Bearer authorization for the
session probe and future protected operations.

Invalid input returns validation ProblemDetails (400). Invalid credentials, unknown accounts,
lockout, inactive accounts, unsupported/no roles, and accounts requiring an unsupported second factor all return
generic ProblemDetails (401, title `Sign-in failed.`). Identity's existing five-failure/15-minute
lockout applies. Database/provider failures remain sanitized server errors; they are not reported as
successful logins. Generic error bodies do not guarantee identical response timing.

No users are seeded or created by login. Provisioning/activation workflows and second-factor challenges
remain unimplemented. Existing `Owner`/`Staff`/`Tenant` role casing is preserved. Login clients must now send `email`; legacy `userName`-only login
payloads return 400. Forgot/reset-password retain their existing `userName` contract for a later step.

## Sessions, refresh and credentials

Authenticated account/session actions now declare fixed permissions: `account.view-own` for me
and the session probe, `account.change-password` for password change, `sessions.revoke-own` for
logout/logout-all. All three business roles retain these own-account actions. Login/refresh and
password recovery entry points retain their explicit anonymous access and credential validation.
New business actions use `[Authorize(Policy = Permissions.<Module>.<Action>)]` plus service-layer
`PermissionAccess.CanAccessAsync` with server-loaded scope. Permission grants are fixed in Domain,
not accepted from request/JWT permission claims. See the [catalog and integration guide](../development/FIXED_ROLE_PERMISSIONS.md).

| Method / `/api/v1/auth/` route | Authentication / input                                                                    | Result                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST `login`                   | Anonymous; `email`, `password`, optional `device`                                         | 200 session or generic 401                                                                          |
| POST `refresh`                 | Anonymous entry; valid refresh credential; JSON `{refreshToken}` for mobile, `{}` for web | 200 rotated session or generic 401                                                                  |
| POST `logout`                  | Bearer                                                                                    | 204; revoke current session                                                                         |
| POST `logout-all`              | Bearer                                                                                    | 204; revoke all user's sessions                                                                     |
| GET `me`                       | Bearer                                                                                    | 200 `{userId,sessionId,roles}`                                                                      |
| POST `change-password`         | Bearer; `currentPassword`, `newPassword`                                                  | 204 + revoke all sessions; generic 400 on failure                                                   |
| POST `forgot-password`         | Anonymous; `userName`                                                                     | 202 generic response when delivery adapter is ready; uniformly 503 with current unavailable adapter |
| POST `reset-password`          | Anonymous; `userName`, `token` (max 4096), `newPassword`                                  | 204 + revoke all sessions; generic 400 on failure                                                   |

All auth bodies are limited to 16 KiB; bounded validation failures return 400. New passwords use
Identity's existing policy: at least 12 characters with uppercase, lowercase, digit and non-alphanumeric.
All auth responses are no-store, including errors. Source-based auth rate limit defaults to 30 per
60 seconds with 429 ProblemDetails/Retry-After, in addition to Identity account lockout. Rate counters
are per API instance; clustered deployment also needs a shared ingress limit. Untrusted forwarded
headers do not select a new source partition.

JWT includes `sub`, `role`, `jti`, `sid`, `sstamp`; no Location/identity fields. Every protected request
validates signature/HS256/issuer/audience/expiry, then current active account, lockout, second-factor
state, session expiry/revocation, stamp and current stored roles. JWT default is now
30 minutes as approved and aligned with Report 4; clock skew remains 30 seconds. Absolute session
expiry is enforced without skew. Old JWTs lacking session/stamp require a new login after deployment.

Refresh tokens have 256 random bits and only SHA-256 hashes are persisted. A session ID is its token
family ID. Refresh expiry defaults to 7 days and never exceeds the 7-day absolute session lifetime.
The approved policy permits configuration only within 1-7 days; startup rejects longer or zero
refresh/session lifetimes. The session deadline is fixed at login, not extended by rotation.
Every successful refresh consumes the old token in a PostgreSQL transaction with a user-row lock;
reuse revokes that family, including the access JWT. Concurrent reuse has at most one success and
then revokes the family. Clients must serialize refresh, rather than retrying an old refresh token
after an ambiguous network failure. Client code coalesces requests; supported browsers additionally
use Web Locks for cookie changes across tabs. Other browsers need deployment/browser validation.

Client behavior remains reactive: after a protected request returns 401, refresh once and retry
the original request at most once. A denied refresh (401) clears the local session; a temporary
network/503 error preserves it and surfaces the failure. A 403 permission denial never triggers
refresh. See [refresh implementation and verification](../development/REFRESH_TOKEN_SESSIONS.md).

Web opts in using `X-BHome-Client: web` on auth POSTs and browser `credentials: include`. The server
returns `refreshToken: null` and a `__Secure-bhome-refresh` cookie with HttpOnly, Secure, SameSite=Strict,
host-only, path `/api/v1/auth`. Cookie writes/reads require the custom header and an exact Origin in
`AuthWeb:AllowedOrigins` or the API's own origin. CORS also needs the Owner origin explicitly allowed.
General CORS origins (including Public Web) do not automatically qualify for auth cookie transport.
Do not use wildcard origins. Cookie alone never authenticates a protected API: these use Bearer only.
Use HTTPS and a same-site deployment (local HTTPS frontend or same-origin reverse proxy); cross-site
web/API domains will intentionally fail Strict cookie refresh. Configure proxies explicitly, without
trusting arbitrary forwarded headers. Mobile default transport uses JSON refresh and `credentials: omit`;
credentials remain in memory until a reviewed native secure-storage adapter is integrated.

Reset uses Identity's real Data Protection token provider plus a persisted SHA-256 grant, TTL default
15 minutes. Only the latest grant for an active, confirmed-email account can be consumed once under
the user lock. No token is returned to anonymous callers. Delivery is a dedicated unavailable port;
setting a notification URL/key does not implement email. A test-only capturing adapter verifies the
core, but is never registered in production. Persist/share and protect the Data Protection key ring
across replicas/restarts before enabling real delivery. OTP/MFA is not represented as complete.

Account deactivation, security-stamp/2FA changes and role-assignment mutations revoke sessions in DB
triggers, including direct Identity/SQL changes. Reactivation/restoring roles does not revive tokens.
These direct changes have an audit target and unknown actor (`userId: null`); future UC-08 management
must supply authenticated actor/reason through its application workflow. There is no unscoped admin
endpoint in this change. Security audit UPDATE/DELETE/TRUNCATE is rejected by the DB trigger and
tracked EF mutations are also rejected. Retention requires an approved privileged archival policy.

See [audit, migration and verification](../development/AUTH_SECURITY_AUDIT.md).

## Internal OCR proposals

`POST /api/v1/ocr/identity/{residentId}/front`, `/back` and
`POST /api/v1/ocr/meter-tasks/{taskId}` accept bounded binary PNG/JPEG bodies with Bearer
authentication. They return human-review proposals only, never confirmation or persistence.
Resource lookup now uses Chain/Location/Room/Resident/Meter/OperationalTask and effective Staff
assignments in PostgreSQL. Every request checks server-loaded ownership/assignment; a missing or
out-of-scope resource returns 404, a closed workflow 409, and unavailable model/resource lookup 503.
Do not use caller-supplied ownership or Location IDs as authorization. See
[current mobile setup, confirmation APIs and limitations](../development/OCR_MOBILE_DELIVERY.md).

Development-only OCR harness: `GET /api/v1/ocr/diagnostics` checks availability and
`POST /api/v1/ocr/diagnostics/{profile}` runs the same OCR pipeline without a business resource
or persistence. Requires authenticated Owner/Staff and both `Development` environment and
`MobileDevelopment:Enabled=true`; otherwise 404. Profiles: `identity-front`, `identity-back`,
`electricity-mechanical`, `electricity-digital`, `water-mechanical`, `water-digital`.
Binary JPEG/PNG <=5 MiB; returns `{ proposal, elapsedMilliseconds }` with no-store.
This harness does not authorize any business read, confirmation, or evidence storage.

Meter diagnostics optionally accept `?decimalPlaces=0..4`, the number of fractional digits
actually displayed by the meter. Invalid values and identity profiles with this parameter
return 400; disabled diagnostics still return 404 before parameter validation. Without a
precision hint, an integer-looking proposal warns that the decimal separator is unverified.
Business meter OCR always uses the server-loaded `Meter.DecimalPlaces`; a caller query cannot
override it. Values retain their full fractional part and still require human confirmation.
See [accuracy evaluation and limitations](../development/OCR_ACCURACY_DELIVERY.md).

## Contracts and status codes

D011/D012 Contract APIs, quyền, request/response, idempotency và các dependency đang chờ được
mô tả tại [Contract lifecycle delivery](../development/CONTRACT_LIFECYCLE_DELIVERY.md).
Các API mới dùng chuỗi decimal VND trong response; input nhận chuỗi decimal hoặc số nguyên.
Mọi truy cập file hợp đồng/inspection đi qua endpoint được phân quyền, không có public URL.

Location assignment endpoints follow the fixed Owner/Staff scope described in
[Staff Location assignments](../development/STAFF_LOCATION_ASSIGNMENTS.md). Owner creates a minimal
Location and manages inclusive dated assignments; Staff reads only Locations assigned on the current
Vietnam business date. Assignment mutations send `locationId` in the JSON body; assignment-history
reads use a query parameter rather than a GET body. Every Owner can manage every Location and assign
any active Staff account. Overlapping assignments return 409 and unknown Location IDs return 404.

JSON properties use camelCase. Use explicit request/response DTOs, never EF entities. Require and
validate bounded string lengths, supported enum values, sizes and page parameters at the API edge;
application services enforce business invariants and authorization. Do not expose private fields
merely because a frontend hides them.

| HTTP status | Meaning                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| 200         | Successful read/update with a response body                                  |
| 201         | Created resource, include Location when a resource URL exists                |
| 202         | Durably accepted asynchronous work; never claims the effect already happened |
| 204         | Successful operation without a body                                          |
| 400         | Invalid request/validation failure                                           |
| 401         | Missing, expired or invalid authentication                                   |
| 403         | Authenticated but not permitted                                              |
| 404         | Resource absent (or intentionally concealed according to the access policy)  |
| 409         | Version/concurrency or idempotency/business-state conflict                   |
| 429         | Rate limit if introduced by the authentication/API feature                   |
| 500         | Unexpected failure with generic detail                                       |
| 503         | Capability/provider temporarily unavailable or unconfigured                  |

Errors use `application/problem+json`, with `type`, `title`, `status` and `correlationId`; optional
`detail`/`instance` must not contain sensitive data. `[ApiController]` model validation uses
`ValidationProblemDetails.errors` keyed by field. Never echo rejected passwords/tokens/CCCD values.
Expected business errors should be mapped explicitly, rather than exposing exception messages.

```json
{
  "type": "https://httpstatuses.com/503",
  "title": "Service temporarily unavailable.",
  "status": 503,
  "correlationId": "a2fbce50-840c-49b3-bd4b-8ccb89d92202"
}
```

The server validates an optional GUID `X-Correlation-ID` and returns the accepted/generated ID in
the same response header and error body. Clients can present that identifier for support. It is
not an authentication credential or an idempotency key. Never include stack traces or provider
credentials in responses. Client UI displays a safe localized error, not arbitrary server detail.

## Authentication and data access

Protected requests send `Authorization: Bearer <access-token>`. Default server authorization requires
authentication. Guest is anonymous and has no role. Anonymous public endpoints explicitly opt in
and return only Owner-approved non-sensitive projections.

Restrict roles for each operation and enforce chain ownership, Staff Location assignment or Tenant
ownership in the application service. Scope must come from authoritative server data. Apply scope
predicates in database queries before sorting, counting and paging. Return the documented 403/404
consistently to prevent resource enumeration. CORS is an origin policy, not authorization.

## Pagination, time and money

Future list endpoints use `page` (1-based, default 1), `pageSize` (default 20, maximum 100), and
stable documented ordering with an ID tie-breaker. A page DTO contains `items`, `page`, `pageSize`
and `totalCount`. Validate bounds rather than loading an entire table then paging in memory.
Provider cursor pagination stays inside its adapter contract and is not automatically an API cursor.

Transmit instants as ISO 8601 UTC with `Z`/explicit offset. Persist UTC `timestamptz`. Transmit pure
calendar dates as `YYYY-MM-DD`; do not convert a date-only contract term through browser timezone.
Convert business schedules using the explicit `Asia/Ho_Chi_Minh` zone, never server-local time.
Clients centralize Vietnamese formatting in client-core.

Store/calculate VND with decimal and defined precision/rounding; do not use floating point for
financial arithmetic. Future DTOs document whether VND amounts are decimal strings or bounded integer
dong; prefer decimal strings for arbitrary precision and avoid JS integer overflow. Display currency
formatting is not a business rounding rule. No financial endpoint/schema is invented here.

## Financial and callback idempotency

When a future endpoint creates a financial/contract effect, define `Idempotency-Key` support and
persist a unique key scoped by principal/operation plus a normalized request fingerprint and result
inside the effect transaction. The same key/input returns the same result; a different input with
the same key is a conflict. Define retention and pending/failed response behavior per use case.

Authenticate provider callbacks, preserve and uniquely constrain provider transaction/event references,
and commit reference, transition, audit and outbox/job intents together. Ignore/replay known callbacks
without duplicating effects. The foundation queue's unique enqueue key is not a universal HTTP
idempotency implementation. Never retry ambiguous money/signing mutations automatically without a
provider status check or audited pending-review/manual-verification path.
