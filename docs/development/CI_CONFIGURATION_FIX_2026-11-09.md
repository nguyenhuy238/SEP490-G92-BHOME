# CI configuration regression fix — 2026-11-09

Source baseline: `cacf8450b692882cd79f184568194ddaf8bf6bef`, branch `member/QHuy`.
Reported workflow: GitHub Actions run `42571304699`, backend/frontend jobs for PR 66.

## Causes and fixes

The local Release solution test reproduced the reported integration result exactly:
28 failed, 533 passed, 260 skipped. The explicit legacy test composition removed
Compact24DbContext but retained the newly registered shared configuration services.
Service-provider validation consequently failed before the affected tests could run.

The legacy fixture now removes the Compact24-only shared store, validator, library,
application and Location-copy services alongside its existing native workspace
exclusions. Production registration is unchanged. PersistenceCompositionTests checks
both valid dependency graphs and explicitly verifies that those five services are
available only in the Compact24 composition. No assertion, test or CI gate was disabled.

The frontend format check reproduced the eight Markdown violations from the reported
job. These files now follow the repository Prettier configuration. The API inventory
generator formats its output with the existing Prettier dependency/configuration,
so regenerating the inventory no longer reintroduces the violation.

The backend's subsequent format gate also found C# whitespace violations, concealed
by the earlier test failure. They were corrected with dotnet format. These changes
do not alter business rules, schema, authorization or production service behavior.

Traceability: repository change-management/testing requirements and GAP-007/008.
Affected components: legacy test composition, composition regression assertions,
generated API documentation and formatter compliance. No new business decision,
dependency, migration or working-database change is involved.

## Verification

Validation uses isolated Linux containers, a fresh archived source snapshot with the
reviewed patch, .NET SDK 8 and Node 22. The backend uses Docker Testcontainers with
the same PostgreSQL/MinIO/converter images as the workflow. The frontend starts with
`npm ci --no-fund --no-audit` and the workflow's synthetic API base URL.

Commands mirror `.github/workflows/ci.yml`: restore, Release build/test, dotnet format,
npm install/lint/test/build/format, and quiet Compose configuration validation.
No CI step was skipped to make the change pass. Existing tests that require optional
Compact24 credentials, models or query logging retain their declared skip conditions.

Frontend Linux results: clean npm install, repository lint, all 206 Owner Web tests,
all 851 Mobile tests, workspace builds and repository format check passed. Compose
configuration validation also passed. The existing Vite bundle-size notice remains
a warning; it does not fail the build.

The first Linux backend harness used sibling Docker containers through
host.docker.internal. That reproduced six harness-only failures: loopback-only
development tools correctly rejected that hostname, and the converter could not see
the runner's temporary files through the sibling daemon. Verification therefore
uses an isolated nested daemon with the runner sharing its loopback network and
temporary directory, matching a native Linux runner. No application guard was relaxed.

The final Linux Release integration suite passed: **561 passed, 0 failed, 260
skipped** (821 total). Application tests passed 369/369 and Domain tests 106/106.
The 260 skips are the existing optional-environment cases, unchanged from the
reported workflow; they are not counted as passes. The separate composition
regression passed both legacy and Compact24 cases.

All backend restore/build/test/format steps and frontend install/lint/test/build/format
steps returned exit code 0 in the final Linux checks. Both image builds and the
Compose config command also returned 0. The Release build had zero warnings/errors.

Reproduction commands:

```sh
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.sln -c Release --no-restore
docker build -f deploy/docker/Minio.Dockerfile -t bhome/minio-local:2025-10-15 .
docker build -f deploy/docker/ContractConverter.Dockerfile -t bhome/contract-converter:local .
dotnet test src/backend/BHome.sln -c Release --no-build --logger trx
dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
npm ci --no-fund --no-audit
npm run lint
npm test
npm run build
npm run format:check
docker compose --env-file .env.example config --quiet
```

Local evidence is retained in `.tmp/ci-linux-frontend`, `.tmp/ci-linux-backend-final`,
`.tmp/ci-composition-after`, `.tmp/ci-final-format.log` and `.tmp/ci-lint-after.log`.
The final containers use synthetic data and are separate from working services.
No remote push, workflow modification or manual pass override is part of this fix.
