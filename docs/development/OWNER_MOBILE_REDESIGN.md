# Owner Mobile redesign — 14 November 2026

## Scope and traceability

The approved task is the supplied Complete Owner Mobile UX/UI Redesign request. Owner Web remains the management channel; mobile monitors and offers existing server-authorized quick decisions. Backend contracts, permissions and persistence are unchanged.

| Behavior                               | Requirements                                               | Implementation boundary                                     | Acceptance                                                                  |
| -------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Four tabs, profile and secure routing  | GBR-01..03; FE-07; Report 4 client boundary                | navigation, WorkspaceShell, existing ProfileScreen          | Correct tabs per role; restricted links never mount financial admin         |
| Live overview with cached counts/debt  | BF-01, BF-06, FE-08; GBR-10                                | OwnerOverviewScreen, existing count/debt APIs               | No invented zeros on errors; pull refresh; cached tab return                |
| Unified real attention items           | BF-02, BF-03/04, BF-07; UC-13..19, UC-26..30; GBR-04,11,12 | OwnerApprovalQueue, existing signing/task/work-order detail | Empty categories hidden; state-gated actions; server result refreshes queue |
| Monitor operations and verify outcomes | BF-02, BF-07; GBR-01,11,12,18                              | Operations list and existing task/incident adapters         | Paginated scope/status filters; no Staff execution or task creation         |

Source inspection: root/mobile AGENTS.md, current SRS original in docs/reports, implemented ASP.NET controllers/DTOs, mobile services and regression suites. No policy changes to payments, official residence, signing provider or occupancy are authorized. Existing signing logic is preserved.

Existing discrepancy: the current code also supports INTERNAL_OTP_DRAWN signing, while root AGENTS.md cites the external-provider SRS baseline. This task explicitly requires preserving working signing; it neither adds an internal signing implementation nor resolves that separate policy discrepancy.

## Plan

1. Shared navigation, UI foundation and mobile channel boundary.
2. Concise live overview and cached monitoring.
3. Unified attention queue and supported decisions.
4. Operations/account and remaining route cleanup.
5. Cross-screen regression tests and local CI-equivalent verification.

Use one Conventional Commit per completed phase. Never push, merge or deploy as part of this task.

## Visual reference

Operate mode; preserve actual Staff/Tenant visual vocabulary: WorkspaceShell, WorkspaceTabBar, DashboardKit, ProfileScreen, Inter fonts and staffColors. Navy header, pale background, white rounded surfaces, blue selection and restrained semantic status colors. No new visual system or dependencies. Initial skeletons, recoverable errors, useful empty states and native pull-to-refresh are required. Preserve real content and back-navigation context.

## Verification

Results are recorded after commands execute. Native device, live provider and remote CI verification must be distinguished from jsdom tests and Expo exports.

### Phases 1–2

- Phase 1: mobile typecheck/lint passed; navigation suites passed 50 tests. Owner debug shortcut removed; financial administration deep links render Web guidance.
- Phase 2: four live compact KPIs, capped attention preview and three operational records; no refresh-button wall. Reuses session-scoped cache and pull refresh. Attention sources are shared between Overview and the forthcoming Attention list. Tasks are in the server's due-date order; the UI makes no chronological activity-feed claim.
- Phase 2 checks: mobile typecheck passed; lint on changed files passed; 40 connectivity/cache tests passed. New coverage proves seven shared attention reads, no repeated fetch on immediate remount, invalidation after verified server mutation and no Owner fetches for Staff/Tenant.
- Dependency install passed with Node 22.23.4/npm 10.9.9. An initial install used the machine's default Node 24 and warned about engine mismatch; installation was repeated successfully under the required Node 22. PowerShell blocks npm.ps1, so commands use npm.cmd.

### Phase 3

- Attention now renders real records in a single paginated queue, with emergency awareness distinct from decisions, nonempty category filters, location/room labels and meaningful date labels. Draft authoring, bank reconciliation and invoice adjustments are excluded.
- Existing maintenance adapter/forms now permit only plan-decision, verify and rework on the server-supported states. Staff execution, assignment and cancellation are excluded from Owner Mobile quick decisions. Confirmation dialog, busy lock, idempotency key and existing error/success feedback are retained.
- Passed mobile typecheck, changed-file lint and 54 tests across attention, incident integration and preserved Owner signing flows. Coverage includes real filtered API paths/totals, role isolation, pagination, empty/error recovery, decision state gates and the confirmation-to-versioned-request flow.
