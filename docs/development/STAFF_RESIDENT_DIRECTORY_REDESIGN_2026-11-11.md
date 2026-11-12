# Staff resident directory — 11/11/2026

Scope: presentation and navigation for Staff room/resident management. Source: the user's redesign request, repository AGENTS.md, existing onboarding delivery notes (BF-03/BF-04, UC-13..15, GBR-01/02/04/07), capture controllers/DTOs, and the existing Staff workflows. No business rule, permission, backend contract, or database change.

## Presentation

- The directory shows total rooms, total residents in those rooms, and pending residents, with explicit units. Summary counts describe the selected Location, independently of search and filters.
- Search matches room numbers and resident names, including Vietnamese searches without accents. Two filters: Cần xử lý (at least one Pending resident) and Tất cả phòng.
- Pending rooms sort first. Room rows contain only the room label, resident count, pending resident count, and chevron. No resident records are expanded inline.
- Search, filters, summary, and the single receive-resident action remain outside the scrolling list. Pages contain at most 12 rooms. The API returns full scoped arrays; pagination limits rendered room rows, not network payload size.
- The room detail uses a virtualized resident list and shows names, representative/member roles, and explicit verification status. Its receive-resident action preselects the authorized Location and room in the existing onboarding flow.
- Resident details reuse the existing profile and OCR/manual confirmation workflow. Rejected and unrecognized statuses do not enable verification. Existing verified-resident contract lookup/preparation remains available.
- Stack back navigation returns to the existing room/directory instance, retaining Location, search, filter, and page. Refocusing the directory/room refreshes scoped data after onboarding or verification.

## API and privacy

Reuses GET `/api/v1/capture/locations`, GET `/api/v1/capture/locations/{id}/rooms`, GET `/api/v1/capture/locations/{id}/residents`, and existing onboarding/contract services. The Staff ResidentSummary returns ID, RoomId, DisplayLabel, ResidentType, VerificationStatus, and ConfirmedAt. It does not return contact fields or decrypted identity data; those fields are not added to the UI. No financial or residence-registration information is fetched for this directory.

Status mapping follows BHome.Domain.TenantContracts: Pending=0, Verified=1, Rejected=2. Rejected residents are not counted as pending. Unsupported status/role values have an explicit unknown label. Navigation carries reference IDs only. A requested Location is selected only if the assigned-Location response includes it; unavailable rooms fail closed.

## Verification

- Mobile TypeScript and ESLint: passed.
- Full mobile suite with bundled Node 22: 74 files, 907 tests passed. Coverage includes 60 rooms/120 residents, pagination/search/filter changes, scoped deep links, valid/invalid initial Location, status mapping, back navigation, loading/error/retry, and existing onboarding/contract behavior.
- Expo web export: passed; output in ignored `.tools/staff-residents-redesign-web`.
- Live visual/device QA at 360–400 px: not run. Browser access host and native computer-use pipe were unavailable. Touch targets are sized at least 44 px in source; no physical-device layout or performance measurement is claimed.
- No migration or seed operation was performed.
