# API conventions

Use HTTPS, REST, JSON and `/api/v1/<resource>` routes. The only initial controller route is the
authenticated `GET /api/v1/session` foundation probe. It returns a minimal `userId` DTO and has no
login/token issuance workflow. `/health/live`, `/health/ready` and development Swagger are operational
exceptions to the prefix. Business endpoints are added from finalized requirements.

## Contracts and status codes

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
