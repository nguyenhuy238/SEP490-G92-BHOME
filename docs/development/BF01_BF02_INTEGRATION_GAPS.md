# BF-01/BF-02 integration gaps

Verified against the repository on 2026-11-07. This note specifies missing capabilities; it does not prescribe route names or authorize Backend/schema changes.

## Current Staff API boundary

`GET/POST /api/v1/capture/staff` belongs to the OCR/capture adapter. It exposes an active-Staff name/ID lookup and account creation only. It is not a complete Staff account lifecycle API.

`GET/POST /api/v1/staff-location-assignments` lists assignments for one Location and creates a non-overlapping effective-date assignment. No update, end or removal operation is implemented.

## Required Backend capabilities

### Staff query and detail

- Owner-scoped, paginated Staff summaries with stable ordering.
- A detail read returning the persistent Staff ID, username, email, active status and effective Location assignments.
- Do not expose password hashes, security stamps, refresh tokens, identity documents or unrelated employment information.
- Define the ownership/chain boundary explicitly; the current capture lookup must not become a cross-Owner directory if multiple Owner containers are supported later.

### Staff profile and account-state update

- Update only Backend-supported username/email fields and active status; preserve the existing account ID and role.
- Require Owner authorization, validation, uniqueness checks, an audit reason and optimistic concurrency semantics.
- Deactivation must revoke or invalidate existing Staff sessions and must not erase task, assignment or audit history.
- Define behavior for deactivation when future/current assignments or operational tasks exist.
- Return the persisted safe Staff detail plus an explicit conflict/validation result when the update cannot be applied.

### Assignment lifecycle

- Amend or end an assignment without deleting its historical record.
- Inputs must identify the existing assignment and the requested effective-date change, with concurrency protection and an audit reason.
- Validate Location existence/ownership, active Staff status, date order and overlaps transactionally.
- Preserve unrelated assignments when one assignment changes.
- Define whether a started assignment can be shortened, whether retroactive changes are allowed and how open operational work is handled.
- Return the persisted assignment and use distinct validation, not-found, stale-version and overlap outcomes.

## Frontend behavior until Backend support exists

- `/staff` supports real list/create and assignment list/create only.
- Unsupported edit, activate/deactivate and assignment-modification actions are not rendered as successful operations.
- The screen explicitly identifies these capabilities as unavailable; it never substitutes a create request for an edit.
