# Owner Web — 42 checklist/API mapping

Rà soát source ngày 08/11/2026. Các mô tả dưới đây được ánh xạ từ 42 ID được giao trong yêu cầu; file Excel nguồn chưa thể mở bằng spreadsheet runtime trong phiên này. Controller, DTO, route runtime và màn Owner Web hiện tại là bằng chứng triển khai.

Trạng thái Backend: `SUPPORTED`, `PARTIAL`, `BACKEND_BLOCKED`, `PROVIDER_BLOCKED`.
Trạng thái Browser: `PASS`, `PARTIAL`, `BLOCKED`, `NOT_TESTED`. `PASS` chỉ được ghi khi đã chạy browser với API thật; build/component test không được tính là E2E.

> Giới hạn truy xuất nguồn: phiên Codex ngày 08/11/2026 không có spreadsheet artifact runtime hoặc phiên Excel kết nối, nên chưa thể đọc workbook gốc `BHOME_Checklist_Test_Noi_Bo_06-11-2026.xlsx`. 42 STT dưới đây được giữ nguyên từ phạm vi đã giao trước đó, nhưng cột mô tả/role-channel vẫn cần đối chiếu trực tiếp workbook trước khi ký nghiệm thu.

Bằng chứng Browser: `.tools/bf01-bf02-browser-evidence.json` (file local bị gitignore). Lần chạy cuối ghi nhận 345 request thật trước khi môi trường dừng; các bước đã qua được nêu riêng, không biến lần chạy dở thành E2E PASS.

| Original STT | Feature / Owner Web portion | Active Dashboard route | Actual API endpoints | Current Frontend | Backend support | Browser E2E | Evidence | Remaining blocker |
|---:|---|---|---|---|---|---|---|---|
| 1 | Owner đăng nhập | `/login` | `POST /api/v1/auth/login` | Real auth form/client | SUPPORTED | PASS | Real login + Owner route | Workbook role/channel unverified |
| 2 | Logout và thu hồi phiên | App shell | `POST /api/v1/auth/logout` | Real logout action | SUPPORTED | PASS | Earlier browser run returned 204 | No blocker in tested path |
| 3 | Đổi mật khẩu/refresh/khôi phục phiên | Auth dialog/provider | `POST /api/v1/auth/change-password`, `/refresh` | Dialog + cookie session provider | SUPPORTED | PARTIAL | Reload/refresh PASS; final run did not repeat password-change E2E | Repeat full change-password cases after DB READY |
| 6 | Quản lý Location | `/locations` | `GET/POST/PUT /api/v1/locations` | Live API page | SUPPORTED | PASS | Browser BF01-01-02 | None in tested path |
| 7 | Quản lý Room Type | `/room-types`, Location workspace | `GET/POST/PUT /api/v1/room-types` | Live API page | SUPPORTED | PASS | Browser BF01-03-04 | None in tested path |
| 8 | Quản lý Room và lịch sử | `/rooms`, `/rooms/:id` | `GET/POST/PUT /api/v1/rooms`, `history`, `readiness` | Live API page | SUPPORTED | PASS | Browser BF01-05-06-12 | None in tested path |
| 9 | Quản lý Asset | `/assets`, Location workspace | `GET/POST/PUT /api/v1/assets` | Live API page | SUPPORTED | PASS | Browser BF01-07-08 | None in tested path |
| 10 | Giá/phí, occupancy | `/pricing`, `/dashboard` | Billing policies, occupancy summary | Live API page | SUPPORTED | PASS | Browser BF01-09-10 | None in tested path |
| 11 | Tạo/xem Staff giới hạn | `/staff` | `GET/POST /api/v1/capture/staff` | Create/list UI | PARTIAL | PARTIAL | Browser Staff create PASS | Missing safe detail/update/deactivate APIs |
| 13 | Gán Staff vào Location | `/staff` | `GET/POST /api/v1/staff-location-assignments` | Create/list assignment UI | PARTIAL | PASS | Browser assignment create/filter | Missing amend/end assignment APIs |
| 15 | OperationalTask Owner lifecycle | `/tasks` | `GET/POST/PUT /api/v1/operational-tasks`, `assign/coordinate/verify/rework/cancel`, `history/evidence` | Active API screen: create/edit/filter/detail/actions/history/evidence | SUPPORTED | PARTIAL | Real API: create/update/filter/detail/assign/coordinate/history/evidence, Staff start/submit, rework/resubmit, stale 409, invalid transition 409, idempotency PASS | Verify/cancel leg interrupted when Docker/PostgreSQL stopped; rerun after DB is READY |
| 19 | Main/contract draft | `/contracts` | MainDrafts + Contracts controllers | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run in this pass |
| 20 | Review/canonical PDF | `/contracts` | Main Draft review/release/file routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run; file storage dependency |
| 21 | Signing status/evidence/deposit | `/contracts`, `/digital-signing` | Contracts + signing certificate routes | Live API page | PROVIDER_BLOCKED | NOT_TESTED | Source/API integration audit | MySign staging/provider unconfigured |
| 22 | Owner activation | `/contracts` | Contract readiness/deposit/activation routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 23 | Room handover status/history | `/handovers`, contract detail | Contract handover routes | Owner read/review UI | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 25 | Expiry/renewal | `/contracts` | Expiry reminders + renewal routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 26 | Move-out inspection | `/contracts` | Inspection/review/evidence routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run; MinIO unavailable |
| 27 | Settlement/deduction/refund/release | `/contracts` | Settlement, deposit deductions, refunds | Live API page | PARTIAL | NOT_TESTED | Source/API integration audit | Open policy/classification limitations |
| 32 | View Draft invoices/line items | `/invoices` | `GET /api/v1/invoices` | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 33 | Finalize/view Final invoice | `/invoices`, `/billing-automation` | Invoice finalize + automation routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 35 | Register/review bank receipt | `/payments` | `POST/GET /api/v1/payment-transactions` | Manual verified-receipt UI | PARTIAL | NOT_TESTED | Source/API integration audit | Automatic bank provider not accepted as verified |
| 36 | Allocation, partial/full payment, debt | `/payments`, `/debts` | Allocate, invoices/history/debts | Live API pages | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 38 | Invoice Adjustment decision | `/invoice-adjustments` | InvoiceAdjustments controller | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 40 | Refund source/decision/execution evidence | `/payments`, contract detail | Refunds controller | Manual workflow UI | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run; provider/storage dependencies |
| 41 | Payment/refund/reconciliation history | `/payments`, `/debts` | History routes | Live API pages | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 44 | Owner Incident review | `/incidents` | Không có BF-07 Controller trong runtime | Honest unavailable screen in API mode | BACKEND_BLOCKED | BLOCKED | Runtime/controller audit | Missing Incident API/lifecycle |
| 46 | Work Order plan/cost approval | `/maintenance` | Không có WorkOrder Controller trong runtime | Honest unavailable screen in API mode | BACKEND_BLOCKED | BLOCKED | Runtime/controller audit | Missing WorkOrder API/state machine |
| 47 | Maintenance progress/verification/rework | `/maintenance` | Không có WorkOrder lifecycle trong runtime | Honest unavailable screen in API mode | BACKEND_BLOCKED | BLOCKED | Runtime/controller audit | Missing WorkOrder commands/history/evidence |
| 48 | Initial investment | `/expenses`, Location investment tab | Expenses controller | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 49 | Operating expense CRUD/evidence | `/expenses` | Expenses routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run; MinIO unavailable |
| 50 | Business/capital-recovery reports | `/reports` | FinancialReports controller | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 51 | What-if analyze/save/compare | `/what-if` | FinancialScenarios controller | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 52 | Notification inbox/unread | `/notifications` | Notifications controller | Live API page | SUPPORTED | NOT_TESTED | Unread-count requests returned 200 during E2E | Inbox interaction not run |
| 53 | Mark read and navigate to target | `/notifications` | Read/read-all/target routes | Live API page | SUPPORTED | NOT_TESTED | Source/API integration audit | Browser E2E not run |
| 54 | Notification delivery/event state | `/notifications` | Automation/delivery monitoring | Live in-app UI | PROVIDER_BLOCKED | NOT_TESTED | Source/API integration audit | Email/push providers unconfigured |
| 56 | Owner public content publish | `/public-content` | Không có public-content Controller trong runtime | Honest unavailable screen in API mode | BACKEND_BLOCKED | BLOCKED | Runtime/controller audit | Missing Owner public-content API |
| 57 | Dashboard/menu/active route | App router/sidebar | Owner route graph | Active sidebar/router | SUPPORTED | PASS | Browser traversed active BF-01/BF-02 routes | Workbook channel still unverified |
| 58 | HTTPS + real API mode | toàn Owner Web | `https://localhost:7241` runtime test endpoint | API production bundle | PARTIAL | PARTIAL | TLS health PASS; real requests observed | `.env` allows HTTP 5173 only; HTTPS origin required runtime CORS/AuthWeb override |
| 59 | Validation/auth/concurrency errors | các dialog API | ProblemDetails + version/idempotency contracts | Error rendering and optimistic version payloads | SUPPORTED | PASS | Real invalid transition 409, stale version 409, idempotent replay 200 | None in tested OperationalTask scope |
| 60 | Private evidence/PDF authorization | contracts/tasks/expenses/refunds | protected file routes | Authenticated blob clients | PARTIAL | BLOCKED | Empty authorized task-evidence list returned 200 | MinIO image unavailable; non-empty download/upload not executed |
| 62 | Reload/persistence/no mock fallback | toàn Owner Web | Compact24/PostgreSQL runtime | API-mode session/data restoration | SUPPORTED | PASS | Auth and BF-01/task reloads used persisted Backend data | Final task lifecycle rerun blocked by DB readiness |

## Active route classification

- `ACTIVE/API`: `/dashboard`, `/locations`, nested Location workspace, `/rooms`, `/room-types`, `/assets`, `/pricing`, `/staff`, `/tasks`, `/contracts`, `/digital-signing`, `/handovers`, `/meters`, `/invoices`, `/billing-automation`, `/invoice-adjustments`, `/payments`, `/debts`, `/expenses`, `/reports`, `/what-if`, `/notifications`.
- `ACTIVE/BLOCKED_BACKEND`: `/incidents`, `/maintenance`, `/public-content`. Các màn này hiển thị trạng thái không khả dụng trong API mode, không ghi dữ liệu demo.
- `SHARED/LEGACY`: `ResourcePage`, các màn property/demo và configuration library còn được mock mode hoặc component khác tham chiếu; chưa xóa.

## Traceability thay đổi OperationalTask

Yêu cầu BF-02/UC-10..12 → `OperationalTasksController`/`TaskContracts` → `TasksPage.tsx` + `useOperationalTasksApi.ts` → component tests create và Owner verify. Server tiếp tục là nơi kiểm tra quyền, Location responsibility, status transition, version, evidence và idempotency.
