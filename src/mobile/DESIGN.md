# Staff Mobile — compact operational workspace

Approved direction, 27 November 2026. Scope: Staff only; do not overwrite existing Owner or Tenant design.

## Visual system

- Navy `#193653` for identity, blue `#2563EB` for selected actions, white surfaces over `#F5F7FB`. Muted text `#64748B`. Error, warning and success colors convey actual states.
- Inter, existing bundled font files. Staff titles around 18/24, section titles 16/22, body 14/20, secondary labels 12/18. Values use tabular figures.
- Use 4/8/12/16/24 spacing, 12dp surfaces, subtle borders instead of shadows. Keep touch targets at least 44dp; expand with text size.
- White 64dp minimum Staff app bar with navy wordmark, existing BHOME mark, dark status bar, subtle bottom separator and 48dp notification/profile actions. The active facility appears on Home in the selector and on other screens in the header caption. Keep the body flush beneath the app bar. 60dp bottom navigation plus safe-area inset; preserve draft-aware navigation. Content scrolls independently and never lies behind action footers.
- Do not apply Staff-only changes to Tenant or Owner via shared theme defaults. Staff tokens live in `src/theme/staffLayout.ts`.

## Layout and interaction

Home: approved visual reference uses a continuous pale blue background (`#EFF5FD`) from safe area and brand header through content, a plain location selector with pin and chevron, and three borderless counts separated by fine vertical rules. Section headings use a short blue mark. Priority cards have an icon, target, semantic status and chevron. Six shortcuts in exactly two columns and three equal-width rows, with left-aligned icon and text, 16dp white surfaces and 44dp icon backgrounds. No persistent reload button: pull down at the top and release to refresh the authorized facility and scoped data. Keep actionable error recovery, real counts and bottom navigation.

Work: separate operational tasks and repairs/maintenance; status filters, clear location/target and deadline, compact clickable items; details retain workflow steps, authorization and evidence. Prefer context-relevant metadata over long repeated descriptions.

Rooms: search and filter within the assigned facility; compact room/resident information, retain existing verification and intake actions. Do not invent room occupancy states.

Operational workflows: a single progress indicator where relevant, grouped checklist and concise metadata, meaningful warnings and existing signature/approval actions. Preserve existing forms and their validation.

Profile: concise identity summary, assigned facilities and a familiar settings list. Notifications and security retain their actual capabilities.

## Acceptance

Test 320, 393, 430 and tablet widths; test real data, empty states, long names, errors, loading and font scaling. Ensure Staff controls remain actionable, Tenant/Owner navigation unchanged, and no business/API/database modifications. Run scoped tests, full mobile tests, typecheck, lint and web export; document actual visual and device verification limits.
