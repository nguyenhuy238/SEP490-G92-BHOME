# Contributing to BHOME

Use small feature branches from the team's agreed integration branch and open a pull request into
`develop` (or the release branch specified by the team). Protect `main` and review changes before
merging. Do not change another developer's branch or rewrite shared history. The initialization
work is deliberately left uncommitted on `init/project-setup/QHuy`.

Coordinate ownership of migrations, root package manifests, role constants, and shared composition
files. Keep changes inside a module where possible; add a module DI extension when registrations
grow. Before creating a migration, synchronize the agreed model and agree on its ordering with the
team. Do not edit migrations already applied to a shared environment.

Use strict TypeScript, nullable C#, small services, explicit DTOs and cancellation tokens. Controllers
delegate to application services; EF Core belongs in Infrastructure. Follow
[module placement](docs/architecture/MODULES.md) and [API conventions](docs/api/API_CONVENTIONS.md).

Before a PR, run backend restore/build/tests, client lint/tests/build and formatting. Run container
tests when Docker is available and disclose skipped checks in the PR. CI runs the full container
suite. Add behavior tests for meaningful changes, especially scope isolation, financial effects,
callbacks and job retries. Keep external services stubbed in tests.

Never commit `.env`, tokens, database dumps, personal CCCD images, provider credentials, private
signing keys or sensitive logs. Review `git diff` and `git status` before staging. Only non-sensitive
configuration belongs in appsettings or browser `VITE_*` variables.

Commit messages use `<type>(<module>): <description>`:

```text
feat(payment): implement bank reconciliation
fix(invoice): correct electricity calculation
test(contract): add contract validation tests
docs(readme): update project setup guide
chore(setup): configure local infrastructure
```

PR descriptions explain the concrete behavior, validation performed, schema/configuration changes,
and remaining limitations. Do not claim unrun checks passed. Business workflows must follow the
finalized SRS/data model; an adapter must never pretend an external operation succeeded.
