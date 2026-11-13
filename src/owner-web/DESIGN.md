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
  success: '#159a60'
  warning: '#cb8b16'
  error: '#db4d49'
typography:
  body:
    fontFamily: Inter, Roboto, Arial, sans-serif
    fontSize: 14px
  page-title:
    fontFamily: Inter, Roboto, Arial, sans-serif
    fontSize: 1.65rem
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: -0.025em
  section-title:
    fontFamily: Inter, Roboto, Arial, sans-serif
    fontSize: 1.1rem
    fontWeight: 800
    letterSpacing: -0.01em
rounded:
  surface: 12px
  control: 10px
spacing:
  unit: 8px
---

# BHome Owner Portal design

The source of shared tokens is `src/theme/theme.ts`. This document records the existing identity and the location-workspace refinement; it does not replace the global theme or apply to the public or mobile applications.

## Visual direction

- Operate mode: clear hierarchy, compact but readable controls, visible scope and status, direct links to useful actions.
- Retain BHome blue for primary actions and active navigation; use white surfaces on the existing cool neutral background.
- Prefer quiet borders and whitespace to stacked shadows or decorative card walls.
- Use semantic status with readable text, never color alone. For status badges use suitable contrast, including dark text on a light semantic background.

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
