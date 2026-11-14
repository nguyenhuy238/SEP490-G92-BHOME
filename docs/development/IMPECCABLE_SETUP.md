# Impeccable for BHome Owner Web

Impeccable is a development-only design tool, not a frontend runtime dependency. The project-local skill in `.codex/skills/impeccable/` matches the installed ChatGPT plugin (skill 4.3.1, engine 0.1.5). The bundled Windows and POSIX launchers and playbooks are retained with the upstream Apache-2.0 license. The supporting browser scripts and font index come from the upstream `skill-v4.3.1` tag.

## Windows PowerShell

From the repository root:

```powershell
$env:IMPECCABLE_NO_TELEMETRY = '1'
& .\.codex\skills\impeccable\scripts\impeccable.cmd engine-probe

Set-Location src/owner-web
$launcher = '..\..\.codex\skills\impeccable\scripts\impeccable.cmd'
& $launcher context --target src/features/locations/pages/LocationApiWorkspace.tsx
& $launcher detect --json src
```

Run context from the Owner Web directory so it resolves that application's `PRODUCT.md` and `DESIGN.md`, not the separate Public Web or Mobile surfaces.

For a reproducible report, from Owner Web:

```powershell
& $launcher detect --json src |
  Out-File -Encoding utf8 ../../.tools/impeccable-owner-web-detect.json
```

The default launcher downloads a missing version-pinned engine from the official GitHub release and checks its SHA-256 sidecar before execution. Its cache is outside the repository under the user profile by default. If download or verification fails, diagnose the network, release or antivirus warning; do not bypass checksum verification.

## Workflow

- Read the business requirements and existing UI before selecting a design direction.
- Load context once per design session, then use the relevant playbook (e.g. `shape`, `critique`, `layout`, `audit`, `polish`).
- After implementing the UI, run the detector and review each finding against the actual MUI tokens, component behavior, and approved design intent.
- Verify actual rendered pages with Playwright at relevant viewport sizes, and run frontend typecheck, lint, tests and build. A successful detector execution is not a usability or regression-test pass.

No automatic agent hook has been enabled. This keeps scanning explicit and avoids changing other agent configuration. Codex hook activation and live browser integration are separate opt-in setup steps. The vendored skill is excluded from BHome's ESLint and Prettier checks so upstream scripts and documentation remain intact.

## Installation verification (2026-11-13)

- Windows `engine-probe`: exit 0, `impeccable-engine 0.1.5`.
- `context --target src/features/locations/pages/LocationApiWorkspace.tsx`: exit 0; target exists, project root resolves to `src/owner-web`, both product and design files loaded.
- `detect --json src`: exit 0; 126 findings (123 advisories, 3 warnings). The baseline is in the ignored local `.tools/impeccable-owner-web-detect.json`. Findings require review, not automatic edits.
- The context loader reported no separate surface brief and no automatic hook. It also reported that skill 4.9.0 is available; the installation remains pinned to 4.3.1 to match the active plugin. An upgrade is a separate action.

Upstream: https://github.com/pbakaus/impeccable
