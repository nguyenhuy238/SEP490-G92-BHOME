<!-- impeccable:product-schema 1 -->

# BHome Owner Portal

## Product

BHome is a rental-property management system. This web application helps owners manage locations, rooms, tenants, contracts, assets, pricing, utilities and finance. Staff access is restricted to assigned operational responsibilities.

## Users and jobs

- Owners need to understand occupancy, outstanding operational work and financial position across properties, then act on one location without losing context.
- Owners configure local room defaults and reusable asset requirements, create and maintain actual rooms, and manage effective-dated fees.
- Authorized staff need fast, clear access to the operations permitted by the backend.

## Platform and context

- Platform: web, desktop-first but usable on mobile and tablet.
- Language: Vietnamese; money and dates follow Vietnamese conventions.
- Existing React, TypeScript and Material UI frontend; real API is authoritative.
- Primary location workflow: overview → rooms → assets → pricing and utilities → operating rules → history → settings → investment and expenses.

## Experience principles

- Operate mode: a calm, practical workspace, with useful data and actions rather than decorative dashboards.
- Prioritize the next useful decision, keep location scope visible, and separate global configuration from local records.
- Show meaningful loading, empty, partial and error states. Unknown values are not zero.
- Preserve role restrictions, effective dates, history and immutable snapshots; do not imply changes to already signed contracts or invoices.
- Distinguish physical assets from desired templates and verified inventory; distinguish configured prices from agreed contract prices.
- Keep monetary input and display exact; do not infer financial totals from one paginated list.
- Reuse the existing BHome identity and components; mobile and public web are separate design contexts.
