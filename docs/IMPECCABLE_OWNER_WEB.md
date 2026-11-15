# Impeccable Live — BHOME Owner Web

The project already contains the Impeccable skill and its Windows launcher at
`.codex/skills/impeccable/scripts/impeccable.cmd`. Use the root-level wrapper
`scripts/impeccable.cmd` to run it consistently from any terminal directory.

The Owner Web is a **React / TypeScript / Vite** application. Its Live mode is
configured in `src/owner-web/.impeccable/live/config.json` for the Vite HTML
shell (`index.html`). Impeccable's project context is in
`src/owner-web/PRODUCT.md` and `src/owner-web/DESIGN.md`.

## Start a live editing session

In the first terminal, start the frontend **only if it is not already running**:

```powershell
npm run dev --workspace ./src/owner-web
```

In another terminal, from the repository root:

```powershell
.\scripts\impeccable.cmd live --target src/owner-web/src/features/finance/FinanceHomePage.tsx
```

Open `http://localhost:5173/finance` (or the URL Vite printed). With an AI
coding agent using the Impeccable `live` workflow, the browser lets you select
an element, request variants, preview them and accept one. The agent must service
`live-poll` events and write/finish the accepted variant in the **real source
file**. Running the launcher by itself does not automatically rewrite React
components.

In VS Code, use **Terminal → Run Task** → `Impeccable: Live Owner Web (/finance)`.
`Owner Web: Chạy Vite`, `Impeccable: Detect Owner Web (/finance)` and
`Impeccable: Tắt Live` are also available.

## Useful commands

```powershell
.\scripts\impeccable.cmd context --target src/owner-web/src/features/finance/FinanceHomePage.tsx
.\scripts\impeccable.cmd detect --json src/owner-web/src/features/finance/FinanceHomePage.tsx
.\scripts\impeccable.cmd live-status
.\scripts\impeccable.cmd live-server stop
```

Stop Live with `live-server stop`: this also removes the development-only
injected script. If a session was interrupted, consult `live-status` and resume
it rather than injecting again blindly. Only the Live _configuration_ is tracked
in Git; temporary session/journal/injection files are ignored.

## Repository rules

- Limit changes to `src/owner-web` when improving Owner Web UI.
- Preserve the existing Material UI patterns and BHOME theme tokens.
- Never create fictional finance totals or override API-authoritative states.
- Do not alter invoice/payment authorization or business confirmation logic in
  a styling pass. Test actual routes in demo and API-backed modes.
