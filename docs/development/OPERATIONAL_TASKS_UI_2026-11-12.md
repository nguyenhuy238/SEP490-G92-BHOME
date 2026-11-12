# Owner Task UI — 12/11/2026

Scope: requested BF-02 / UC-10, UC-12 redesign, retaining server authorization, lifecycle, Location responsibility, version and idempotency. Inspected TaskContracts, OperationalTaskService, OperationalTasksController, recurring DTOs, existing frontend hooks and tests. No backend/database/mobile changes.

Changed `TasksApiPage.tsx`, `taskContracts.ts`, `pages/TasksPage.tsx`, `TasksPage.test.tsx`; added `useOperationalTasksApi.ts` and components `TaskDetailDrawer`, `TaskEvidenceGallery`, `TaskEditorDialog`, `RecurringTasks`.

- Three tabs, compact filters with persistent advanced fields, real server pagination, server totalCount-based summary, separate overdue warning.
- Drawer with requirements/results, authenticated evidence thumbnails and enlarged image dialog, object URL cleanup, paginated history timeline and actor fallback.
- Create/edit and Owner actions retain existing endpoints, Idempotency-Key and version. Creation requires current Staff assignment; edit excludes PendingVerification and MeterReading. Verification loads fresh detail and requires result/evidence review. Conflict keeps inputs and exposes explicit reload; no automatic write retry.
- Pending list uses status=4 at the server. Verify/rework open review dialogs; successful mutations invalidate existing Owner queries.
- Recurring creation uses IntervalDays as requested. Existing Daily/Weekly/Monthly metadata is preserved for editing/toggling rather than silently converted. New weekday/month-day selection is not offered. Delete retains locationId/version query parameters.
- Directory names load all pages; no UUID used as the current staff display name. Existing `/actors` API supplies history/verification names, with unknown fallback and full ID tooltip.

Validation: initial task typecheck passed. Focused BF-02 suite passed 52 tests across three files, then expanded Task suite passed 20/20. Oxlint and diff whitespace check passed. Final whole-app typecheck/build is blocked by concurrent/out-of-scope errors: undefined `roomTypes` in PropertyApiPages.tsx and missing `RoomTypeConfiguration` in RoomTypesApiPage.tsx. Those files were not altered for this task. Browser visual QA and live backend writes were not run.
