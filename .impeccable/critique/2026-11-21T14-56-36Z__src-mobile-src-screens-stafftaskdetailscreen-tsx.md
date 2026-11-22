---
target: Staff Mobile task detail and location asset inventory
total_score: 22
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Project-Final\\SourceCode\\SEP490-G92-BHOME\\src\\mobile\\src\\screens\\StaffTaskDetailScreen.tsx"
target_fingerprint: 'sha256:97750291e90ce77bcd7a41a9d58b28857999dbd9c6fe505ededcd79650e1d61e'
target_path: "D:\\Project-Final\\SourceCode\\SEP490-G92-BHOME\\src\\mobile\\src\\screens\\StaffTaskDetailScreen.tsx"
timestamp: 2026-11-21T14-56-36Z
slug: src-mobile-src-screens-stafftaskdetailscreen-tsx
---

## Design Health Score

| #         | Heuristic                       |     Score | Key issue                                                                                               |
| --------- | ------------------------------- | --------: | ------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     |       2/4 | Task and checklist status can diverge; irrelevant 404 banner appears before the task.                   |
| 2         | Match System / Real World       |       3/4 | Core Vietnamese task language is understandable; generic CTA and technical signing hash weaken clarity. |
| 3         | User Control and Freedom        |       3/4 | Back, retry, rework and history exist; key actions remain hidden in a generic action sheet.             |
| 4         | Consistency and Standards       |       2/4 | Different freshness paths and labels can produce inconsistent task/checklist state.                     |
| 5         | Error Prevention                |       3/4 | Submission is gated by checklist readiness and server-side version/assignment checks.                   |
| 6         | Recognition Rather Than Recall  |       2/4 | Room grouping exists, but no clear next step or quick route to the next unchecked asset.                |
| 7         | Flexibility and Efficiency      |       2/4 | Repeated room/item expansion and one-by-one checking add effort; no unchecked-only filter.              |
| 8         | Aesthetic and Minimalist Design |       2/4 | Several equal-weight sections, duplicated instructions and optional panels create clutter.              |
| 9         | Error Recovery                  |       1/4 | Generic 404 text does not identify the failing subresource or give a reliable recovery path.            |
| 10        | Help and Documentation          |       2/4 | Some guidance exists, but not as a contextual, state-driven sequence.                                   |
| **Total** |                                 | **22/40** | **Acceptable; substantial improvement needed before release.**                                          |

## Design Specificity Verdict

The surface contains BHOME-specific workflow details (Location assignment, room-by-room asset checklist, Tenant-inherited records, Owner review and Staff acceptance). However, the detail page still behaves like a generic task shell: unrelated equipment-inspection content is queried/rendered before the task, generic actions obscure the next step, and secondary panels compete with the core checklist. The experience needs to be organized around the actual Staff job: receive Location responsibility, inspect Owner-confirmed assets, report discrepancies, submit to Owner, then accept the reviewed record.

Deterministic detector: 0 findings across `StaffTaskDetailScreen.tsx`, `EquipmentInspectionPanel.tsx`, `LocationAssetInventoryChecklist.tsx`, and `LocationAssetHandoverSigning.tsx`. The native UI audit reference cautions that this generic detector does not validate React Native behavior; zero findings are not proof of UX correctness.

## Overall Impression

The operational foundation is stronger than the screen communicates. Assignment checks, server-side task transitions, checklist readiness gating, idempotency/version checks, room grouping, inherited records and a two-party acceptance flow are present. The main weaknesses are an unrelated/ambiguous error state, stale task-vs-checklist state, unclear next action and excessive stacked sections.

## What's Working

1. Checklist is grouped by room/common area and shows checked/total progress.
2. Tenant-inherited and previous-Staff provenance are represented; inherited items are not directly editable.
3. Server-side assignment checks, version control, idempotency, Owner rework and signed-report snapshots protect workflow integrity.

## Priority Issues

### [P1] Optional equipment-inspection query appears as a task-level access failure

`StaffTaskDetailScreen.tsx` mounts `EquipmentInspectionPanel` before the task summary for every task. The panel calls `/api/v1/operational-tasks/{id}/equipment-inspection` and renders `QueryState`; the mobile API maps HTTP 404 to the exact generic message shown in the supplied screenshot. This is the strongest source-level explanation, but the actual 404 endpoint was not confirmed with a runtime network trace. The core checklist loading suggests the task/assignment scope itself is likely available. Verify the failing request, gate the optional panel to tasks with a real equipment-inspection record, and represent absence separately from authorization/resource failures. Do not weaken `OperationalTaskService.AccessAsync`.

Suggested command: `$impeccable harden` / `$impeccable clarify`.

### [P1] Task status and checklist status can become stale relative to each other

Task detail uses the cached query in `useStaffTaskDetail`; the inventory checklist uses an uncached query and only refreshes on its own reload or item update. Starting a task updates the parent task detail, but does not refresh the mounted checklist. The checklist save path requires `data.status === 'InProgress'`, so a stale `Assigned` response can block item checks until manual refresh. Invalidate/reload both from the same successful task transition or use one shared cache contract.

Suggested command: `$impeccable harden`.

### [P1] No obvious next action

The fixed footer says `Cập nhật công việc` and opens a generic action sheet. Staff must infer whether to start, continue, report blockers or submit. Replace it with a state-driven primary action: `Bắt đầu kiểm kê` → `Tiếp tục kiểm kê` → `Gửi báo cáo cho Owner`; explain readiness blockers and keep progress/blocker actions secondary.

Suggested command: `$impeccable shape` / `$impeccable clarify`.

### [P2] Detail page has too many equal-weight sections

Equipment inspection, task summary, requirements, checklist, handover placeholder, result, generic evidence and history are stacked. Consolidate duplicated task instructions; make checklist the focal section; show the handover panel only when Owner has reviewed/created the report; collapse history and secondary evidence until requested.

Suggested command: `$impeccable distill` / `$impeccable layout`.

### [P2] Asset condition and evidence are too coarse for responsibility records

The current inventory item primarily stores a checked flag, note and incident link. A checked/not-checked boolean alone does not distinguish intact, missing, damaged or inaccessible assets. Consider a structured Staff inspection result and evidence linked to the specific item/incident. This is a business-data enhancement and should be confirmed before schema/API implementation; it must not imply automatic Staff liability.

Suggested command: `$impeccable shape`.

### [P2] Duplicate incident entry point and technical signing detail

The task header offers a generic asset-incident action while each checklist item offers a context-prefilled incident action. Prefer the item-level action for room/asset traceability, retaining a separate unlinked incident path only if required. Move SHA-256/version details to advanced document metadata; present the human state (Owner reviewed, waiting Staff acceptance, completed) first.

Suggested command: `$impeccable distill` / `$impeccable clarify`.

## Persona Red Flags

- **New Staff / first-time user:** the red 404 banner implies they lack assignment even though the checklist appears available; the generic footer does not tell them what to do first.
- **Busy Staff inspecting many rooms:** must repeatedly expand room and asset rows; lacks a quick filter for unchecked items and a clear next-item action.
- **Successor Staff:** inherited Tenant and previous-Staff records need clearer provenance and an explicit cue for what must be rechecked versus accepted as history.

## Minor Observations

- Staff task list cards expose title, status, location, deadline, requirement preview, priority, evidence and result; reduce card copy to the fields that drive the next action and add inventory progress when available.
- Task detail resolves Location labels from `/api/v1/capture/locations`, while the task list separately queries `/api/v1/locations/assigned-to-me`; unify the source/DTO to avoid inconsistent names.
- Keep the current server-side assignment authorization, Owner-confirmed inventory baseline, Tenant-inherited immutability, and signed snapshot integrity.

## Questions to Consider

- Should Staff inventory explicitly record `Đủ và nguyên vẹn / Thiếu / Hư hỏng / Không thể kiểm tra`, with item-linked evidence, or should condition remain exclusively in incident records?
- Should a room become complete only when every Owner-confirmed item has a Staff result, while inaccessible rooms move to a blocker state for Owner resolution?
