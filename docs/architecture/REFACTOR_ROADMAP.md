# BHOME - Code simplification roadmap

Branch: `refactor/bhome-simplification`. Baseline: `db721d69` (member/THuy). Baseline full CI is not yet verified.

## Goals
Preserve approved business behavior, API contracts, data integrity and security. Reduce duplication, obsolete code and unnecessary indirection. Optimize for student comprehension, not file count. Keep the existing four-layer backend and frontend stacks.

## Phases
- [ ] P0: Establish baseline: build, relevant tests, CI status, API/state inventory; record pre-existing failures.
- [ ] P1: Audit files and dependencies; classify KEEP, DELETE, MERGE, SIMPLIFY, ARCHIVE, REVIEW with evidence and risk. Inspect DI, routes, jobs, reflection, scripts, migrations and clients.
- [ ] P2: Remove verified unused code and redundant configuration; preserve migration history and useful tests.
- [ ] P3: Refactor backend by business module: property/rooms/assets, holding, contracts, move-in, meters, billing, payments, move-out, settlement, incidents/tasks, jobs, authentication review.
- [ ] P4: Simplify Owner Web and Mobile per module; remove unnecessary wrappers and duplicated API logic; preserve UI behavior.
- [ ] P5: Consolidate human-readable business-flow guides: actors, prerequisites, steps, endpoints, classes/methods, tables, exceptions, final states, SRS traceability. Update diagrams.
- [ ] P6: Run regression and CI; review with team before merging.

## Per-module acceptance
1. Map current behavior and source entry points before edits.
2. Identify exact simplifications, dependencies and risks.
3. Preserve authorization, version checks, transactions, idempotency, evidence and verified payment reconciliation.
4. Prefer existing files; justify new abstractions. Do not create giant services merely to reduce file count.
5. Run focused tests and formatting; full CI before merge. Record actual results, not assumptions.
6. Update flow documentation and commit the module separately.

## Boundaries
No DB data deletion, migration squashing, new feature work, deployment or merge into develop without separate approval. Do not remove compatibility paths until persisted data and consumers are verified. Pending meter correction requirements and unverified activation-only regressions are not completed by this roadmap; establish their status at baseline and keep behavior changes separate from refactoring.
