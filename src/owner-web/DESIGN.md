---
name: BHome Owner Portal
description: A clear, practical Vietnamese property management workspace
colors:
  primary: '#255dde'
  primary-dark: '#194cbb'
  primary-light: '#ebf2ff'
  text: '#15243e'
  secondary: '#53657f'
  background: '#f6f8fc'
  surface: '#ffffff'
  divider: '#e6ebf2'
  success: '#18764a'
  success-dark: '#176b43'
  success-surface: '#eaf7ef'
  warning: '#a6650c'
  warning-dark: '#925409'
  warning-surface: '#fff4df'
  neutral-status: '#64748b'
  neutral-status-surface: '#f0f2f5'
  error: '#b93838'
typography:
  body:
    fontFamily: Inter, Roboto, Arial, sans-serif
    fontSize: 14px
  page-title:
    fontFamily: Inter, Roboto, Arial, sans-serif
    fontSize: 1.5rem
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: -0.025em
  section-title:
    fontFamily: Inter, Roboto, Arial, sans-serif
    fontSize: 1.125rem
    fontWeight: 700
    letterSpacing: -0.01em
rounded:
  surface: 12px
  control: 10px
spacing:
  unit: 8px
---

# BHome Owner Portal design

The source of shared tokens is `src/theme/theme.ts`. This document records the Compact Operations Workspace refinement of the Owner Portal. It does not apply to the public or mobile applications.

## Visual direction

- Operate mode: clear hierarchy, compact but readable controls, visible scope and status, direct links to useful actions.
- Retain BHome blue for primary actions and active navigation; use white surfaces on the existing cool neutral background.
- Prefer quiet borders and whitespace to stacked shadows or decorative card walls.
- Use semantic status with readable text, never color alone. For status badges use suitable contrast, including dark text on a light semantic background.
- Room occupancy charts and floor cards share `roomStatusColors` in the Owner theme: occupied is blue, available is green, held is amber, unavailable is neutral. Unknown remains explicitly labeled and is not counted as unavailable.

## Compact operations density

- Keep desktop page/section headings at 24/18px, body and table text at 14px, captions at 13px; do not scale the browser or reduce the root font size.
- Desktop controls are normally 36px high, tabs 42px, navigation rows 36px. At narrow widths and for coarse pointers, primary controls and navigation use 44px touch targets. Compact tables may use 44–48px rows where content permits; longer labels and metadata wrap instead of being clipped out of reach.
- Use 8px vertical / 12px horizontal table cell padding by default, 12–16px panel padding, 16px section gaps, and 20–24px desktop page padding. Avoid stacking padded cards inside padded cards.
- The desktop content region is fluid after the sidebar; cap the width of forms or filters only where the task warrants it. Filters have explicit widths (search up to 360px, status about 180–200px); full-width inputs remain suitable for forms.
- Prefer semantic tables for Location and shared-library records. Use real links for navigation, one visible frequent action, and a named keyboard-accessible menu for secondary actions. On small screens, collapse noncritical columns into the identity cell or use a contained horizontal table scroll with all information accessible.
- Overview presents compact KPI cells, a compact donut with total room count and labeled status links, and short operational follow-up rows. Unknown values are not zeros. Keep dates, money, scope and status legible. Room summaries use restrained semantic text color, not oversized highlighted cards.
- Shared-library lists prioritize names, rates, scope and lifecycle status; version metadata belongs to detail/history and mutation validation, not a permanent list column. Keep short contextual explanations only when they help a decision; preserve consequential warnings at the action itself.

## Layout and interaction

- A stable page heading and location information above navigation; tabs remain horizontally scrollable rather than forcing document overflow.
- Overview is decision-oriented: room-state counts, occupancy distribution, operational follow-up and financial context.
- Group related data and actions; use tables for dense comparison and floor cards for spatial room scanning. Preserve pagination scope and distinguish current-page counts from location totals.
- At narrow widths, stack filters and actions, allow labels to wrap, use full-width dialogs when appropriate, and keep wide tables inside their own scroll region.
- Use Material UI controls and visible keyboard focus. Prefer at least 44px tap targets on primary mobile actions and navigation.
- Loading, empty, partial, stale-version and failure states should communicate the next useful action. Never hide errors behind fabricated values.

## Data and content

- Vietnamese action labels describe the operation; show unit, scope and effective date next to configured prices.
- Do not use marketing copy, fictitious occupancy or invented revenue.
- Keep actual assets, requirements and verification distinct; separate agreed contract values from current configured values.
- Preserve exact VND formatting and server-authoritative totals.
- Use the existing confirmation and versioning workflows for consequential mutations.
- Distinguish business edition from the concurrency version; shared Published means “Đã công bố”, not an active Location or automatic synchronization.

## Shared patterns across Owner workflows

- Use AppShell navigation groups and PageHeader for consistent orientation and primary actions. Keep the single page-level heading; embedded workspace sections use lower-level headings.
- Use KPIGrid for adjacent related metrics and RoomOccupancyDistribution for the chain and location room-state breakdown. Unavailable or inconsistent server data is explicitly unknown, not zero. The dashboard uses live API totals in API mode and only uses demo data in explicit mock mode.
- Use OwnerTable for operational records, with compact desktop rows and readable record summaries with visible actions on mobile. Retain a contained, scrollable table where columns must be compared. Keep filters, active scope and pagination predictable after a mutation or refresh.
- Financial and contract screens prioritize the amount, period, state and next valid action. Keep exact money input, signed-contract snapshots, server totals and consequential review/confirmation steps intact; do not derive financial conclusions from a partial page of results.
- Location setup uses seven ordered steps: information, room types, rooms, assets and amenities, fees, policies, review. Make the current step and draft progress visible. Keep preview, conflict feedback and explicit confirmation before applying or copying shared configuration; a failed or stale preview must not silently execute.
