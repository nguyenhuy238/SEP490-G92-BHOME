# Staff Location assignments

## Traceability

- Scope: BF-01, BF-02; UC-04, UC-08, UC-10..12; DBR-01; GBR-01..03.
- Approved decision (29 October 2026): one Staff may cover multiple Locations; one Location has at
  most one Staff for any calendar date; both assignment dates are inclusive. Operational work is
  attached to the Location rather than copied to a Staff account.
- Approved decision (29 October 2026): Owner is the highest global role. Every Owner manages every
  Location, and every active account with the Staff role is available for assignment.
- Business dates use `Asia/Ho_Chi_Minh` and API values use `YYYY-MM-DD`.

## Behavior

`POST /api/v1/locations` creates a minimal global Location. This slice stores only the stable
identity and name required to enforce access; the fuller UC-04 address, publication and Room model
remains a later vertical slice.

`POST /api/v1/staff-location-assignments` accepts `locationId`, `staffUserId`, `startDate` and
`endDate` in its JSON body. Any authenticated Owner may select any existing Location and any active
account with the Staff role. A Staff account may have simultaneous assignments to several Locations. PostgreSQL rejects overlapping
inclusive date ranges for the same Location, including races between parallel requests.

`GET /api/v1/staff-location-assignments?locationId=<id>` returns the Location's assignment history to
any Owner. The read API uses a query parameter because GET request bodies are not reliably supported
by HTTP clients and intermediaries. `GET /api/v1/locations/assigned-to-me` returns only Locations assigned to the current
Staff on the current Vietnam business date. The authorization adapter performs the same database
check on every scoped request; no Location grant is stored in JWT claims.

When an assignment reaches its inclusive `endDate`, the Staff loses Location access on the next
calendar day. Location work remains attached to `LocationId`, so a later Staff can continue it
without reassignment or history rewriting. Gaps with no assigned Staff are allowed and remain
visible to the Owner.

## Current boundary

Staff provisioning is not exposed by this slice. Assignment eligibility comes from current trusted
Identity state: the account must exist, be active and have the Staff role. Legacy per-Owner columns
are retained under `Legacy*` names by migration for rollback/history, but application authorization
does not read them.

Early cancellation, editing an assignment, full Location details and operational tasks are not
implemented here. These require separate state/history and acceptance rules rather than rewriting
an already recorded assignment silently.
