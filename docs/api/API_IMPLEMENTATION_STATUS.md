# BHOME — trạng thái API và bàn giao phát triển

Rà soát **06/11/2026**, nhánh `member/QHuy`; SHA từng slice và lệnh kiểm chứng trong [báo cáo triển khai](../development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md). Bổ sung BE-19/BE-X07: calculation, hoàn cọc thủ công, khấu trừ TenantDamage có evidence, Owner UI và browser hai nhánh; không đổi schema hoặc dữ liệu làm việc.

**216 controller routes đang được BHome.Api nạp**, gồm **211 protected** và **5 anonymous**, cộng 2 health endpoints. Danh sách đầy đủ, input/action, policy và source callsite: [API_RUNTIME_ROUTES.md](API_RUNTIME_ROUTES.md). [Mục lục module](README.md) và [quy ước tích hợp](API_CONVENTIONS.md) là điểm bắt đầu cho team.

Đã chạy lại `Compact24ApiAuditTests` sau slice hoàn cọc không khấu trừ: **6/6 đạt, 0 skip**, PostgreSQL test độc lập, DI mặc định Compact24. Cả 211 protected routes trả 401 khi không có phiên. **106 Owner GET probes**: 200=32, 204=2, 400=10, 403=3, 404=59; **0 HTTP 5xx**. Có thêm 12 GET với query/dữ liệu seed hợp lệ được test trả 200; chúng không cộng thêm route. Probe ID không tồn tại/thiếu query kiểm nhánh lỗi, không chứng minh mọi happy path đã đạt. Route Development có descriptor nhưng vẫn bị chặn theo environment/configuration.

## Cách đọc và dùng tài liệu

- **Có API**: controller được host nạp và có implementation; không đồng nghĩa UI đã nối hoặc provider thật đã nghiệm thu.
- **Có lời gọi** trong danh mục: source callsite được tìm thấy. **Có client; chưa xác nhận UI**: wrapper tồn tại nhưng chưa truy được màn gọi. **Chưa tìm thấy**: chưa có bằng chứng gọi đúng method/route, không phải backend thiếu. Dò tĩnh có giới hạn với wrapper/action động; xem phần đối chiếu thủ công.
- Policy ở nhiều attribute áp dụng kết hợp; các role trong cùng attribute là OR. Service vẫn kiểm tra đối tượng, Location assignment hiện tại và Tenant entitlement từ database.
- Owner Web cần `VITE_API_MODE=api` và API URL đúng; các màn đã nối mới dùng backend. Màn mock hoặc role preview không phải bằng chứng kết nối. Mobile cần phiên đăng nhập thật.
- Runtime dùng `Compact24DbContext`, `CompactUserStore`, `CompactRoleStore`; không đăng ký/fallback `BHomeDbContext`. Tên CLR/DTO và bảng logic trong report cũ không phải tên bảng vật lý. Không chạy EF migration legacy để triển khai Compact24.

## Trạng thái theo module

| Module / nguồn nghiệp vụ | Backend và client thực tế | Phần cần team tiếp tục |
| --- | --- | --- |
| Auth — FE-02/UC-01 | Login email, JWT/session/refresh, revoke/change/reset password; Owner Web và Mobile có action theo danh mục | Delivery reset chưa cấu hình; chưa có OTP/MFA challenge hoàn chỉnh; Mobile credential còn memory, cần secure-storage adapter được review |
| Property — BF-01/UC-04..07 | Chain/Location/RoomType/Room/Asset/biểu phí, readiness/history/occupancy có API Compact24; Mobile setup cơ bản | Owner Web nhiều màn Property vẫn mock/báo chưa hỗ trợ API; không suy từ route backend rằng UI CRUD đã nối |
| Staff/Task — BF-02/UC-08..12 | Capture Staff, assignment theo ngày, Task lifecycle/evidence/history; Mobile có action theo role; Owner Web Task API mode đọc list/detail | Staff/schedule Web còn mock; chưa có shift API riêng hoặc JOB-06/07 recurring/deadline workflow hoàn chỉnh; AdHoc Task không phải Work Order |
| Onboarding/OCR — BF-03/UC-13..15, GBR-07 | Capture và human confirmation, Main Draft mã hóa; OCR chỉ trả proposal, manual fallback | Chưa nghiệm thu classifier bốn loại công tơ, >=50 ảnh/90% hoặc camera thiết bị; xem báo cáo OCR được dẫn trong quy ước |
| Main/Renewal/signing — BF-03/04/UC-15..19, GBR-04 | Main Draft review/release canonical PDF → signing/deposit/Owner activation; contracts/history/renewal có API và client | Chưa có bằng chứng cấu hình MySign staging thật và mẫu Production được duyệt; simulation không phải chữ ký pháp lý; signed renewal UI E2E còn thiếu |
| Holding — BE-14, OQ-03/Q-H1 | Boundary/transfer guard, ledger runtime vẫn Unconfigured | Chưa có Holding ledger/API/UI đầy đủ; cần quyết định validity/payment deadline/transfer; không giả OnHold từ Main Contract |
| Handover/move-out — UC-17/19 | Private evidence, confirmed Initial/Final readings, dispute/version guard, inspection/review/settlement summary, Owner manual refund/damage decision và closure/Room release đã chạy browser | Chưa có debt offset bằng cọc hoặc thu phí vượt cọc; nghĩa vụ thiếu/chưa phân loại tiếp tục chặn release. Native/notification và Holding còn thiếu |
| Residence — UC-18/GBR-06 | Có metadata residence trong dữ liệu người ở | Chưa có residence workflow API riêng; Tenant đăng ký ngoài BHOME qua VNeID, Owner xác nhận; Staff không đăng ký/duyệt thay |
| Meter/billing/adjustment — BF-05/UC-20..21/24, JOB-09/10 | Confirmed reading → Draft/Final; Owner opt-in automation; Tenant request/private evidence → Owner decision; Final giữ bất biến | Browser tổng hợp một Invoice/ba Tenant đã chạy; native xuyên chu kỳ, delivery thực tế và reviewer còn thiếu |
| Payment/debt — BF-06/UC-22..25 | Owner sao kê thủ công, allocation=min(receipt,outstanding), partial/excess, payer privacy, QR/debt/history từ backend | Chưa nghiệm thu bank callback/provider tự động; ảnh hoặc frontend không chứng minh tiền đã đến |
| Refund receipt/cọc — BE-X07 | 7 refund API Owner-only + POST deposit-deductions; source receipt/cọc riêng, manual verification/private evidence, plan history/version/idempotency, Owner Web đã nối. Browser không khấu trừ 19 nhóm, có phí 20 nhóm đạt | Owner chuyển tiền bên ngoài, không tự giải ngân. Tenant đọc summary, Staff không thấy tài chính; native chưa nghiệm thu. Chưa credit, debt offset, phí vượt cọc hoặc refund dư do Adjustment sau Paid |
| Finance — FE-08/UC-31..34, GBR-15/16 | 8 Expenses routes, report/capital recovery, 4 What-if routes; Owner Web API mode. Receipt-excess và deposit-principal returns có proof được phân loại riêng; verifiedDepositReturns theo kỳ/phạm vi, không phải OPEX | Refund chưa phân loại giữ unavailable guard; bồi thường thiệt hại giữ cọc chưa cộng vào profit/recovery Invoice/OPEX. Chưa tổng liability cọc/payroll; Work Order chỉ tham chiếu nguồn có sẵn; historical occupancy chỉ một Location |
| Notification — FE-07/UC-35..36, JOB-04 | Inbox, event publisher, delivery/retry/lease/monitoring có implementation và client; delivery lỗi không rollback nghiệp vụ | Email/push mặc định Unconfigured; chưa có delivery thật. Refund mới không có notification consumer riêng |
| Incident/Emergency/Work Order — BF-07/UC-26..30 | Chưa có controller/service lifecycle BF-07 đầy đủ trong host | Owner Web còn mock; bảng/expense reference có sẵn không chứng minh review/plan/repair/verify đã triển khai |
| Public — GBR-17/UC-37 | Chưa có public-content controller của BHome.Api | Chưa nối nội dung backend; chỉ thông tin được Owner duyệt, không Guest form/booking/payment |

Chính sách thiếu/thừa tiền và receipt-excess refund được triển khai theo ủy quyền người dùng khi chưa tìm thấy quyết định OQ-01/02/05; chi tiết ở [PAYMENTS](PAYMENTS.md) và [REFUNDS](REFUNDS.md). Đây không phải quyết định đóng mọi nhánh cọc/quyết toán. `TransferView.unallocatedAmount` vẫn là phần receipt chưa phân bổ vào Invoice; số còn được hoàn lấy từ `RefundSource.availableAmount`, không tự trừ ở frontend.

## Kiểm chứng và giới hạn bàn giao

| Bằng chứng | Kết quả thực tế | Thời điểm / giới hạn |
| --- | --- | --- |
| Audit API vừa chạy | 6/6, 216 routes, 211 protected trả 401, 106 Owner GET không 5xx | Chạy lại sau deposit-refund slice 06/11; synthetic Compact24 DB, không dùng working bhome |
| Kiểm tra tài liệu vừa chạy | Lượt tài liệu trước: 213 route + 2 health, 213 controller links, 580 liên kết nội bộ hợp lệ | Generator tái sinh cùng nội dung, giữ nguyên bản bàn giao; 4 trường hợp manifest sai bị từ chối trước khi ghi; node syntax và git diff --check đạt |
| Full backend regression | Domain 90 + Application 253 + Integration 615 đạt; 1 optional real-OCR integration skip, 0 fail | Lượt triển khai trước, cùng mã backend; không chạy lại full suite trong lượt tài liệu |
| Full frontend regression | Owner Web 144/144, Mobile 376/376 | Lượt triển khai trước; component/transport không thay thế native acceptance |
| Focused refund/payment/finance | PostgreSQL 32/32; Finance unit 11/11; Owner focused UI sau fix 13/13 | Lượt trước; payer, race, private file/hash, upload recovery và Production demo guard |
| Browser Web/API/PG/MinIO | 19/19 nhóm; Main Draft → shared billing/excess refund → inspection/Final readings → hoàn cọc không khấu trừ → Owner settlement/closure/Room release | Lượt trước; dữ liệu tổng hợp, signing/bank simulation, notification worker tắt; Staff/Tenant dùng MobileApi transport, không native UI |
| Digital-signing solution riêng | 41/41 | Lượt trước; không chứng minh sandbox controllers đã mount hoặc MySign thật hoạt động |
| Real OCR riêng | HTTP model smoke 1/1; OCR unit 125/125, integration focused 119/119 | Lượt trước; không phải benchmark >=50 ảnh/90% và không tính integration skip thành pass |

Commands, kết quả và commit triển khai: [báo cáo Nguyễn Quốc Huy](../development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md). Log audit mới ở `.tools/huy-deposit-refund-pg.log`, manifest ở `.tools/deposit-deduction-evidence/api-route-audit.json` (audit mới, local/ignored). Chưa nghiệm thu staging MySign/bank/email/push, native device, ST/AT toàn hệ thống, coverage hoặc NFR performance. Không thay đổi hay nghiệm thu database production trong lượt này.

## Điểm bắt đầu cho người phát triển tiếp

1. Nối các màn Property/Staff/Residence còn mock theo endpoint hiện hữu và quyền server; không thêm API trùng chỉ để khớp mock.
2. Review UX cọc/khấu trừ và thực hiện native/notification acceptance; các nhánh manual đã qua Web/API/PG/MinIO nhưng toàn BE-19/BE-X07 chưa DONE. Giữ source riêng, không dùng legacy Completed hoặc receipt refund để bỏ blocker cọc; debt offset/phí vượt cọc tiếp tục pending.
3. Hoàn thiện Holding sau khi có nội dung quyết định OQ-03/Q-H1. Tích hợp bank/MySign/notification qua adapter và cấu hình test/staging, kiểm idempotency và failure path.
4. Triển khai BF-07 Work Order lifecycle rồi nối maintenance cost; Expense reference hiện chỉ đọc nguồn đã tồn tại. Reviewer UI và acceptance thiết bị vẫn là việc riêng.

## Đối chiếu thủ công các wrapper động

Các dòng này bổ sung cho kết quả dò tĩnh bảo thủ phía trên; nguồn liên kết là bằng chứng có lời gọi, không phải E2E.

| Nhóm                                                                                        | Owner Web                                                                                           | Mobile                                                                                           | Ghi chú                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth POST login/refresh/logout/logout-all/change-password/forgot-password/reset-password    | [sessionClient.ts](../../packages/client-core/src/sessionClient.ts)                                 | [sessions.ts](../../src/mobile/src/lib/sessions.ts)                                              | Auth dùng action động; reset/delivery phụ thuộc cấu hình. Mobile change-password ở AccountSecurityScreen; không mặc định tất cả action đều có màn UI.                                             |
| Contract POST activate/deposit-verifications/signing/signing-sync/recover/renewals/move-out | [ContractLifecyclePanel.tsx](../../src/owner-web/src/features/contracts/ContractLifecyclePanel.tsx) | [ContractLifecyclePanel.tsx](../../src/mobile/src/features/contracts/ContractLifecyclePanel.tsx) | Tên route chính xác xem bảng Contracts; client mutate ghép operation được UI lựa chọn.                                                                                                            |
| Contract POST handover và các confirmation/dispute                                          | [ContractHandoverPanel.tsx](../../src/owner-web/src/features/contracts/ContractHandoverPanel.tsx)   | [ContractHandoverPanel.tsx](../../src/mobile/src/features/contracts/ContractHandoverPanel.tsx)   | Owner xem/theo dõi; Staff chuẩn bị/xác nhận, Tenant xác nhận/tranh chấp trên Mobile. Không coi mọi POST là chức năng của Owner Web.                                                               |
| OperationalTask POST actions + PUT/update + evidence                                        | [TasksPage.tsx](../../src/owner-web/src/features/tasks/pages/TasksPage.tsx)                         | [operationalTasks.ts](../../src/mobile/src/services/operationalTasks.ts)                         | Owner Web TasksPage API mode hiện chỉ đọc danh sách/chi tiết; thao tác demo ở mock mode. Mobile có command động start/progress/blockers/submit/verify/rework/coordinate/assign/cancel theo quyền. |
| Capture POST locations/rooms/staff/assignments/meters/meter-tasks                           | Chưa có bằng chứng                                                                                  | [setup.tsx](../../src/mobile/src/app/setup.tsx)                                                  | Đã sửa POST capture/chains không tồn tại thành GET/PUT chain có version; tạo phòng gửi roomTypeId/capacity.                                                                                       |

## Module có controller source nhưng không được host BHome.Api nạp

`src/digital-signing/BHome.DigitalSigning.Api` là thư viện controllers, không có Program/host riêng. BHome.Api không tham chiếu project này và không gọi AddDigitalSigning. Các route sau **không nằm trong runtime 216 routes**, không được coi là đã chuyển/đã nối. Không tự bật module vì sẽ thêm DigitalSigningDbContext/bảng ngoài Compact24 và có endpoint chứng thư trùng với controller native.

| Source                                                                                                                              | Route khai báo                                                | Trạng thái                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| [SignatureImageController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SignatureImageController.cs)           | `GET /api/v1/digital-signing/signature-image`                 | Có source; chưa mount; chưa nối Compact24 runtime |
| [SignatureImageController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SignatureImageController.cs)           | `GET /api/v1/digital-signing/signature-image/content`         | Có source; chưa mount; chưa nối Compact24 runtime |
| [SignatureImageController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SignatureImageController.cs)           | `PUT /api/v1/digital-signing/signature-image`                 | Có source; chưa mount; chưa nối Compact24 runtime |
| [SignatureImageController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SignatureImageController.cs)           | `DELETE /api/v1/digital-signing/signature-image`              | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningCertificatesController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningCertificatesController.cs) | `GET /api/v1/digital-signing/certificates`                    | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningCertificatesController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningCertificatesController.cs) | `POST /api/v1/digital-signing/certificates`                   | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningCertificatesController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningCertificatesController.cs) | `DELETE /api/v1/digital-signing/certificates/{id:guid}`       | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningCertificatesController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningCertificatesController.cs) | `POST /api/v1/digital-signing/certificates/{id:guid}/lock`    | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningSettingsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningSettingsController.cs)         | `GET /api/v1/digital-signing/settings/viettel`                | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningSettingsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningSettingsController.cs)         | `PUT /api/v1/digital-signing/settings/viettel`                | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningSettingsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningSettingsController.cs)         | `DELETE /api/v1/digital-signing/settings/viettel`             | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningSettingsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningSettingsController.cs)         | `POST /api/v1/digital-signing/settings/viettel/test`          | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningTransactionsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningTransactionsController.cs) | `POST /api/v1/digital-signing/transactions`                   | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningTransactionsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningTransactionsController.cs) | `GET /api/v1/digital-signing/transactions/{id:guid}`          | Có source; chưa mount; chưa nối Compact24 runtime |
| [SigningTransactionsController.cs](../../src/digital-signing/BHome.DigitalSigning.Api/Controllers/SigningTransactionsController.cs) | `GET /api/v1/digital-signing/transactions/{id:guid}/document` | Có source; chưa mount; chưa nối Compact24 runtime |

## Dữ liệu mẫu local

Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-LocalDevelopmentData.ps1` từ repository; công cụ yêu cầu mật khẩu qua secure prompt cho account mới. Email đăng nhập API: `owner.sample@example.invalid`, `staff.sample@example.invalid`, `tenant.sample@example.invalid`, `tenant.other.sample@example.invalid`. LoginRequest yêu cầu email, không gửi username trần.

Chỉ Development + PostgreSQL loopback + `bhome`/database test dành riêng. Tạo 2 Locations, 2 RoomTypes, 6 Rooms (4 Available/2 Unavailable), 6 Assets, 12 Meters, 8 biểu phí mẫu gắn nhãn, 3 Residents Pending, 1 phân công Staff, 4 công việc Assigned, lịch sử/thông báo/audit. Staff chỉ được phân công Location đầu. Không lưu ảnh CCCD/identity thật, không tạo signed contract/payment success/confirmed reading hoặc bật job finalization từ seed.

Chạy lại giữ nguyên dữ liệu đã sửa và mật khẩu. Muốn chọn lại mật khẩu chỉ cho 4 account mẫu: thêm `-SetSamplePasswords` (Identity thu hồi phiên cũ). `-UseRandomPasswords` chạy không tương tác, dùng mật khẩu ngẫu nhiên không in/không lưu; sau đó dùng `-SetSamplePasswords` trước khi đăng nhập. Không có mật khẩu dùng chung được commit. Seed là một transaction và có advisory lock; lỗi rollback toàn bộ.

Nếu database đã có Owner khác, seed từ chối thêm Owner mẫu để giữ mô hình một Owner/Chain của adapter hiện tại. Không chạy đồng thời hai bộ tài khoản New-LocalTestUsers và sample seed; không đổi role/mật khẩu account có sẵn để lách guard. Dữ liệu người dùng hiện có được giữ nguyên.

Các màn hợp đồng/hóa đơn/thanh toán ban đầu có thể rỗng: cần thực hiện onboarding/xác nhận/chữ ký/điều kiện tài chính đúng workflow. Các workflow này được kiểm thử bằng fixture tổng hợp riêng, không tạo bằng chứng ngân hàng hoặc chữ ký giả trong bhome.

## Tái tạo và kiểm tra tài liệu

Chỉ dùng PostgreSQL loopback test do bạn quản lý, admin database `postgres` trên port riêng. Fixture tự tạo/xóa database `bhome_compact24_<uuid>`; không trỏ vào database làm việc/production. Provision cluster theo hướng dẫn môi trường của team trước khi chạy.

```powershell
$env:BHOME_COMPACT24_TEST_ADMIN = 'Host=127.0.0.1;Port=<test-port>;Database=postgres;Username=<test-admin>'
$env:BHOME_COMPACT24_EVIDENCE_DIRECTORY = Join-Path $PWD '.tools/api-docs-20261106/evidence'
dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter FullyQualifiedName~Compact24ApiAuditTests --verbosity minimal
# Chỉ sinh sau khi audit pass; dùng ngày audit thực tế, Node 22 và dependencies repository đã cài.
node scripts/Generate-ApiImplementationInventory.cjs .tools/api-docs-20261106/evidence/api-route-audit.json 2026-11-06
node --check scripts/Generate-ApiImplementationInventory.cjs
git diff --check
```

Nếu môi trường yêu cầu mật khẩu, dùng cơ chế secret local của team; không đưa credential vào tài liệu/commit. Generator chỉ ghi `API_RUNTIME_ROUTES.md` và callsite evidence ignored; không ghi đè bản tổng quan hoặc quyết định thủ công. Không dùng manifest cũ rồi gắn ngày mới. Đối chiếu diff route với DTO/client thực tế và cập nhật module docs trước commit. `OPERATIONAL_TASKS_PROPOSAL.md` là lịch sử, không phải contract hiện tại.
