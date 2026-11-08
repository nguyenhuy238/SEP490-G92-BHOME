# Owner Web — 42 checklist/API mapping

Rà soát source ngày 08/11/2026. Các mô tả dưới đây được ánh xạ từ 42 ID được giao trong yêu cầu; file Excel nguồn chưa thể mở bằng spreadsheet runtime trong phiên này. Controller, DTO, route runtime và màn Owner Web hiện tại là bằng chứng triển khai.

Trạng thái: `IMPLEMENTED`, `PARTIAL`, `BLOCKED_BACKEND`, `BLOCKED_PROVIDER`, `VERIFY_E2E`.

| ID | Chức năng Owner Web | Màn ACTIVE | Contract Backend chính | Trạng thái |
|---:|---|---|---|---|
| 1 | Owner đăng nhập | `/login` | `POST /api/v1/auth/login` | IMPLEMENTED |
| 2 | Logout và thu hồi phiên | App shell | `POST /api/v1/auth/logout` | IMPLEMENTED |
| 3 | Đổi mật khẩu/refresh/khôi phục phiên | Auth dialog/provider | `POST /api/v1/auth/change-password`, `refresh` | IMPLEMENTED |
| 6 | Quản lý Location | `/locations` | `GET/POST/PUT /api/v1/locations` | IMPLEMENTED |
| 7 | Quản lý Room Type | `/room-types`, Location workspace | `GET/POST/PUT /api/v1/room-types` | IMPLEMENTED |
| 8 | Quản lý Room và lịch sử | `/rooms`, `/rooms/:id` | `GET/POST/PUT /api/v1/rooms`, `history`, `readiness` | IMPLEMENTED |
| 9 | Quản lý Asset | `/assets`, Location workspace | `GET/POST/PUT /api/v1/assets` | IMPLEMENTED |
| 10 | Giá/phí, occupancy | `/pricing`, `/dashboard` | Billing policies, occupancy summary | IMPLEMENTED |
| 11 | Tạo/xem Staff giới hạn | `/staff` | `GET/POST /api/v1/capture/staff` | PARTIAL |
| 13 | Gán Staff vào Location | `/staff` | `GET/POST /api/v1/staff-location-assignments` | PARTIAL |
| 15 | OperationalTask Owner lifecycle | `/tasks` | `GET/POST/PUT /api/v1/operational-tasks`, `assign/coordinate/verify/rework/cancel`, `history/evidence` | IMPLEMENTED |
| 19 | Main/contract draft | `/contracts` | MainDrafts + Contracts controllers | IMPLEMENTED |
| 20 | Review/canonical PDF | `/contracts` | Main Draft review/release/file routes | IMPLEMENTED |
| 21 | Signing status/evidence/deposit | `/contracts`, `/digital-signing` | Contracts + signing certificate routes | PARTIAL / BLOCKED_PROVIDER |
| 22 | Owner activation | `/contracts` | Contract readiness/deposit/activation routes | IMPLEMENTED |
| 23 | Room handover status/history | `/handovers`, contract detail | Contract handover routes | IMPLEMENTED (Owner read/review only) |
| 25 | Expiry/renewal | `/contracts` | expiry reminders + renewal routes | IMPLEMENTED |
| 26 | Move-out inspection | `/contracts` | inspection/review/evidence routes | IMPLEMENTED |
| 27 | Settlement/deduction/refund/release | `/contracts` | settlement, deposit deductions, refunds | IMPLEMENTED/PARTIAL policy limits |
| 32 | View Draft invoices/line items | `/invoices` | `GET /api/v1/invoices` | IMPLEMENTED |
| 33 | Finalize/view Final invoice | `/invoices`, `/billing-automation` | invoice finalize + automation routes | IMPLEMENTED |
| 35 | Register/review bank receipt | `/payments` | `POST/GET /api/v1/payment-transactions` | IMPLEMENTED manual workflow |
| 36 | Allocation, partial/full payment, debt | `/payments`, `/debts` | allocate, payment invoices/history/debts | IMPLEMENTED |
| 38 | Invoice Adjustment decision | `/invoice-adjustments` | InvoiceAdjustments controller | IMPLEMENTED |
| 40 | Refund source/decision/execution evidence | `/payments`, contract detail | Refunds controller | IMPLEMENTED manual workflow |
| 41 | Payment/refund/reconciliation history | `/payments`, `/debts` | history routes | IMPLEMENTED |
| 44 | Owner Incident review | `/incidents` | Không có BF-07 Controller trong runtime | BLOCKED_BACKEND |
| 46 | Work Order plan/cost approval | `/maintenance` | Không có WorkOrder Controller trong runtime | BLOCKED_BACKEND |
| 47 | Maintenance progress/verification/rework | `/maintenance` | Không có WorkOrder lifecycle trong runtime | BLOCKED_BACKEND |
| 48 | Initial investment | `/expenses`, Location investment tab | Expenses controller | IMPLEMENTED |
| 49 | Operating expense CRUD/evidence | `/expenses` | 8 Expenses routes | IMPLEMENTED |
| 50 | Business/capital-recovery reports | `/reports` | FinancialReports controller | IMPLEMENTED |
| 51 | What-if analyze/save/compare | `/what-if` | FinancialScenarios controller | IMPLEMENTED |
| 52 | Notification inbox/unread | `/notifications` | Notifications controller | IMPLEMENTED |
| 53 | Mark read and navigate to target | `/notifications` | read/read-all/target routes | IMPLEMENTED |
| 54 | Notification delivery/event state | `/notifications` | automation/delivery monitoring | PARTIAL / BLOCKED_PROVIDER |
| 56 | Owner public content publish | `/public-content` | Không có public-content Controller trong runtime | BLOCKED_BACKEND |
| 57 | Dashboard/menu/active route | App router/sidebar | Owner route graph | VERIFY_E2E |
| 58 | HTTPS + real API mode | toàn Owner Web | `https://localhost:7240`, auth CORS/cookie | VERIFY_E2E |
| 59 | Validation/auth/concurrency errors | các dialog API | ProblemDetails + version/idempotency contracts | VERIFY_E2E |
| 60 | Private evidence/PDF authorization | contracts/tasks/expenses/refunds | protected file routes | VERIFY_E2E |
| 62 | Reload/persistence/no mock fallback | toàn Owner Web | Compact24/PostgreSQL runtime | VERIFY_E2E |

## Active route classification

- `ACTIVE/API`: `/dashboard`, `/locations`, nested Location workspace, `/rooms`, `/room-types`, `/assets`, `/pricing`, `/staff`, `/tasks`, `/contracts`, `/digital-signing`, `/handovers`, `/meters`, `/invoices`, `/billing-automation`, `/invoice-adjustments`, `/payments`, `/debts`, `/expenses`, `/reports`, `/what-if`, `/notifications`.
- `ACTIVE/BLOCKED_BACKEND`: `/incidents`, `/maintenance`, `/public-content`. Các màn này hiển thị trạng thái không khả dụng trong API mode, không ghi dữ liệu demo.
- `SHARED/LEGACY`: `ResourcePage`, các màn property/demo và configuration library còn được mock mode hoặc component khác tham chiếu; chưa xóa.

## Traceability thay đổi OperationalTask

Yêu cầu BF-02/UC-10..12 → `OperationalTasksController`/`TaskContracts` → `TasksPage.tsx` + `useOperationalTasksApi.ts` → component tests create và Owner verify. Server tiếp tục là nơi kiểm tra quyền, Location responsibility, status transition, version, evidence và idempotency.
