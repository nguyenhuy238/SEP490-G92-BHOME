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
