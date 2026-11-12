# Location workspace implementation from the setup Wizard

Date: 2026-11-11. Scope: Owner Web Location detail workspace.

## Traceability and design

BF-01 / UC-04..07 / GBR-08: Location, Room, Asset and effective-dated pricing.
BF-05 / UC-20..21 / GBR-07..09: existing utility configuration and confirmed
evidence workflows. FE-08: existing investment and operating expense UI.
GBR-01..03: role and Location scope remain enforced by existing backend services.

Design reference: InitialLocationSetupWizard.tsx, including grouped forms, Room
preview, equipment catalog, pricing scopes, fee dates and policy review. Independent
tabs/dialogs replace the full creation wizard for everyday management. No mock
defaults, draft localStorage or client calculations establish a saved outcome.

Source checked: AGENTS.md, API_IMPLEMENTATION_STATUS.md, PROPERTY_MANAGEMENT.md,
OWNER_SETUP_COMPACT24.md, current PropertyControllers/PropertyContracts,
propertySetup/invoices/finance clients and existing UI tests.

## Wizard to API to interaction

| Tab | Implemented interaction | Existing API |
| --- | --- | --- |
| Overview | Independent summary outcomes, visible partial failure, setup checklist and direct links | Location, RoomType/Room/Asset/BillingPolicy lists, templates/policies |
| Room types | Search/paging, selectable list with adjacent configuration panel, detail modal, grouped two-column create/edit form for capacity/area/amenities/status, explicit conflict reload | GET/POST/PUT room-types, GET room-types/{id} |
| Rooms | Floor map is the default; backend status filter, table toggle, floor selection within the page, color-coded cards with RoomType/area and current contract occupant count plus open incident warnings; card opens detail/history drawer and edit action; bulk preview | rooms, occupancy, incidents, rooms/{id}/prices, rooms/{id}/history, locations/{id}/rooms/bulk-create |
| Assets | Physical records and metadata/history/replacement; templates/inventory subtab; Draft modal, publish/sync outcomes, assignment and evidence verification | assets, asset-templates, rooms/{id}/asset-template and asset-inventory, assets/verify, setup-evidence |
| Pricing/fees | Rent/all-charge tabs, search/paging, detail, create/replacement/future-edit dialogs, end-of-applicability dialog, invoice schedule/rules | billing-policies, replacement/end, billing-schedules |
| Utilities | Tariff/profile/quota dialogs; meter/link/reading dialog; supplier bill/breakdown dialogs; server reconciliation preview/review | utility-tariffs/profiles/quotas, source-meters/readings/bills, meter-links, reconciliations, period-breakdowns |
| Rules | Search/status, content preview, Draft create/edit modal, publish, immutable history modal and new Draft from published content | operating-policies, draft, publish, versions |
| History | Room selection, dated entries, server limitations and pagination | rooms/{id}/history |
| Settings | In-place form, reason/version, closure preview/confirmation, saved feedback and explicit conflict reload | locations/{id}, closure-check |
| Investment/cost | Scoped expense filters, responsive records and existing create/detail/edit/evidence dialogs; Location fixed during scoped creation | expenses and existing reference/evidence APIs |

## Contract gaps and limits

Screenshot feedback follow-up: the loaded UI still retained the previous card
layout. Replaced RoomType cards with list/detail selection and grouped edit form.
Location header is compact, navigation has icons/selected backgrounds, and corner
radii use explicit px units (numeric sx radii previously multiplied the theme's
12px base, unintentionally producing 24–36px rounding). These changes are scoped
to the Location workspace rather than changing the global application theme.

- The 09/11 documentation says operational RoomType was removed. Current source
  contains RoomTypesController, RoomTypeWrite, RoomDto.RoomTypeId and
  BulkRoomsController with matching clients/tests. This UI consumes those existing
  contracts; it does not introduce or approve a new hierarchy. Backend owners
  should reconcile the dated inventory with the current implementation.
- Wizard-only RoomType code/default rent, per-person charging and RoomType asset
  quotas are not copied to unsupported fields. ChargingMethod supports
  FixedPerRoomPerMonth and Metered. Local templates/Room assignment provide the
  supported equipment workflow.
- No delete endpoint is invented. Price retirement uses the existing end action.
  Room, Asset, contract and invoice lifecycle restrictions remain server decisions.
- Floor cards explicitly represent the current page. Room/Asset status filters run
  on the server before paging. RoomType pagination uses the client's actual
  100-row page size. Bulk requests follow the existing 200-Room limit; type choices
  use the current 100-record client page.
- Local policy search operates on documents returned by the API. Native paged
  resources use backend search. There is no new backend, dependency, schema or
  financial/contract policy.

## Verification

Room map follow-up: `RoomFloorCards` now follows the prototype's floor grouping,
status colors, occupant/capacity presentation and incident warnings using real
responses. `useRoomOperations` reads Location-scoped occupancy and Submitted /
InProgress incidents in pages of 100 with a 10-page bound. Incident results are
deduplicated by ID across status reads. Unknown/failed/incomplete data never means
zero occupants or no incidents. These are read-only BF-01/BF-07 operations. Cards
show people associated with the currently active contract, not a physical presence
measurement. The card map and floor filter explicitly apply to the current Room
page. Room pricing is resolved by the backend on drawer open rather than guessed
from a RoomType default or fetched once for every card.

New interaction tests cover bulk confirmation, duplicate numbers, failed-write
retention, exact rates, role restrictions, RoomType details/version conflicts and
paging, Location version reuse/closure confirmation, and policy end without
deletion. Property tests check server RoomStatus filtering. Existing policy tests
now close the history modal before interacting with the page.

Executed in src/owner-web:

- `npm.cmd run typecheck`: PASS.
- `npm.cmd run build`: PASS; Vite reports the existing large-chunk warning.
- `npm.cmd run lint`: PASS.
- `npm.cmd test -- PropertyApiPages.test.tsx UtilityWorkspace.test.tsx LocalSetupPanels.test.tsx ExpensesApiPage.test.tsx BillingContracts.test.tsx LocationWorkspaceInteractions.test.tsx --reporter=verbose`: 6 files, 45 tests PASS.
- `git diff --check`: PASS.
- Full `npm.cmd test`: interrupted after several minutes without a completion
  result; full-suite acceptance is not claimed. Focused expense tests emit MUI
  select out-of-range warnings while reference choices load; all assertions pass.

Browser visual QA
was attempted through Computer Use but access to Microsoft Edge was denied.
No live database writes/provider journeys were executed. React tests use synthetic
mocked responses and do not establish end-to-end deployment acceptance or approval
of the documentation/model discrepancy.
