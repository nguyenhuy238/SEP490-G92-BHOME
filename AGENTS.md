# BHOME - Shared AI Agent Rules

## 1. Project Overview
BHOME is a rental and boarding-house management system.

Main roles:
- Owner: Manages properties, contracts, invoices, and finances.
- Staff: Performs authorized operational tasks.
- Tenant: Manages personal tenancy activities.

Backend: .NET REST API.
Database: PostgreSQL.

## 2. General Rules
- Read existing code and relevant requirements before making changes.
- Follow the project's existing architecture and naming conventions.
- Do not invent business rules, API endpoints, or response fields.
- Do not modify unrelated features.
- Do not introduce new dependencies without justification.
- Prefer reusable and maintainable solutions.
- Keep implementations simple and avoid unnecessary abstractions.

## 3. Business Rules
- Enforce role-based and location-based authorization.
- Staff must not access sensitive tenant information.
- Tenant data must only be visible to authorized users.
- Do not store national ID document images unless explicitly required by approved specifications.
- Contract activation must follow backend-confirmed payment rules.
- Meter OCR results require user confirmation.
- Invoice finalization is an Owner-authorized operation.
- Invoice adjustments require the specified approval workflow.
- Temporary residence registration is performed externally via VNeID.
- Owner handles the required residence approval.
- Frontend must not independently determine payment success.

## 4. API Rules
- The .NET backend is the source of truth.
- Follow existing API contracts and DTOs.
- Handle authentication, authorization and validation errors.
- Never hardcode secrets or authentication tokens.
- Do not bypass backend permission checks.

## 5. Change Management
Before coding:
1. Understand the request.
2. Inspect related files and dependencies.
3. Identify affected components and services.
4. Make the smallest reasonable change.

After coding:
1. Run available relevant checks.
2. Verify affected workflows.
3. Report modified files.
4. Report test results and unresolved issues.

Never claim a test passed unless it was executed.

---

BHOME — Repository-Wide AI Engineering Instructions
Applies to the entire SEP490-G92-BHOME repository. Intended for Codex and other coding agents.
Source basis: project reports and working-rule documents supplied on 2026-10-28. This file is a requirements and quality guardrail, not evidence that the repository currently implements every listed feature.
Read this file before planning, editing code, changing a schema, running migrations, or generating tests.

1. Mission and working contract
Build and maintain BHOME — Smart Boarding House Chain Management and Operations Platform accurately, securely, and with traceable tests. Optimize for correct end-to-end business behavior, security, data integrity, and maintainability; do not optimize merely to make a demo pass.

MUST:
1. Identify the relevant BF / FE / UC / GBR / DBR / JOB / NFR before implementing any business change.
2. Inspect the actual repository and existing tests before assuming a component, technology, class, table, endpoint, or state exists. This repository has not been source-audited by the author of this file.
3. Implement the smallest coherent vertical slice, reusing the existing architecture and naming conventions. Do not rewrite unrelated code.
4. Enforce permissions and invariants on the server, not just in the UI.
5. Add or update automated tests, verify normal/alternative/error paths, and report what was actually executed.
6. Never silently invent missing policy, legal rules, external provider behavior, fee formulas, financial thresholds, secrets, or demo results.
7. If documents conflict, use the resolution process in section 3. Clearly flag an unresolved decision; do not disguise an assumption as an approved requirement.
8. Do not log, commit, publish, or send real identity documents, passwords, keys, banking credentials, or sensitive Tenant information to an AI service.
For user-facing text, communicate in Vietnamese unless the task requests otherwise. Code identifiers and API contracts should follow established project naming (normally English). Maintain consistent domain language: Owner, Staff, Tenant, Guest; Location, Room, Contract, Invoice, Payment, Work Order.
2. Documentation map — what is authoritative
Put the supplied original reports in docs/reports/ (preserve originals); Markdown mirrors may be placed alongside them for easier machine reading. Do not treat a file as present unless it exists locally. File names may differ slightly from this index.
Source in docs/reports/	Role in implementation
BHOME_Report-1_Project_Introduction (2).docx (v1.3)	Product purpose, scope, competitive/business context; supplementary background.
BHOME_Report-2_Project_Management_Plan (2).docx (v1.2)	Delivery plan, quality targets, testing gates, risks, team workflow.
BHome_Report-3_Software Requirement Specification (3).docx (v1.3, revisions through 2026-10-19)	Primary requirements baseline: BF-01..BF-07, FE-01..FE-09, UC-01..UC-38, GBR-01..GBR-18, DBR-01..DBR-13, NFRs, roles, status models, JOB-01..JOB-10, open questions.
Report-4_Software Design Specification (4).docx	Design reference: ASP.NET Core/EF Core/PostgreSQL/MinIO, layered backend, authentication, data model, security/performance/recovery. Contains unfinished template sections; verify against source/migrations.
Report-5.0_Test Documentation.docx and Report-5.1..Report-5.5 workbooks	Test plan/case templates for UT, IT, System FR/NFR, Acceptance; not proof of executed tests or product behavior.
Report-6_Software User Guides.docx	User-guide template, not a validated description of current UI.
Report-7_Final Project Document.docx	Capstone report template; example products/scenarios inside it are not BHOME requirements.
BHome_DAC_TA_ACTOR_FEATURE_USE_CASE.docx, BHome_Lam_Ro_ Nghiep_Vu.docx	Supporting business workshops; may be older or internally inconsistent. Cross-check with latest approved SRS.
Quy-tắc-làm-việc-Git.txt	Team Git rules; section 0 has precedence over contradictory examples in later sections.
docs/api/API_CONVENTIONS.md, docs/architecture/*, docs/development/* if present	Repository-local technical conventions; verify they exist and reconcile with code and Report 4.


Source priority: explicit, recorded, approved change decision > applicable/latest SRS business rule and permission matrix > detailed SRS UC/BF/FR (when consistent with the business rules) > approved Report 4 design > Reports 1–2 > workshop notes > templates/examples. This priority does not authorize inventing a resolution where two equally authoritative rules disagree; raise a conflict instead. The implemented code shows current behavior, not automatically the correct requirement.

Before coding, assemble a small traceability note: requested behavior -> source section + UC/GBR/DBR/JOB -> affected classes/data -> acceptance tests. If a required report is missing, disclose the gap rather than assuming its contents.
3. Known conflicts and ambiguity — MUST NOT silently propagate
These findings come from the supplied report versions. When the task touches one of them, document the conflict and obtain a project-owner decision before implementing the disputed branch. Unrelated safe work may continue.
1. Temporary residence / UC-18 / JOB-08: SRS v1.3 permission matrix and GBR-06 say the Tenant performs official registration outside BHOME, the Owner provides/confirms accommodation information, and Staff does not register. However, the UC-18 detailed flow and JOB-08 text still refer to Staff assistance, task updates, or reminders. Never add Staff authority to submit/manage government registration based only on these older steps. Clarify the Staff notification/reminder scope before coding it. BHOME must not submit to VNeID/government APIs.
2. Public Website / UC-37: SRS GBR-17, screen descriptions and explicit MVP exclusions require an information-only Guest site; no Guest enquiry/contact submission, reservation, payment, onboarding, or contract processing. The UC-37 detailed flow incorrectly describes a Guest contact form that stores Guest information. Do not implement this form without a formally approved scope change. An approved static contact phone/email is allowed.
3. DBR-03..DBR-08 table: In SRS §I.3.3 several Enforced On cells do not correspond to their own rule statements. Use each DBR's description together with relevant GBR, actual entity model and constraints; do not implement the mismatched column verbatim.
4. Report 4 completeness: Its database chapter states 39 tables/6 modules/99 FKs, but parts of the document contain placeholders such as table_name3 and incomplete detailed-design sections. Do not assume the live schema matches a claimed count. Inspect EF migrations, DbContext and the current PostgreSQL schema before editing.
5. Report 5/6/7 are largely templates. E.g., Report 5 contains unrelated HR/recruitment sample accounts and entities; Report 7 contains InventoryFlow/MedRecord examples. Never seed or implement these sample businesses in BHOME. The IT/ST sheets include placeholder sheets and broken #REF! cells; do not report sample pass/fail numbers as test evidence.
6. Contract signing: Current SRS GBR-04 and Report 4 require an external Electronic Contract Provider, with signing evidence and no BHOME-issued digital certificate/private key storage. Any proposal for internal draw-signature/OTP signing is a design/scope change, not permission to silently replace this requirement.
7. Open policy questions OQ-01..OQ-08 remain open in SRS v1.3 (see section 12). Never hardcode unapproved deposit deductions, deadlines, reminder cadence, approval thresholds, identity retention, or contact/notification rules.
8. Naming/traceability: Some source content uses Main Tenancy Contract vs Room Rental Contract; certain historical FE names/UC mappings changed. Use the current SRS master UC list and existing code names; explicitly map aliases rather than creating duplicate flows/entities.
If a contradiction affects money, authorization, identity, room occupancy, official residence process, or irreversible state changes: STOP the affected implementation, present options with report references, and request a decision. Do not "pick the most convenient" behavior.
4. Product boundary and access matrix (SRS §I.4.4; GBR-01..03, 17)
- Owner: chain-wide management, pricing, staff assignment, contracts/activation/termination, financial decisions, adjustments, maintenance plan/cost approval and completion verification, reporting/What-if, publication.
- Staff: operational access limited to currently assigned Locations, with predefined permissions; tasks, meter capture/confirmation, permitted onboarding verification, Room handover, incident containment/repair, limited debt follow-up. Cannot decide Owner-only actions; cannot browse deep identity data or full business finance; no temporary-residence registration operation under GBR-06.
- Tenant: own profile, occupancy/contract, confirmed readings, own invoices/payments/debt, requests, incident reports, notifications, and own residence result/evidence. No cross-Tenant access.
- Guest: anonymous access only to explicitly approved non-sensitive public Location/Room information.
- External actors: bank/Payment Gateway, Notification Service, Electronic Contract Provider; Time triggers internal jobs. CCCD OCR and meter OCR are internal capabilities, not external business actors.
- Channels: Owner Web Portal is the primary configuration/management interface in Report 4; Mobile App serves Owner quick monitoring/actions, Staff operations and Tenant self-service; Guest Public Website is read-only information. Do not assume the same operations are available on every client.
Authorization implementation: Authenticate first; determine role and current Location/Room ownership using trusted server state; re-check it for every read/write, lookup by ID, export, upload, search, background job, and downloaded private file. Apply least-privilege response DTOs. Do not trust supplied userId, locationId, tenantId, ownerId or role claims alone to bypass object-level checks. Return an appropriate 401/403/404 policy result without leaking resource existence or PII. Verify negative access cases.
5. Domain rules — non-negotiable invariants
BF-01 — Chain / Location / Room / Asset / rates (UC-04..07; GBR-08)
- Hierarchy: Chain -> Locations -> Room Types -> Rooms; Assets may be assigned to a Room or common area.
- Location/Room ownership, effective-dated rental rates and utility/fee policies, asset condition, and history must remain consistent. Old effective policy versions remain traceable for historical invoices.
- Prevent contradictory occupancy and active overlapping Holding/Main Tenancy Contracts for the same Room/period (DBR-02). Protect against races with database constraints/transactions where feasible.
BF-02 — Staff / shifts / operational tasks (UC-08..12; DBR-01)
- Owner manages Staff accounts, assignments and schedules; routing is based on effective Staff-Location responsibility and the actual eligible assignee.
- Staff sees permitted own shifts and tasks; records progress, blockers and evidence; Owner verifies completion or requests rework. Preserve history and actor/timestamps.
- Out of current scope: Staff-to-Staff task transfer, shift swap and shift handover (revised BF-02). Never reintroduce them from historical changelogs.
- Configured recurring tasks (JOB-06) and deadline reminders (JOB-07) must be idempotent; unresolved assignment must remain visible.
BF-03 / BF-04 — Tenant onboarding, contracts, Room handover, residence, renewal/move-out (UC-13..19)
- One Room may have multiple individually recorded occupants, including co-occupants; identify one representative Tenant where applicable. Do not assume all occupants are contract signers, or force one contract per occupant without verifying the agreed household/friends model.
- Holding Contract: eligible Room + agreed terms + signing + verified Holding Deposit are needed before Active and On Hold. Pending/unmatched payment does not reserve a Room as paid. Expiry/cancellation must preserve transaction/evidence history (JOB-05).
- Main Tenancy Contract: may be created from valid Holding Contract or directly when eligible; track any applied Holding Deposit vs Security Deposit. Require the specified signatures, validated financial conditions and Owner activation before changing the Room to Occupied.
- Only Owner/Tenant are actual signers; Staff can prepare/support within Location scope, never sign for them. Keep provider signing references, status, evidence, document integrity and audit history (GBR-04).
- Move-in handover (UC-17) records Room/assets condition, access/keys, confirmed initial electricity/water readings, supporting evidence and both Staff/Tenant confirmations; use this baseline for move-out.
- On tenancy start, track residence status per actual occupant and actual residence start date; Tenant registers officially outside BHOME; Owner may provide/confirm accommodation information; store status/evidence only as necessary (GBR-06). Staff does not submit/approve residence registration. Handle disputed UC-18/JOB-08 steps per section 3.
- Expiry (JOB-02) initiates renewal or move-out. Renewal/addendum retains history, signed terms and new expiry; Owner confirms applicable decisions. Early termination/move-out requires inspection, final utility readings, outstanding obligations, deposit settlement, relevant payment/refund state and Room release according to approved rules. Do not close/mark Room vacant while mandatory settlement is unresolved, except where an explicitly approved policy says otherwise.
BF-05 — Meter reading and invoice cycle (UC-20..21; JOB-09..10; GBR-07..09)
- Only authorized Staff for an assigned Location can capture readings; meter type is electricity or water. Internal OCR is a suggestion, never an authoritative reading; Staff must confirm/correct, and manual entry remains available.
- Validate meter identity, active/effective meter, initial/previous confirmed reading, monotonicity/replacement exceptions, billing period and evidence. Record OCR proposal separately from confirmed value, confirming Staff and timestamp. Meter photos may be kept as authorized billing evidence; do not confuse with transient CCCD OCR photos.
- JOB-09 creates at most one meter-reading task per Room + utility type + billing period for eligible occupied Rooms; missing meter setup is surfaced to Owner.
- Tenant can view confirmed readings/usage before draft billing. JOB-10 creates Draft Invoice on configured date from confirmed meter usage + time-effective rent, rates and service fees; Tenant reviews. On configured finalization date revalidate data, finalize, set due date, notify. Missing mandatory data keeps an explicit Draft/Pending state; never silently estimate official consumption.
- One finalized periodic Invoice per Contract + billing period (DBR-06). Finalized Invoice is immutable to direct edits (DBR-07); post-finalization correction requires a separate approved InvoiceAdjustment and preserved original.
BF-06 — Bank payments, debt, adjustments (UC-22..25; JOB-01,03; GBR-10)
- Bank transfer is the supported payment channel. Validate transaction authenticity, reference, matching obligation and amount; maintain evidence. Retry/callbacks are idempotent, with unique external event/transaction keys and transactional allocation. Never double-credit a Payment, Invoice or deposit.
- Handle exact payment, partial/underpayment, overpayment, unmatched/ambiguous transaction and technical failure explicitly. Owner has a documented manual verification fallback. A screenshot alone is not automatically proof of bank settlement.
- Outstanding = legitimate payable balance minus verified allocations/approved adjustments (according to implemented approved model). Overdue status/days use the configured due date and local-time policy; reminders are deduplicated per window. Staff receives only operational follow-up data in assigned Locations.
- Tenant can request Invoice Adjustment; Owner decides. Before finalization, an approved change may update Draft; afterward, create an Adjustment record and recompute the balance without rewriting the finalized Invoice.
- Refunds, excess balances, Tenant Credit, Security Deposit deductions, payment allocation and final settlement must remain reconciled and traceable. Do not assume unapproved automatic refund deadlines, interest, priority or deduction policy (OQ-01/02/05).
BF-07 — Incident, Emergency, maintenance (UC-26..30; GBR-11..12)
- Tenant/authorized Staff submits report scoped to Location/Room/Asset with severity Normal or Emergency, description and allowed evidence. No autonomous AI report classification or automated repair-cost approval in MVP.
- Normal: Owner reviews, classifies, rejects/marks duplicate if appropriate or assigns one/more eligible Work Orders; Owner can also resolve directly with evidence.
- Emergency: immediately notify Owner and eligible Staff at that Location; Staff acknowledges and records safe containment/first-response actions with append-only entries. Formal Owner review still follows; life-safety emergency guidance directs users to public emergency services first.
- Work Order lifecycle follows SRS: Assigned -> Pending Approval -> In Progress -> Pending Verification -> Verified (plus permitted rejection/rework/cancellation branches). Staff inspects and proposes time/cost; Owner approves plan/cost; Staff executes with progress/before-after evidence; Owner verifies and may request rework.
- Link actual maintenance cost to Work Order, Location/Room/Asset and OperatingExpense; update Asset state and maintenance history. Resolve the Incident only once all related required Work Orders are Verified, or under a documented Owner-direct resolution branch. Retain invalid/duplicate/cancelled history and decision reasons.
- Applicable incident evidence supports up to 5 images of at most 5 MB each per SRS NFR; validate MIME/content, authorization and storage access.
FE-07..FE-09 — Tenant self-service, Owner finance, Public Website (UC-31..38)
- Tenant views only own records; persistent in-app notification survives external push/email failure (JOB-04). Notifications must be scoped and deduplicated, without raw identity or unnecessary financial details.
- Owner manages initial investment and categorized OPEX by Location; reports include occupancy, verified revenue, debt, cost, operating profit, capital recovery, estimated payback. Keep source amounts, periods and assumptions auditable.
- What-if Scenario must never mutate actual prices, contracts, invoices, payments, investment or OPEX (GBR-15); label projections as internal management estimates, not statutory accounting/tax advice (GBR-16).
- Public Website shows only Owner-approved non-sensitive information (Locations, Rooms, approved photos, amenities, indicative price, vacancy, static contact details); no Guest data capture/booking/payment/contract.
6. Technology/architecture guardrails (Report 4; verify the repository)
Current documented design: ASP.NET Core 8, ASP.NET Core Identity + JWT, Entity Framework Core, PostgreSQL 16, private MinIO / S3-compatible object storage, REST/JSON/HTTPS, internal meter/CCCD OCR, scheduled jobs and external provider adapters. Owner Web Portal + Mobile App + read-only Public Website are the documented clients. Do not change a working project's actual framework/library versions merely because the report names an older baseline.
- Prefer current existing modules and layering. Expected backend responsibility flow: Controller -> Application Service / Use Case -> Repository / DbContext; infrastructure adapters implement external-provider/OCR/storage concerns. Keep domain policies out of controllers and UI.
- Controllers: auth/policy entry, binding, request validation, correct HTTP status, small DTOs. Services: authorization, state transitions, business calculations, transaction orchestration. Repositories/data access: persistence/query only. Never let UI or controller bypass critical service invariants.
- Maintain existing interface and class naming (*Controller, *Service, *Repository) when present. Follow docs/api/API_CONVENTIONS.md and actual solution layout if available. Do not invent an endpoint or interface before searching for an existing one.
- Use dependency injection, async I/O + CancellationToken, precise exceptions and error response mapping. Avoid async void, swallowing exceptions, broad catch with success return, Task.Result, or loading full tables in memory.
- Use EF Core migrations for schema changes. Never edit a production schema ad hoc. Use FK/index/unique constraints for actual DB invariants; EF transactions for multi-record financial/contract updates; use optimistic concurrency or locking for competing payment/room changes.
- Use decimal for money/quantity requiring exact arithmetic; not binary float. Specify currency rounding and rate precedence per approved policy. API amounts, stored amounts and UI display must agree.
- Read-heavy APIs should use projected DTOs, AsNoTracking, server pagination/filtering and appropriate indexes; avoid N+1 and serial external calls in a hot request.
- Store files privately; DB stores object keys/references, not public unrestricted URLs. Upload failures must not leave business rows pointing to missing objects; recover orphan uploads. Authorize every download. Do not place identity OCR images into permanent object storage.
- If changing technology/provider, write an ADR/design note explaining why, migrations, compatibility, rollback, tests and documentation impact, and obtain approval first.
7. Security, privacy and identity processing (GBR-01/02/04/07/13; NFR)
- Mandatory: validated authentication, server-side object/Location-level authorization, Tenant isolation, least-privilege DTOs, TLS/HTTPS, input/filename validation, SQL injection prevention, secure secret management, no sensitive information in logs, traces, public endpoints or notifications.
- Passwords use ASP.NET Core Identity's password hashing, never reversible encryption or plaintext. Report 4 documents signed JWTs (HS256 secret >=256 bits), access-token lifetime 30 min, rotating refresh tokens (7 days), SHA-256-hashed server-side refresh-token storage, validation of issuer/audience/expiry/security stamp. Follow existing auth implementation unless modifying it through reviewed change.
- Report 4: Staff Location assignments are checked server-side on each request, not frozen into token permissions. Mobile refresh tokens belong in secure OS storage; web refresh tokens use HttpOnly/Secure/SameSite protections where that authentication mode is implemented; assess CSRF when cookies are used.
- CCCD OCR: accept the image only for transient processing; perform internal OCR -> human confirmation/correction -> persist only necessary confirmed identity fields and verification metadata; delete transient images including temp files/queues/caches after processing. Never store CCCD image in MinIO as permanent evidence or reuse real CCCD images for tests.
- Protect persisted CCCD fields with strict access controls/masking. Cryptography hardening requiring approval: if implementing at-rest field encryption, prefer authenticated encryption with externally protected/rotatable keys; use keyed HMAC or another approved lookup method for exact-match search where needed; do not simply SHA-256-hash low-entropy CCCD identifiers, nor hash data that must later be displayed. The supplied Report 4 does not finalize a field-encryption/key-management design; record that as a design decision rather than claiming it already exists.
- Audit high-impact actions: authenticated actor, time, action, scoped target, decision/reason and safe before/after references. Append-only AuditLog; redact secrets/PII and preserve audit integrity. Ordinary work progress belongs in task/work history.
- Never push .env, connection strings, passwords, JWT secrets, signing keys, provider credentials, bank keys, real user data, production backups or private images. Use .env.example with placeholders.
- Use synthetic/anonymized data for all automated tests and demos. No real personal information in fixtures, sample prompts, screenshots or third-party AI calls.
8. Background jobs, integrations and state consistency
Documented job inventory: JOB-01 overdue Invoice reminders; JOB-02 Contract expiry; JOB-03 bank reconciliation retry; JOB-04 notification delivery retry; JOB-05 Holding Contract expiry; JOB-06 recurring operational tasks; JOB-07 task deadlines; JOB-08 temporary residence reminders (disputed recipients/cadence); JOB-09 meter-reading task creation; JOB-10 draft/final invoice cycle.

For each job/provider callback:
- Define idempotency/business key, event state, retry window, race behavior, transaction boundary, error/compensation path and observability. Do not rely only on an in-memory "already processed" flag.
- Re-read current state immediately before a transition; ensure repeated/parallel runs do not duplicate financial effects, state transitions, tasks or notifications (GBR-18).
- Distinguish a transient external outage from a business rejection. Retry with bounded backoff; after the safe limit, record an explicit Pending/Manual Review state with operator visibility.
- Bank webhooks must validate origin/signature (as applicable to the selected provider); avoid acknowledging success before durable processing/idempotent persistence.
- Notification delivery failure must not roll back a committed contract/payment/incident event; use persistent in-app notifications and retryable delivery (outbox or equivalent is recommended if compatible with the repo).
- External Electronic Contract Provider failures leave contracts in a pending-signing state; do not activate based only on a sent request.
- Capture event timestamps in UTC and evaluate configured business dates/reminders in Asia/Ho_Chi_Minh to avoid off-by-one-day billing, overdue and contract-expiry errors.
9. Coding, change-control and review standards
1. Before edits: git status, current branch, existing conventions and related tests. Respect pre-existing user changes; do not reformat or revert unrelated work.
2. Write a minimal plan if a change spans >1 layer or affects data/status. Map acceptance criteria and negative cases before code.
3. Follow existing .NET naming, DI, nullable-reference handling, error strategy and logging; avoid speculative abstractions, dead code, duplicate business logic, magic numbers and hidden authorization checks.
4. Validate at request boundary and domain/service boundary; reject invalid status transitions and negative/impossible amounts; do not trust client-calculated totals.
5. Build and test before committing; do not assert success for checks that were not run. Record failed commands, causes and limitations.
6. Changes to BF/UC/policy/state/ERD/API require a matching doc update (or an explicitly reported discrepancy) and regression tests.
7. No direct push to main or develop. The team Git document §0 requires one personal member/<name> branch per contributor; use that branch for commits and PR to develop. Only Team Leader merges develop into main after passing integration/release checks. This supersedes older feature/* examples in the same Git document unless Team Leader approves a different process.
8. PR needs another person's review, passing CI/build/tests, no critical defects/conflicts or leaked secrets. Use descriptive commits like feat(invoice): ..., fix(contract): ..., test(payment): ..., docs(srs): .... Do not perform merges/pushes unless specifically authorized in the current task.
10. Testing and quality gates (Report 2 + Report 3 NFR + Report 5 templates)
Every business change requires tests that could catch a wrong implementation, not just a happy-path test. Adapt test runner/commands to the actual repo; the example commands below are not proof of working scripts.
- Unit: pure domain services, validators, state transitions, rounding, rate effective dates, role rules, OCR proposal vs human confirmation, What-if isolation. Mock provider boundaries, not domain decisions.
- Integration: EF Core/PostgreSQL constraints/migrations, real repositories, provider/webhook idempotency, transactions, object storage, job retries, authorization policies. Test against isolated disposable DB/environment where feasible; never production data.
- System/E2E: Owner/Staff/Tenant/Guest flows across clients, authorized vs unauthorized Locations/Rooms, draft->final->paid billing, signing/activation, move-out settlement, emergency->Work Order->verification, and public read-only boundary.
- Acceptance: user-observable given/when/then for UC + business rule, with role, preconditions, expected state/evidence and rejection behavior; maintain corresponding Report 5 template evidence.
- Security: IDOR/cross-Location, cross-Tenant data isolation, token expiry/revocation, public API leaks, attachment access, webhook authenticity, sensitive logging, injection/overposting, dangerous file types.
- Failure/concurrency: duplicate/parallel callbacks, double issuance, repeated JOB-09/10, bank over/underpay, incomplete OCR, provider downtime, partial file upload, transaction rollback, stale Contract state, concurrent Room hold.
- Test data: UT/IT must be self-contained and independent; no reliance on previous tests or sequence-dependent IDs, no hardcoded real identity details.
Project's planning/acceptance targets (not claims of achieved results):
Measure	Target/source
Core-service/business-logic UT coverage	>=70%, Report 2 quality plan (prioritize critical finance, access and contract state paths).
IT, ST and AT pass rates	>=95% each; 100% of critical integration scenarios pass.
Open critical security/cross-property isolation defects	0; no open Critical/Major review defect at milestone.
Normal API response	p95 <=2 s for ordinary requests (external provider latency excluded).
Owner dashboard summary	<=5 s at evaluation scale.
Concurrent sessions	At least 100 in the evaluation environment.
Internal OCR proposal or fallback	<=10 s** evaluation target; meter OCR accuracy goal **>=90% on >=50 images (Report 2).
Bank reconciliation prepared-scenario match rate	>=95% target with manual fallback.
Data recovery	Daily backup, RPO 24 h / RTO 8 h targets.
UX conventions	Vietnamese MVP UI, VND (no decimal display), dd/MM/yyyy, Asia/Ho_Chi_Minh.


Never fabricate coverage, performance, pass rates, snapshots, or defect statistics. If no tool/environment is available, say NOT RUN and describe what remains to be verified. Do not treat template workbook numbers as actual results.
11. Mandatory workflow for every AI implementation task
Step A — Understand: identify user goal, affected roles, BF/FE/UC IDs, GBR/DBR, state transitions, NFR and unresolved OQs. Read the relevant sources and code. Inspect current git changes.

Step B — Analyze: write compact acceptance criteria (positive, negative, permissions, failure/retry, idempotency, audit). Identify conflict vs source and current code. If a high-risk rule is unresolved, stop only that disputed implementation and report the blocker.

Step C — Design: map endpoint/DTO -> controller -> service/use case -> repository/DbContext -> tables/migrations -> integrations -> tests. Explain transactions, authorization, timestamps and unique keys for stateful/financial changes. Choose minimum change consistent with current architecture.

Step D — Implement: preserve backward compatibility unless expressly changed. No silent new endpoints, roles, statuses, tables, external providers or business rules. Keep business invariants enforced centrally and error states visible.

Step E — Verify: execute relevant build, format/lint, UT/IT and migration checks; inspect diffs; add negative and concurrency tests; review security/PII and audit fields. Do not make unrelated changes just to get a green test run.

Step F — Report: final answer should state: requirement IDs + source, files changed, behavior and authorization implemented, tests executed with results, migrations/configuration steps (if any), known blockers/conflicts, and what is not verified. Do not claim full business compliance after a narrow change.
Suggested task response format
Scope: BF-xx / UC-xx / GBR-xx / NFR-xx
Source checked: [relevant report section + existing files]
Acceptance criteria: [normal, error, permissions, data effects]
Decision/conflict: [none / documented issue + approval needed]
Change summary: [affected layers, migration, integrations]
Verification: [exact commands + PASS / FAIL / NOT RUN]
Risks/remaining: [specific, no guesswork]
12. Open Questions from SRS v1.3 (DO NOT ASSUME ANSWERS)
- OQ-01: exact Security Deposit deductions and final move-out settlement when debt/damage remains.
- OQ-02: adjustment categories and Owner-approval thresholds.
- OQ-03: Holding Contract validity and Holding Deposit payment deadline.
- OQ-04: Normal/Emergency incident acknowledgement and response-time targets.
- OQ-05: charging Tenant-caused damage vs Invoice Adjustment, new charge or deposit deduction.
- OQ-06: Staff compensation inputs for Owner financial models.
- OQ-07: Tenant identity retention/deletion/anonymization after contract end.
- OQ-08: whether co-occupant email is mandatory and who receives billing notifications.
Also verify the conflicting UC-18/JOB-08 and UC-37 text described in section 3. Until resolved, prefer the safety-preserving non-Staff residence-registration boundary and read-only public-site boundary in the explicit SRS business rules; report any missing functional behavior transparently.
13. Hard exclusions — do not add without approved scope change (SRS §V.3.3)
No Guest enquiry/online reservation/payment/contract on Public Website; no cash-payment recording; no full IoT/smart-lock/meter hardware integration; no statutory accounting/payroll/tax filing or e-invoice compliance; no direct government residence submission; no BHOME CA/digital certificate/private signing keys; no autonomous AI pricing, forecasting, report classification, chatbot or biometric camera recognition; no advanced cross-Location tenant/contract-holder transfer. Internal assisted OCR with human confirmation is in scope.
Final rule: When requirements, design, and code disagree, show the discrepancy and preserve data/security; never quietly adjust the business requirement merely to match existing code or a generated guess. An implementation is not Done without traceability, authorization, meaningful tests, review-ready changes and an honest verification report.
