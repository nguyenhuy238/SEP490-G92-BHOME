# BF-07 implementation and verification

## Baseline and traceability

Request baseline is the user's approved Incident & Maintenance task dated 15/11/2026.
It takes precedence over older Report 4 mandatory incident references and existing API limitations.
The current branch is `member/QHuy`. The initial working tree was clean.

| Behavior                                      | Approved source                        | Components                                                            | Acceptance coverage                                                                  |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reporting, emergency response, classification | BF-07, FE-06, UC-26–28, GBR-01/02/11   | IncidentService, controllers, repository, clients                     | Scope denial, emergency notifications, no automatic Work Order                       |
| Incident and proactive maintenance            | Task §4.2–4.4, UC-28–30, GBR-12        | MaintenanceWorkOrder, Compact24 mappings/guard, service, Owner/Mobile | Both sources, correct daily assignee, proposals, approval/start, verification/rework |
| Fast Repair and Asset association             | Task §4.6–4.7                          | Policy, Work Order execution, Asset proposal/decision                 | Disabled by default, zero cost, no materials, fallback, Owner confirmation           |
| Tenant compensation                           | Task §5, BF-06, UC-19/22–25, GBR-10/18 | Billing, payments, settlement, maintenance                            | Contract scope, exclusive collection, insufficient deposit, no duplicate effects     |
| Private evidence and history                  | UC-26/29/30, NFR image limits          | IIncidentFiles, Compact24 history, private evidence routes            | MIME/size/scope, failed upload, immutable audit                                      |

## Audit

Report 3 and Report 4 originals exist under `docs/reports/` and were inspected through their DOCX XML.
The standalone team Git text indexed by AGENTS.md is absent. The root rules and database team guide
specify member branches and PRs into develop. No push or merge is part of this task.
Report 4 has older architecture references. Current code uses .NET 8, React/MUI, Expo 58 and Compact24.

Existing reporting, classification, emergency actions/cost review, proposals, plan approval/start,
verification, rework, expense creation, private evidence and location authorization are implemented.
At the initial audit, Work Orders required an Incident in services, history projections and a PostgreSQL guard.
Operational tasks are distinguished through `task_type='WORK_ORDER'`.
Tenant projections redact internal costs, vendor, actors and event JSON.
Existing billing, bank allocation and settlement services are the finance integration boundaries.

CI already configures DOTNET_INSTALL_DIR and DOTNET_ROOT inside a step through RUNNER_TEMP.
The previously reported job-level runner.temp expression is absent.
Local baseline backend Release build executed successfully with 0 warnings and 0 errors.
Host Node is 24.22.1, while CI and package engines require Node 22. Validation used the repository-local
Node 22.23.4 runtime and a successful `npm ci --no-fund --no-audit`.

## Implementation checklist

- [x] Extend the existing Work Order source and shared execution flow.
- [x] Preserve incident history and support work-owned proactive evidence/history.
- [x] Add global versioned Fast Repair policy and Owner-confirmed Asset proposals.
- [x] Integrate supported compensation with existing financial transaction boundaries.
- [x] Extend Owner Web and Mobile using existing controls and real API mutations.
- [x] Add targeted regression tests and reproducible disposable demo scenarios.

## Delivered scope

Compact24 retains 24 public tables. Proactive work is a real `WORK_ORDER` with nullable Incident,
with execution state in `task_data` and append-only records in `history`. The current bootstrap SQL,
upgrade script, migrations and model snapshot were synchronized. The immutable initial migration
was preserved. Legacy missing source values read as Incident.

Emergency in-app notifications are persisted in the same transaction as the report. Existing
configured email/SMS delivery and dispatch-time authorization are retained. Provider failures leave
the committed report and in-app notification available.

Owner Web supports proactive creation, policy management, Asset decisions, evidence, compensation,
invoice navigation and deposit decisions. Mobile uses work-owned evidence/history for both sources,
with Staff execution/Fast Repair/Asset proposal and Owner quick decisions. Tenant reporting includes
authorized co-occupants and retains existing payment/navigation entry points.

Compensation is available from Verified room Work Orders with positive actual cost. This implementation
allows one auditable decision per Work Order. Owner explicitly selects a genuinely related activated
Contract. It creates either a separate finalized AD_HOC Invoice or a full deposit reservation/deduction.
Pending deposit decisions can be cancelled with history. The compensation endpoint blocks changes
after invoice issuance or deduction. A broader correction/reversal workflow remains unimplemented.
Owner-direct Incident completion without a Work Order has no compensation entry point in this slice.

The demo seed uses an isolated loopback Development database and private MinIO. It is repeatable,
contains only synthetic accounts/data, and drives the supported service transitions for completed work.
The browser regression drives Owner Web through real API mutations and Staff API execution.

See [the demo walkthrough](../testing/BF07_DEMO_2026-11-15.md) for reproducible A–I scenarios.

## Open policy constraints

Suggested categories remain inactive until Owner activation. Occupied-room entry policy is unspecified.
Historical tenancy access must use established contract rights. Post-collection refund/reversal is blocked
until approved. Deposit sufficiency must be rechecked at settlement. Fast Repair fallback must remove
policy execution authorization before a normal proposal is approved.
