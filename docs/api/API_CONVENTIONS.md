# API conventions

Current configuration baseline: 2026-11-09, BHome.Api and Compact24, Location -> Room.
See [current status](API_IMPLEMENTATION_STATUS.md), [runtime inventory](API_RUNTIME_ROUTES.md),
[native contracts](LOCATION_ROOM_API.md) and [shared configuration](SHARED_CONFIGURATION.md).
The old 216-route count and Chain/RoomType examples are superseded. The prior document
is preserved in [history](history/API_CONVENTIONS_before_2026-11-09.md).
These common conventions do not replace endpoint-specific DTOs or permissions.
Operational Task create/assign/update, Staff execution, Owner verification, private evidence and in-app
notifications are documented in [Operational Tasks](OPERATIONAL_TASKS.md). The unified Task schema
preserves legacy capture/meter routes and their UC-20 completion behavior.

Use HTTPS, REST, JSON and `/api/v1/<resource>` routes. `GET /api/v1/session` is an authenticated
foundation probe returning a minimal `userId` DTO. `POST /api/v1/auth/login` verifies existing Identity
accounts. `/health/live`, `/health/ready` and development Swagger are operational exceptions to the
prefix. Readiness calls `BHomePersistenceContext.IsSchemaReadyAsync`: in the current Compact24
runtime it checks the actual schema, not the pending legacy EF migration list. Legacy EF migrations
are offline/history artifacts; do not run them as a Compact24 deployment procedure.

## Existing-account login

POST /api/v1/auth/login accepts exactly one email or phone, a password and optional
device label. Email is bounded to 256 characters, phone to 30, password to 1024 and
device to 256. Identity verifies normalized identifiers; ambiguous/invalid accounts
fail without issuing a session. UserName is not a login request field. Passwords are
passed unchanged to Identity. Login body limit is 16 KiB; oversized requests return
sanitized 413 ProblemDetails. This describes the current LoginRequest/Controller;
the former email-only convention was superseded by the implemented phone workflow.
On success, HTTP 200 returns `userId`, `roles`, `accessToken`, ISO-8601 `expiresAt`, `sessionId`,
`refreshToken` and `sessionExpiresAt`. An optional `device` label is bounded to 256 characters and
never used as an authorization signal. Roles come
only from Identity persistence; extra request properties cannot select roles. Responses use
`Cache-Control: no-store` and `Pragma: no-cache`. Send the token as Bearer authorization for the
session probe and protected operations.

Invalid input returns validation ProblemDetails (400). Invalid credentials, unknown accounts,
lockout, inactive accounts, unsupported/no roles, and accounts requiring an unsupported second factor all return
generic ProblemDetails (401, title `Sign-in failed.`). Identity's existing five-failure/15-minute
lockout applies. Database/provider failures remain sanitized server errors; they are not reported as
successful logins. Generic error bodies do not guarantee identical response timing.

No users are seeded or created by login. Capture/onboarding and Tenant account linkage are separate
implemented workflows; this does not provide public self-registration. Second-factor challenges
remain unimplemented. Existing `Owner`/`Staff`/`Tenant` role casing is preserved. Login clients send
`email`; legacy `userName`-only login payloads return 400. Forgot/reset-password still accept
`userName` as documented below; reset delivery is currently unconfigured.

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
Resource lookup now uses Location/Room/Resident/Meter/OperationalTask and effective Staff
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

`POST /api/v1/ocr/diagnostics/auto` accepts the same untyped image and diagnostic
authorization/gates; returns `{ analysis, elapsedMilliseconds }` with no-store.
`analysis` has `classificationStatus`, `detectedCategory`, nullable
`classificationConfidence`, `classificationSource`, `candidateCategories`,
`warnings`, nullable `identityProposal`/`meterProposal`, and `requiresReview=true`.
Optional `partialCategory` (`meter`, `water`, `electricity`), `detectionConfidence`
and `cropPreviewDataUri` describe a localized provisional meter reading. A window
score is not a category score. With the opt-in pretrained window detector, category
remains ambiguous until the user chooses it after capture; the crop/proposal does
not confirm a business reading. The data URI is transient review content and must
not be logged/cached/persisted. Missing/uncertain detection uses manual fallback.
See [verified pretrained capabilities and limits](../development/PRETRAINED_YOLO_METER_OCR_IMPLEMENTATION.md).

With opt-in `Ocr:MeterDetector:WaterDigitsEnabled`, typed mechanical-water crops
also run the pinned stage2 digit model. Conflicting recognizers, unclear/overlapping/
missing digits require manual entry; digits never determine billing precision or
meter ownership. Automatic input without a supported profile retains its crop and
asks for type after capture. Explicit high-confidence device labels can resolve
technology as `text_rules` evidence (classification confidence remains null).
Units alone do not resolve technology. No business endpoint/schema changes;
see [actual stage2 accuracy and gaps](../development/METER_OCR_COMPLETION_REPORT.md).

The incremental water policy may return a stage2-only review proposal when one
PP line cannot be parsed as a numeric reading. It never overrides a valid numeric
disagreement, multiple regions, wrong utility or unclear digits. The diagnostic
Mobile screen can re-read the same bounded meter image with user-confirmed
precision after capture; production task precision remains server-authoritative.

Meter parsing also checks nearby separately detected unit boxes. A bare number
next to a flow-rate/electrical-parameter/TDS/unsupported volume unit (for example
`m³/h`, `V`, `Hz`, `ppm` or gallons) is not an accumulated kWh/m³ reading; it
returns fallback with `billing_register_unverified`. A distant parameter label
does not suppress a properly associated billing unit. No unit conversion or
client precision change is introduced.
Stage2 fusion also retains this rejection for a single PP line with an explicit
non-billing quantity; it cannot treat that line as malformed text to bypass the veto.

An experimental four-class YOLO category adapter is available through
`Ocr:VisualClassifier` but remains disabled by default and refuses inference
outside Development. No validated four-class weights are bundled. It requires
an explicitly configured model path/SHA256, exact four-class metadata and tensor
contract. Unknown/multiple/conflicting detections remain review cases; an adapter
outage preserves existing OCR with `visual_classifier_unavailable`. In Staff
tasks, confident visual mismatch suppresses the reading with `meter_type_mismatch`;
visual evidence never changes server Meter kind, ownership or precision. No new
endpoint or response fields. See [architecture and activation gates](../development/OCR_MODEL_ARCHITECTURE.md).

When an evaluated visual adapter identifies mechanical water and Stage1 verifies
one reading display, automatic OCR now uses the existing PP/Stage2 fusion and
returns the same optional crop preview/detection confidence as other localized
results. Category confidence remains separate. Unsafe crop evidence suppresses
the reading; a body-only crop does not authorize Stage2. Other profiles retain
their existing readers. This wiring does not enable the rejected four-class model.

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

The minimal Location create/list slice is now superseded by the approved
[property configuration APIs](PROPERTY_MANAGEMENT.md): creation requires name/address without a Chain,
listing is paginated, Room creation belongs directly to Location, and effective-dated
prices have Location or Room scope with immutable historical versions. See [current API](LOCATION_ROOM_API.md). `assigned-to-me` keeps its existing small list contract.

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
| 413         | Request body or evidence exceeds the endpoint's limit                        |
| 429         | Rate limit if introduced by the authentication/API feature                   |
| 500         | Unexpected failure with generic detail                                       |
| 503         | Capability/provider temporarily unavailable or unconfigured                  |

Errors use `application/problem+json`, with `type`, `title`, `status` and `correlationId`; optional
`detail`/`instance` must not contain sensitive data. `[ApiController]` model validation uses
`ValidationProblemDetails.errors` keyed by field. Never echo rejected passwords/tokens/CCCD values.
Expected business errors should be mapped explicitly, rather than exposing exception messages.

Property service rejections preserve their explicit 400/403/404/409 status and safe `code`.
Exception responses retain `application/problem+json` and `correlationId` even when a private-file
client sends `Accept: application/pdf`, `application/octet-stream` or an image media type.
Unsupported error content negotiation must not replace an expected business rejection with 500.

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

Restrict roles for each operation and enforce the approved Owner role, Staff Location assignment or Tenant
ownership in the application service. Scope must come from authoritative server data. Apply scope
predicates in database queries before sorting, counting and paging. Return the documented 403/404
consistently to prevent resource enumeration. CORS is an origin policy, not authorization.

## Pagination, time and money

List endpoints must follow their actual module DTO: Property uses `totalCount`, Expenses uses
`total`, and some bounded capture/history endpoints return arrays rather than a page envelope.
The general convention for new paged endpoints is `page` (1-based), `pageSize` bounded to 100,
and stable ordering with an ID tie-breaker; defaults remain module-specific. Validate bounds
rather than loading an entire table then paging in memory. Do not make clients assume one envelope.
Provider cursor pagination stays inside its adapter contract and is not automatically an API cursor.

Transmit instants as ISO 8601 UTC with `Z`/explicit offset. Persist UTC `timestamptz`. Transmit pure
calendar dates as `YYYY-MM-DD`; do not convert a date-only contract term through browser timezone.
Convert business schedules using the explicit `Asia/Ho_Chi_Minh` zone, never server-local time.
Clients centralize Vietnamese formatting in client-core.

Store/calculate VND with decimal and defined precision/rounding; do not use floating point for
financial arithmetic. Billing, Payment, Refund and Finance money responses use decimal strings;
keep them exact in clients, with Vietnamese VND formatting only for display. Request acceptance
of strings/numbers and quantity precision follow each DTO. Display currency formatting is not a
business rounding rule. Financial calculation and verified success remain server-authoritative.

## Financial and callback idempotency

When an endpoint creates a financial/contract effect, define `Idempotency-Key` support and
persist a unique key scoped by principal/operation plus a normalized request fingerprint and result
inside the effect transaction. The same key/input returns the same result; a different input with
the same key is a conflict. Define retention and pending/failed response behavior per use case.

Authenticate provider callbacks, preserve and uniquely constrain provider transaction/event references,
and commit reference, transition, audit and outbox/job intents together. Ignore/replay known callbacks
without duplicating effects. The foundation queue's unique enqueue key is not a universal HTTP
idempotency implementation. Never retry ambiguous money/signing mutations automatically without a
provider status check or audited pending-review/manual-verification path.

## Upload và financial workflows hiện tại

| Module              | Request body / kiểm tra phía client                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| OCR proposal        | Raw PNG/JPEG theo endpoint; không multipart và không tự confirm/persist                                                  |
| Adjustment evidence | PUT raw PNG/JPEG, tối đa 5 MiB; nhận ID rồi link vào request                                                             |
| Expense evidence    | POST raw PNG/JPEG, tối đa 5 MiB, UUID `Idempotency-Key`; PendingUpload chưa tải được                                     |
| Refund execution    | POST `multipart/form-data`, ảnh PNG/JPEG tối đa 5 MiB và execution metadata; UUID key + expectedVersion + humanConfirmed |

Khi gửi `FormData`, để fetch/browser sinh `Content-Type` cùng boundary; không ép
`application/json` hoặc tự đặt multipart header thiếu boundary. Private download vẫn dùng Bearer,
không token trong URL. Lỗi file vẫn là ProblemDetails dù request Accept là ảnh/PDF/octet-stream.

Owner xác minh receipt và phân bổ thiếu/thừa qua [Payment API](PAYMENTS.md); phần dư còn được hoàn
phải đọc [RefundSource](REFUNDS.md), không suy từ `TransferView.unallocatedAmount`. Refund là ghi
nhận giao dịch Owner đã thực hiện bên ngoài, không có API tự chuyển tiền. Version stale hoặc key
khác payload trả 409; tải lại, review và chỉ retry cùng key khi giữ đúng payload/bytes. Upload intent
được lưu bền vững trước storage; Pending/Approved chưa phải Completed. Không tự retry tài chính
chỉ vì browser timeout. Tham chiếu [Finance](FINANCE.md) cho report/What-if và các chỉ tiêu unavailable.
