# Configuration implementation validation

Scope: GAP-001–008 and the approved 2026-11-09 shared-library/copy extension.
All PostgreSQL writes use randomly named disposable databases inside dedicated
loopback Docker PostgreSQL 16 containers. The working BHOME database was not used.
Temporary credentials are generated at runtime and restored/removed after each run.

## Executed checks before documentation handoff

| Check | Passed | Failed | Skipped | Evidence |
| --- | ---: | ---: | ---: | --- |
| Application unit suite | 369 | 0 | 0 | `.tmp/config-final-unit/*.trx` |
| Domain unit suite | 106 | 0 | 0 | `.tmp/config-final-unit/*.trx` |
| Owner Web complete suite, Node 22 | 205 | 0 | 0 | `.tmp/config-final-web-tests.log` |
| Mobile complete suite, Node 22 | 851 | 0 | 0 | `.tmp/config-mobile-node22-tests.log` |
| Owner setup/shared/store/refund/finance subset | 42 | 0 | 0 | `.tmp/config-fixed-integration-final/*.trx` |
| Final expanded configuration/refund/finance subset | 44 | 0 | 0 | `.tmp/config-phase10-44/*.trx` |
| Configuration/refund/finance with deactivation replay | 45 | 0 | 0 | `.tmp/config-phase10-45/*.trx` |
| Additional apply rollback/archive/overlap plus runtime-export checks | 3 | 0 | 0 | `.tmp/config-export-test-final/*.trx` |
| Initial broad Compact24 regression | 249 | 9 | 1 | `.tmp/config-final-integration/*.trx` |
| Baseline migration reproduction, audited HEAD 919c208 | 9 | 3 | 0 | `.tmp/config-baseline-migrations/*.trx` |
| Broad Compact24 regression before final retry correction, d4388a3 | 257 | 3 | 1 | `.tmp/config-final-regression/*.trx` |
| Final broad Compact24 regression, b9cff65 | 258 | 3 | 1 | `.tmp/config-delivery-regression/*.trx` |
| Final Owner Web complete suite, Node 22 | 206 | 0 | 0 | `.tmp/config-final-web-206.log` |
| Final Application unit suite | 369 | 0 | 0 | `.tmp/config-delivery-unit/*.trx` |
| Final Domain unit suite | 106 | 0 | 0 | `.tmp/config-delivery-unit/*.trx` |

The initial broad run found six authentication failures in existing refund/finance
tests: their login used a different synthetic password from WorkflowTestUsers.
The tests now use that fixture's established password and the relevant subset passes.
No payment/refund/finance production rule was changed.

Three historical source-to-Compact24 migration tests fail in both the current tree
and an untouched detached worktree at the audited baseline:

- CompleteCopyPreservesConfirmedHandoverAndFinalInspectionBaselines.
- CompleteCopyPreservesContractSignaturesHandoverMoveOutAndSettlementHistory.
- CompleteCopyPreservesActualPdfSigningDirectoryAndDocumentEvidence.

They report Compact24MigrationException during reconciliation. Historical migration
code and schema were left unchanged. These failures prevent claiming full regression
acceptance. The independence test requires BHOME_COMPACT24_QUERY_LOG with server
statement logging and parameter logging disabled; it remains explicitly skipped.

The first Mobile run under global Node 24 had 839 passed/12 failed in expoStartup.
The supported repository runtime is Node >=22.13 and <23. Re-running under local
Node 22.23.4 passes all 851 tests. An initial Owner Web run had 204 passed/1 failed
because its prototype test had not explicitly selected mock mode. That test now
selects mock mode; the full suite passes. These earlier failures are retained here
as diagnostic evidence, not included in a fabricated combined pass rate.

Backend and Owner Web builds passed; backend reports zero warnings/errors. Mobile
typecheck/lint, Owner Web typecheck/lint and shared-client lint passed. Vite retains
the existing warning about bundles larger than 500 kB. No new dependency was added.

## Coverage established

Tests exercise document-specific policy history, strict obsolete-field rejection,
exact decimal serialization, persisted native setup, Location/role boundaries,
catalog snapshots, all shared lifecycles, immutable editions, duplicate names/items,
source/target changes, pure previews including no audit writes, parallel edits,
parallel apply/copy idempotency, different-payload key rejection, provenance, and
rollback after synthetic late failures. Applying/copying preserves independent
target configuration and does not create physical Assets, Rooms or contracts.

UI checks use real typed client serialization with controlled transport responses.
PostgreSQL tests separately execute the real HTTP endpoints and persistence. These
checks do not establish live browser/device acceptance or production provider behavior.
Performance/coverage percentages, real-bank/provider acceptance, OCR accuracy and
the query-log independence check were NOT RUN in this configuration task.

## Reproduction

Run `scripts/Test-Compact24Isolated.ps1` with the intended test filter; it creates and
cleans its own PostgreSQL instance. `-TestProject` permits an explicit baseline test
project while preserving that isolation. Never substitute the working database.
Use Node 22 for frontend tests; run Vitest from each application's directory.
The final implementation report records the final broad rerun and commit inventory.
