# Owner Web integration checks — 2026-11-09

The implementation follows the Owner scope in the supplied implementation request (groups 07–25), the existing audit at `d13525f`, local API DTOs and the root/Owner Web agent rules. See each stage's API/development note for UC/GBR mapping and remaining policy/provider decisions.

## Integration hardening

- API workflows for Staff, Residents, Tasks, Incidents, Work Orders and Public Content use the authenticated backend. Demo components remain behind the existing explicit API/mock branch. Contract, billing, payment, adjustment, residence and finance panels are reused.
- Query caches and local page state are recreated when the authenticated user, session ID or effective roles change. Access-token refresh with the same session does not recreate the workspace. Cleanup cancels/disposes the previous QueryClient. Demo mode remains independent of authentication.
- Owner commands retain idempotency keys after uncertain responses and retire confirmed intents after successful work and invalidation. Versioned decisions use the version that was reviewed; the backend remains authoritative.
- Holding uses a dedicated draft payload sharing only participant/date/term validation with Main. It never requires or fabricates Main rent. The regression catches the earlier zero-rent validation bug. Expiry input is converted from Asia/Ho_Chi_Minh to UTC; activation still depends on backend readiness.
- Meter query tests use `.test.tsx`, matching the repository's configured Vitest include pattern. Both filter/pagination tests now actually run.
- Errors for common responsibility, incident and public publication blockers are translated. Downloads remain authenticated; unpublished public photos require Owner publication permission.
- Announcement creation now supports actor-scoped idempotency keys with transactional PostgreSQL locking and changed-input conflicts. Owner-only persisted draft recovery survives page refresh; send continues to use the stored announcement ID. Existing clients without a key remain compatible; no schema was added.

## Executed checks

- Final Owner Web full suite: 228 passed / 41 files. Holding/session/key/meter selection passed 16 tests; notification/key selection passed 7 tests.
- Owner Web lint and API-mode TypeScript/Vite build: passed. Vite still warns about bundles above 500 kB; no performance claim is made.
- Mobile shared-contract compatibility under Node 22.23.4: 851 passed / 67 files; Mobile typecheck passed.
- Backend Domain unit tests: 106 passed. Application unit tests: 373 passed.
- Disposable PostgreSQL broad integration selection (`Compact24` or `IncidentApiTests`): 280 passed, 3 failed, 1 skipped, 284 total. The three failures are legacy migration fingerprint reconciliation tests, reproduced at the initial commit in a separate detached worktree. The worktree was removed after comparison. No operational DB was reset, seeded or migrated.
- The skipped independence test explicitly requires SQL statement logging with parameter logging disabled (`BHOME_COMPACT24_QUERY_LOG`); the normal disposable runner does not configure it.
- New synthetic Resident administration/scope and unpublished-photo permission tests passed within the broad run. Incident integration also passed separately (19 tests). Object storage in these fixtures is a memory substitute.
- Final announcement recovery integration selection: 12 passed, including concurrent create replay, actor separation, changed-payload conflict, recovery authorization, send deduplication and replay after send.

The detailed completion matrix, exact blocker evidence, commands and 17 user E2E workflows are in `BHOME_OWNER_WEB_IMPLEMENTATION_REPORT.md`. Full browser/Mobile/business E2E, real MinIO, bank/provider callbacks, real production signing and external notification delivery have not been established by these checks.
