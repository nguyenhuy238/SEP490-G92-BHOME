# BHOME — Full end-to-end demo readiness audit

Ngày kiểm tra: **08/11/2026 (Asia/Bangkok)**. Branch `member/Long`; baseline `bb0323d38f84fcc31ced3e4f090a9ee3a2574ab9`.

## A. Kết luận

**NOT READY — Không thể xác nhận chạy tin cậy toàn bộ kịch bản được yêu cầu ngay bây giờ.**

Điểm chặn đầu tiên là cấu hình Location/Room trên Owner Web: wizard và các thao tác phòng vẫn đi qua repository demo; trong API mode repository đó chủ động trả lỗi, không lưu Neon. Mobile Setup cũng không thay thế được vì tải route Chain đã bỏ và bắt chọn RoomType không còn trong hợp đồng runtime ([E01](#evidence-e01), [E02](#evidence-e02), [E03](#evidence-e03), [E04](#evidence-e04), [E05](#evidence-e05), [E07](#evidence-e07)).

Đây không phải kết luận toàn bộ backend thiếu chức năng. Backend đã có activation, bàn giao, billing thủ công, đối soát thủ công, inspection, hoàn cọc và khóa release phòng; **125 integration test đã PASS trên DB tạm**, cùng kiểm thử FE và 467 backend unit test. Các kết quả đó không tương đương một phiên người dùng Owner Web + Mobile chạy đủ 7 bước trên Neon.

Ngoài kết nối đầu luồng còn ba giới hạn lớn: chưa chứng minh MySign hoạt động với tài khoản/provider hiện tại; không có giao diện mời/kích hoạt Tenant mới qua API invitation hiện hữu; và không thấy operation tính/lập khoản utility cuối riêng khi chỉ số Final lệch hóa đơn tháng đã Final. Hệ thống giữ PendingSettlement đúng nguyên tắc an toàn, không tự chuyển thành paid/settled ([E19](#evidence-e19), [E20](#evidence-e20), [E22](#evidence-e22), [E29](#evidence-e29), [E43](#evidence-e43), [E53](#evidence-e53), [E56](#evidence-e56)).

**Xung đột phạm vi bắt buộc ghi nhận:** yêu cầu demo nói “Room Types”, nhưng quyết định ghi trong repo ngày 04/11 bỏ Chain/RoomType, Location là cấp cao nhất, giá theo Location/Room. Source hiện tại thực hiện quyết định này; DTO Room không nhận RoomType và save đặt RoomTypeId=null. Không coi việc thiếu route RoomType là tự động cho phép khôi phục module cũ. Để đạt đúng nguyên văn demo phải chốt lại phạm vi RoomType; để bám thiết kế hiện tại phải điều chỉnh bước demo thành Location → Room → giá/phí ([E06](#evidence-e06), [E07](#evidence-e07), [E75](#evidence-e75)).

### Mức chứng cứ và giới hạn

- **Source:** đọc chuỗi UI → handler/hook → HTTP/DTO → controller → service → repository → Compact24; catalog cuối báo cáo ghi file và dòng cụ thể.
- **Executed isolated:** build, lint, typecheck, toàn bộ npm test, backend unit test, các suite integration chọn lọc; các fixture ghi vào PostgreSQL tạm, không vào Neon. Workflow tests có storage substitute; CaptureWorkflowTests bổ sung real MinIO riêng ([E61](#evidence-e61)–[E64](#evidence-e64)). Một số closure fixtures trực tiếp dựng invoice Final/Periodic/Final có cùng giá trị trước khi gọi settlement APIs, nên test closure PASS không chứng minh UI tạo được đủ dữ liệu đó từ đầu ([E84](#evidence-e84)).
- **Executed live, chỉ đọc:** health API/MinIO, Swagger inventory, kết nối Neon bằng role dev04 trong transaction READ ONLY. Không login vào Neon vì login ghi session/refresh token; không gọi mutation nghiệp vụ, không seed/reset/migrate hoặc bật jobs.
- **Chưa chứng minh:** người dùng thật thao tác browser/native, account invitation delivery, real OCR accuracy, provider MySign/bank thật, storage giữa nhiều máy. Không có stage nào được gắn COMPLETE chỉ vì có code/test mock.

## 1. Repository và runtime thực tế

Backend entry `BHome.Api/Program.cs`: auth/CORS/rate limit/controllers/health. DI dùng **Compact24DbContext**, không lấy legacy migrations làm mô hình đang chạy. Các domain entity như ContractHandover/MoveOut/PaymentTransfer có thể là projection/JSON trên 24 bảng; tên class không chứng minh có bảng vật lý cùng tên ([E60](#evidence-e60), [E69](#evidence-e69), [E70](#evidence-e70)).

Owner Web dùng React Router, TanStack Query, Auth client và các client `contracts/invoices/payments`; có hai nhóm code song song: màn live chuyên biệt và generic PortalRepository. Mobile dùng Expo Router, SessionProvider, workspace role map, MobileApi và hook dùng chung. `/handovers` ở Web API mode mở quản lý hợp đồng để monitor; Staff lập biên bản trên Mobile ([E10](#evidence-e10), [E33](#evidence-e33), [E67](#evidence-e67), [E68](#evidence-e68), [E81](#evidence-e81)–[E83](#evidence-e83)).

| Kiểm tra cấu hình/runtime      | Kết quả quan sát                                                                                                                                  | Giới hạn                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Neon profile `.env.neon.dev04` | DNS/TCP/TLS/auth PASS; DB `neondb`, role `bhome_dev04`; 24 bảng; Compact24 PASS; history 1 applied/0 pending                                      | Probe không xác minh project/branch ID trên Neon Console. Không khẳng định chỉ từ hostname rằng project là `quiet-hall-21512758` / branch `development`                                                |
| API đang chạy                  | PID 9988; HTTP 5240; live/ready 200; connection PostgreSQL tới địa chỉ cloud, không loopback                                                      | Process Debug đang chạy có thể khác binary vừa build; Swagger live được ghi lại riêng                                                                                                                  |
| Swagger live                   | 272 paths; có `/invoices/drafts`, capture rooms và move-out settlement; không có capture/chains hay room-types                                    | GET không token trả 401 cũng có thể do fallback auth; không lấy 401 làm bằng chứng route tồn tại                                                                                                       |
| Owner Web                      | File env local chọn `VITE_API_MODE=api`, URL HTTPS localhost:7240                                                                                 | Không coi env file là chứng cứ dev server/browser đã reload; CI không đặt mode api thì default là mock ([E87](#evidence-e87))                                                                          |
| Mobile                         | File local đặt API URL tunnel HTTPS; launcher có thể override bằng DEV_API_BASE_URL                                                               | Chưa xác minh tunnel/điện thoại truy cập; không đưa URL tunnel tạm vào kế hoạch cố định                                                                                                                |
| Jobs/automation                | Neon profile: Jobs=false, notification automation=false, init-on-startup=false; local user-secrets Jobs=false                                     | Không bật flags. Không dùng defaults trong appsettings thay cho effective process configuration                                                                                                        |
| Signing                        | Development template tồn tại; converter image local có; simulation default false; user-secrets không có credential MySign được cấu hình trực tiếp | MySign còn có settings lưu DB; chưa đọc authenticated settings nên **NOT VERIFIED**, không khẳng định chắc chắn DB thiếu credential ([E27](#evidence-e27), [E29](#evidence-e29), [E66](#evidence-e66)) |
| MinIO                          | localhost:9000 readiness 200; isolated real upload/download tests PASS                                                                            | Không chứng minh object do máy khác upload có trên máy này; cross-machine storage chưa nghiệm thu                                                                                                      |

Lưu ý: mở `.env.neon.dev04` trong editor không tự đổi backend. `Start-Api.ps1 -EnvironmentFile ...` inject biến process; fallback `.env` có ưu tiên thấp hơn environment/user-secrets/CLI. `.env` mặc định trên máy trỏ loopback, vì vậy không suy ra đích runtime chỉ từ tên file đang mở ([E71](#evidence-e71), [E72](#evidence-e72)).

Nguồn yêu cầu đã đọc: Report 1 `BHOME_Report-1_Project_Introduction (3).docx`; SRS `BHome_Report-3_Software Requirement Specification.docx`, UC-04..07/08..12/13..19/20..22, GBR-01/02/04/07/08/09/10/18 và DBR-02/03/06/07; SDS `Report-4_Software Design Specification (1).docx`; API reset 04/11 ưu tiên cho thay đổi RoomType. OQ-01/02/05 về deposit/damage/refund vẫn cần đối chiếu quyết định đã phê duyệt, không suy diễn công thức từ test.

## B. Trạng thái từng bước nghiệp vụ

Trong cột DB: “isolated” là persistence đã chạy ở DB tạm; “live metadata” không chứng minh đã có dữ liệu nghiệp vụ demo trong Neon.

| Step                                     | Role                        | FE screen                                  | API endpoint                                                                  | BE implementation                                                                          | DB persistence                                                                    | Status                                                           | Evidence                                                                                                 |
| ---------------------------------------- | --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1.1 Tạo/sửa Location                     | Owner                       | `/locations`, initial wizard               | `POST /api/v1/locations`; PUT cùng resource                                   | PropertyService, property repository có                                                    | Isolated PASS; Web chưa ghi thật                                                  | PARTIAL                                                          | [E01](#evidence-e01) [E02](#evidence-e02) [E08](#evidence-e08)                                           |
| 1.2 RoomType                             | Owner                       | `/room-types`, `/configuration/room-types` | Không có API runtime                                                          | Quyết định đã bỏ khái niệm này                                                             | Không có runtime relation như demo yêu cầu                                        | BLOCKED                                                          | [E06](#evidence-e06) [E07](#evidence-e07) [E75](#evidence-e75)                                           |
| 1.3 Tạo Room                             | Owner                       | `/rooms/new`                               | `POST /api/v1/rooms`                                                          | RoomsController → SaveRoomAsync                                                            | Isolated PASS; FE dùng executeProperty demo                                       | PARTIAL                                                          | [E03](#evidence-e03) [E07](#evidence-e07) [E09](#evidence-e09)                                           |
| 1.4 Giá thuê/điện/nước/phí               | Owner                       | `/pricing` API branch                      | `GET/POST /billing-policies`; `/billing-schedules`                            | Effective dates, scope/version, InvoiceService                                             | Isolated PASS; có live UI source                                                  | PARTIAL                                                          | [E10](#evidence-e10) [E11](#evidence-e11) [E40](#evidence-e40) [E41](#evidence-e41)                      |
| 1.5 Staff/phân công                      | Owner                       | `/staff`; Mobile `/setup`                  | `/staff`, `/staff-location-assignments`; capture assignments                  | Assignment và date/scope guards có                                                         | Isolated PASS; Web generic, Mobile setup lỗi trước đó                             | PARTIAL                                                          | [E12](#evidence-e12) [E04](#evidence-e04) [E74](#evidence-e74)                                           |
| 2.1 Tạo Resident/co-occupants            | Staff                       | workspace `onboarding`                     | `POST /capture/residents`                                                     | CaptureService/Repository                                                                  | Isolated PASS; UI gọi thật                                                        | PARTIAL                                                          | [E14](#evidence-e14) [E18](#evidence-e18)                                                                |
| 2.2 OCR CCCD và sửa tay                  | Staff; Owner OCR-only       | IdentityWizard                             | `POST /ocr/identity/{residentId}/{front                                       | back}`                                                                                     | Binary transient OCR; correction/confirmation                                     | Identity confirmation/encryption test PASS; model thật chưa chạy | NOT VERIFIED                                                                                             | [E15](#evidence-e15) [E16](#evidence-e16) [E17](#evidence-e17) [E18](#evidence-e18) |
| 2.3 Xác minh identity                    | Staff                       | IdentityWizard confirm                     | `POST /capture/residents/{id}/confirm`                                        | HumanConfirmed, AES/encryption + lookup protection, scoped Staff                           | Isolated PASS; Owner confirm bị từ chối theo role                                 | PARTIAL                                                          | [E05](#evidence-e05) [E18](#evidence-e18) [E67](#evidence-e67)                                           |
| 2.4 Tạo/kích hoạt Tenant mới             | Owner/Tenant                | Chưa thấy màn invite/accept                | `/residents/{id}/invitation`; `/auth/accept-invitation`                       | Backend có; email có thể PendingRetry                                                      | Có BE; chưa nối FE và chưa verify delivery                                        | BACKEND ONLY                                                     | [E19](#evidence-e19) [E20](#evidence-e20)                                                                |
| 2.5 Reuse account, tạo Main Draft        | Owner/Staff                 | Contracts editor / prepare-contract        | `/contracts/preparation/accounts`, resident/account, `/contracts/main-drafts` | Confirmed identity, policy/terms snapshot, locks                                           | Isolated MainDraft PASS                                                           | PARTIAL                                                          | [E21](#evidence-e21) [E22](#evidence-e22) [E23](#evidence-e23) [E24](#evidence-e24)                      |
| 2.6 Holding tùy chọn                     | Owner/Staff/Tenant          | Contract actions                           | `/contracts/holdings`, approval/deposit/activation/conversion                 | Có workflow; không bắt buộc cho Main trực tiếp                                             | Isolated Holding regression PASS; không live financial acceptance                 | PARTIAL                                                          | [E25](#evidence-e25) [E26](#evidence-e26) [E81](#evidence-e81)                                           |
| 2.7 PDF, ký hai bên, sync                | Owner/Tenant                | Contract workflow + digital-signing        | `{id}/signing`, `/signing/sync`, `/document`                                  | Real MySign adapter hoặc simulation có nhãn                                                | Isolated signing PASS với synthetic provider; live chưa chứng minh                | BLOCKED                                                          | [E22](#evidence-e22) [E27](#evidence-e27) [E29](#evidence-e29) [E66](#evidence-e66)                      |
| 2.8 Xác minh cọc/activate                | Owner                       | Contract detail                            | `{id}/deposit-verifications`, `/activation-readiness`, `/activate`            | Required deposit, signatures, date/scope/overlap, room Occupied                            | Isolated PASS, có rejection/race                                                  | PARTIAL                                                          | [E25](#evidence-e25) [E26](#evidence-e26) [E77](#evidence-e77)                                           |
| 3.1 Bàn giao room/assets/keys            | Staff                       | ContractHandoverPanel / move-in            | `{id}/handover`, choices, evidence                                            | Inventory snapshot + evidence integrity                                                    | Isolated PASS                                                                     | PARTIAL                                                          | [E30](#evidence-e30) [E32](#evidence-e32) [E78](#evidence-e78)                                           |
| 3.2 Initial meter baseline               | Staff                       | Meter tasks → meter capture                | capture Initial task + evidence/confirm                                       | 2 meter types, no previous baseline conflict                                               | Isolated PASS; setup creation path bị chặn                                        | PARTIAL                                                          | [E34](#evidence-e34) [E35](#evidence-e35)                                                                |
| 3.3 Tenant rồi Staff xác nhận            | Tenant/Staff; Owner monitor | Contract panel; `/handovers`               | tenant-confirmation, staff-confirmation/history                               | Same version; dispute/correction; immutable Confirmed                                      | Isolated handover PASS; chưa native/live                                          | PARTIAL                                                          | [E31](#evidence-e31) [E32](#evidence-e32) [E33](#evidence-e33)                                           |
| 4.1 Tạo/giao việc định kỳ                | Owner                       | Mobile setup; `/billing-automation`        | `POST /capture/meter-tasks`; run-now                                          | Không bắt buộc global scheduler                                                            | Có API; setup chain/roomtype stale; action run-now tùy plan/date                  | PARTIAL                                                          | [E04](#evidence-e04) [E34](#evidence-e34) [E73](#evidence-e73)                                           |
| 4.2 Điện/nước OCR→confirm riêng          | Staff                       | meter-reading → `/meter?taskId=...`        | `/ocr/meter-tasks/{id}`; PUT evidence; POST confirm                           | Proposed riêng; human confirmation; monotonic/date/precision/duplicate guards              | Real DB/storage workflow PASS; real model accuracy NOT VERIFIED                   | PARTIAL                                                          | [E35](#evidence-e35) [E36](#evidence-e36) [E37](#evidence-e37) [E63](#evidence-e63) [E64](#evidence-e64) |
| 4.3 Tenant xem trước hóa đơn             | Tenant                      | tenant-meters                              | FE chỉ GET `/invoices`                                                        | Capture/readings không cho Tenant                                                          | Không có feed pre-invoice trong chuỗi này                                         | MISSING                                                          | [E38](#evidence-e38) [E05](#evidence-e05)                                                                |
| 5.1 Draft hóa đơn tháng                  | Owner                       | `/invoices` nút tạo nháp                   | `POST /invoices/drafts`                                                       | Periodic + prior baseline, policies/occupancy/representative, date gate                    | Isolated invoice PASS                                                             | PARTIAL                                                          | [E39](#evidence-e39) [E41](#evidence-e41) [E43](#evidence-e43) [E79](#evidence-e79)                      |
| 5.2 Review/refresh/finalize              | Owner                       | invoice detail                             | POST `/{id}/refresh`, `/{id}/finalize`                                        | Version, current input compare, missing input/date gates, immutability                     | Isolated finalization PASS                                                        | PARTIAL                                                          | [E40](#evidence-e40) [E42](#evidence-e42)                                                                |
| 5.3 Tenant xem/nhận                      | Tenant                      | invoices/invoice detail                    | GET `/invoices`, `/{id}`                                                      | Scoped recipients; issuance event                                                          | Read available; tự động inbox/delivery với jobs off chưa đảm bảo                  | PARTIAL                                                          | [E42](#evidence-e42) [E49](#evidence-e49) [E79](#evidence-e79)                                           |
| 6.1 Transfer info/QR/reference           | Tenant                      | TenantPaymentPanel                         | `GET /invoices/{id}/transfer-instructions`                                    | Receiving account + verified outstanding; QR hoặc InstructionsOnly                         | Có source/UI tests; cần account đúng Location                                     | PARTIAL                                                          | [E47](#evidence-e47) [E49](#evidence-e49) [E76](#evidence-e76)                                           |
| 6.2 Nhận giao dịch bank tự động          | System                      | Không có bằng chứng provider live          | Bank provider abstraction                                                     | DI UnconfiguredBankProvider                                                                | Không có live provider acceptance                                                 | BLOCKED                                                          | [E28](#evidence-e28)                                                                                     |
| 6.3 Owner manual verification/allocation | Owner                       | `/payments`, Owner invoice payment panel   | POST payment-transactions, `/{id}/allocate`                                   | Statement/reference/HumanVerified; idempotency, partial/excess; audit                      | Isolated reconciliation/races PASS                                                | PARTIAL                                                          | [E44](#evidence-e44) [E45](#evidence-e45) [E46](#evidence-e46) [E48](#evidence-e48) [E80](#evidence-e80) |
| 6.4 Paid/debt/history refresh            | Tenant/Owner                | invoice/payment-history                    | invoice payment, debts/payment-history                                        | Derived from verified allocation; không lấy UI checkbox làm payment                        | Isolated PASS; chưa money/bank thật                                               | PARTIAL                                                          | [E46](#evidence-e46) [E49](#evidence-e49) [E83](#evidence-e83)                                           |
| 7.1 Early termination / normal expiry    | Tenant / Owner              | ContractLifecyclePanel                     | termination-requests / expiry-move-out                                        | Early proposedDate < EndDate; expiry >= EndDate; Active/open-renewal guards                | Isolated PASS                                                                     | PARTIAL                                                          | [E50](#evidence-e50) [E57](#evidence-e57) [E58](#evidence-e58)                                           |
| 7.2 Approve/schedule/inspect             | Owner/Staff                 | Contract lifecycle + final meter tasks     | move-out/approve, schedule, inspection, inspection-review                     | Assigned Staff, approved request, final meters hôm nay, baseline/evidence                  | Isolated PASS                                                                     | PARTIAL                                                          | [E51](#evidence-e51) [E52](#evidence-e52) [E57](#evidence-e57) [E58](#evidence-e58)                      |
| 7.3 Usage phát sinh sau hóa đơn Final    | System/Owner                | Settlement summary hiển thị blocker        | GET settlement-summary; chưa thấy operation tính/lập delta utility tự động    | Invoice đọc Periodic; ledger yêu cầu Final khớp billed date/value                          | Chặn `unbilled_final_usage_pending:*`                                             | BLOCKED                                                          | [E43](#evidence-e43) [E53](#evidence-e53)                                                                |
| 7.4 Cọc/refund/deduction/settlement      | Owner                       | Lifecycle + refund editor                  | deposit-refunds, decisions, execution; deposit-deductions; settlement         | Guard invoice coverage/debt/excess/dispute; snapshot/reference; manual refund evidence     | Isolated deposit return/damage/closure PASS; policy/provider thật chưa nghiệm thu | PARTIAL                                                          | [E54](#evidence-e54) [E55](#evidence-e55) [E59](#evidence-e59)                                           |
| 7.5 Close, room release, history         | Owner                       | Complete action trong contract detail      | POST move-out/complete                                                        | Re-read ledger; Terminated; residents ResidenceTo; Available khi không còn active contract | Isolated PASS; chỉ khả thi khi 7.3/7.4 resolved                                   | PARTIAL                                                          | [E56](#evidence-e56) [E57](#evidence-e57)                                                                |

## C. API traceability matrix

Các đường dẫn sau đều có tiền tố `/api/v1`. “Khớp source” là so DTO/client, chưa phải đã chạy màn thật trên Neon.

| Business action            | Screen/route                  | FE method                                             | HTTP method/endpoint                                                       | Controller                             | Service → repository                                                 | Entity/table                                     | Request/response compatibility                                                                                 | Result                                                                                                                             |
| -------------------------- | ----------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Create Location            | `/locations`                  | repository.save                                       | FE không gọi; BE POST `/locations`                                         | LocationsController                    | PropertyService → PostgresPropertyRepository                         | Location/locations                               | UI PortalRecord không phải LocationWrite; phải map name/address/isActive/version/reason                        | Disconnect [E01](#evidence-e01) [E02](#evidence-e02) [E08](#evidence-e08)                                                          |
| Create Room                | `/rooms/new`, Mobile setup    | executeProperty / create('rooms')                     | BE POST `/rooms`; Mobile POST `/capture/rooms`                             | Rooms/CaptureController                | SaveRoomAsync                                                        | Room/rooms                                       | RoomWrite không nhận roomTypeId; Capture RoomInput Disallow unknown fields                                     | Mismatch [E03](#evidence-e03) [E05](#evidence-e05) [E07](#evidence-e07) [E09](#evidence-e09)                                       |
| RoomType                   | Mobile setup / RoomTypes UI   | request room-types                                    | Không có route hiện tại                                                    | Không có runtime controller            | Thiết kế hiện tại bỏ                                                 | Legacy type không là catalog sống                | Không tương thích quyết định 04/11                                                                             | Scope conflict [E06](#evidence-e06) [E75](#evidence-e75)                                                                           |
| Prices/schedule            | `/pricing` API branch         | invoiceClient createPolicy/replacePolicy/saveSchedule | POST `/billing-policies`; PUT `/billing-schedules`                         | BillingPolicies, BillingSchedules      | PropertyService / InvoiceService                                     | billing_policies; settings projection            | Required schedule enums/dates/version; effective policy scope Location/Room                                    | Khớp source [E10](#evidence-e10) [E11](#evidence-e11) [E79](#evidence-e79) [E82](#evidence-e82)                                    |
| Assign Staff               | setup                         | create('assignments')                                 | POST `/capture/assignments`                                                | CaptureController                      | CaptureService → CaptureRepository → locationAssignments             | staff_employments projection                     | FE cho để trống effectiveTo; BE capture yêu cầu non-null                                                       | Mismatch [E74](#evidence-e74) [E04](#evidence-e04)                                                                                 |
| Create Resident            | onboarding                    | captureService.createResident                         | POST `/capture/residents`                                                  | CaptureController                      | CaptureService → CaptureRepository                                   | residents.room_id                                | roomId/displayLabel/residentType khớp; response {id}                                                           | Khớp source [E14](#evidence-e14) [E18](#evidence-e18)                                                                              |
| CCCD proposal              | IdentityWizard                | api.image                                             | POST `/ocr/identity/{residentId}/{side}`                                   | OcrController                          | OcrWorkflowService → LocalOcrService                                 | Không lưu ảnh identity                           | Raw JPG/PNG; proposal là field suggestions, không authoritative                                                | Khớp source [E15](#evidence-e15) [E16](#evidence-e16) [E17](#evidence-e17)                                                         |
| Confirm identity           | IdentityWizard save           | api.json                                              | POST `/capture/residents/{id}/confirm`                                     | CaptureController                      | CaptureService → CaptureRepository                                   | residents encrypted identity                     | HumanConfirmed=true; Staff only; ciphertext + lookup HMAC                                                      | Khớp source [E18](#evidence-e18)                                                                                                   |
| Invite account             | Chưa có FE                    | Không tìm thấy consumer                               | POST `/residents/{id}/invitation`; `/auth/accept-invitation`               | AccountInvitations                     | IAccountInvitations → Compact24/Identity                             | users/residents/reset-grant projection           | Backend có email/token/new password contract, FE chưa dùng                                                     | BE only [E19](#evidence-e19) [E20](#evidence-e20)                                                                                  |
| Link existing Tenant       | ContractDraftDialog           | contractClient.linkTenant                             | POST `/contracts/preparation/residents/{id}/account`                       | ContractsController                    | ContractWorkflowRepository                                           | residents.user_id                                | {tenantUserId}; chỉ Owner; khớp                                                                                | Connected source [E21](#evidence-e21) [E81](#evidence-e81)                                                                         |
| Save/release Main Draft    | MainDraft editor/release      | mainDraftClient.save/release                          | POST/PUT `/contracts/main-drafts`; POST `/{id}/release`                    | MainDraftsController                   | MainDraftService → ContractRepository + MainDraftData                | contracts/contract_residents + private files     | Release {tenantUserId,expectedVersion,reviewedFileId,humanReviewed}, Idempotency-Key                           | Connected source [E22](#evidence-e22) [E23](#evidence-e23) [E24](#evidence-e24)                                                    |
| Sign/activate              | contract workflow             | contractClient.mutate                                 | POST `/contracts/{id}/signing`, `/signing/sync`, `/activate`               | ContractsController                    | ContractService → ContractRepository + selected provider             | contracts/contract_signings/rooms                | Certificate/placement, signed canonical snapshot, idempotency; provider state controls success                 | Provider unverified [E25](#evidence-e25) [E26](#evidence-e26) [E27](#evidence-e27) [E29](#evidence-e29) [E81](#evidence-e81)       |
| Deposit verify             | contract action               | contractClient.mutate                                 | POST `/contracts/{id}/deposit-verifications`                               | ContractsController                    | VerifyDepositAsync → ContractRepository                              | payments/payment_allocations projection          | amount/bankTransactionReference/verificationReason; Owner, unique reference                                    | Manual evidence required [E25](#evidence-e25) [E77](#evidence-e77)                                                                 |
| Handover save/confirm      | Mobile ContractHandoverPanel  | shared handover client                                | POST `/contracts/{id}/handover`; tenant/staff-confirmation                 | ContractsController                    | ContractHandoverService → ContractHandoverRepository                 | contracts snapshot/history projection; file refs | version,date,conditions,asset list,reading IDs,evidence IDs; Tenant then Staff same version                    | Isolated PASS [E30](#evidence-e30) [E31](#evidence-e31) [E32](#evidence-e32) [E78](#evidence-e78)                                  |
| Meter task create          | setup / final-task action     | create / contractClient.finalTask                     | POST `/capture/meter-tasks`                                                | CaptureController                      | CaptureService → CaptureRepository                                   | operational_tasks                                | {meterId,purpose,readingDate,billingPeriod,contractId?}; Staff assignee do server quyết định                   | Source; setup prerequisites broken [E34](#evidence-e34) [E81](#evidence-e81)                                                       |
| Meter OCR/evidence/confirm | `/meter`                      | api.image / meterService.confirm                      | POST `/ocr/meter-tasks/{id}`; PUT capture evidence; POST capture confirm   | Ocr/Capture                            | OcrWorkflowService/CaptureRepository                                 | operational_tasks/meter_readings/private MinIO   | Separate evidenceId + confirmedValue + humanConfirmed; raw image, not local URI JSON                           | Isolated PASS [E35](#evidence-e35) [E36](#evidence-e36) [E37](#evidence-e37)                                                       |
| Read tenant meters         | tenant-meters                 | useWorkspaceQuery                                     | GET `/invoices`                                                            | InvoicesController                     | InvoiceService → InvoiceRepository                                   | invoice_items meter refs                         | Không có direct confirmed-meter feed trước draft                                                               | Partial [E38](#evidence-e38)                                                                                                       |
| Draft/finalize             | `/invoices`                   | api.draft/refresh/finalize                            | POST `/invoices/drafts`; `/{id}/refresh`, `/{id}/finalize`                 | InvoicesController                     | InvoiceService → InvoiceRepository                                   | invoices/invoice_items/recipients projection     | {roomId,billingPeriod yyyy-MM-01,representativeContractId}; {expectedVersion}; tiền wire dạng string           | Isolated PASS [E39](#evidence-e39) [E40](#evidence-e40) [E41](#evidence-e41) [E42](#evidence-e42) [E79](#evidence-e79)             |
| QR/account                 | payments / TenantPaymentPanel | paymentClient transferInstructions                    | PUT `/receiving-bank-accounts`; GET `/invoices/{id}/transfer-instructions` | ReceivingAccounts/TransferInstructions | TransferInstructionsService → PaymentRepository                      | receiving-account settings projection            | HumanVerified + version; invoice outstanding server-derived; Availability can be unavailable                   | Connected source [E47](#evidence-e47) [E49](#evidence-e49) [E76](#evidence-e76)                                                    |
| Register/allocate          | `/payments`                   | paymentClient register/allocate                       | POST `/payment-transactions`; `/{id}/allocate`                             | PaymentTransactionsController          | PaymentService → PaymentRepository                                   | payments/payment_allocations/history JSON        | Required statement/reference/reason/HumanVerified; allocate invoiceId/paidByUserId?/HumanVerified; idempotency | Isolated PASS [E44](#evidence-e44) [E45](#evidence-e45) [E46](#evidence-e46) [E80](#evidence-e80) [E83](#evidence-e83)             |
| Termination                | Tenant contract panel         | api.mutate                                            | POST `/contracts/{id}/termination-requests`                                | ContractsController                    | RequestTerminationAsync → ContractRepository                         | contracts move-out JSON/history                  | proposedDate/reason + Idempotency-Key; own Active contract only                                                | Isolated PASS [E50](#evidence-e50) [E58](#evidence-e58) [E77](#evidence-e77)                                                       |
| Inspection                 | Staff move-out                | api.mutate, evidence upload                           | POST move-out/schedule, inspection, evidence                               | ContractsController                    | ContractService/FinalInspection → Repository                         | contracts inspection snapshot; final meter refs  | scheduledAt UTC, staffUserId?/version; readings/assets/room/keys/evidence must match baseline                  | Isolated PASS [E51](#evidence-e51) [E52](#evidence-e52) [E58](#evidence-e58)                                                       |
| Settlement/close           | Owner lifecycle               | api.mutate                                            | POST move-out/settlement, complete; GET summary/history                    | ContractsController                    | ContractService → ContractSettlementLedger → deposit/payment readers | contracts/refund_requests/payments/rooms         | decision + expectedReference when resolved; completion actualEndDate; financials read from ledger              | Conditional isolated PASS [E53](#evidence-e53) [E54](#evidence-e54) [E55](#evidence-e55) [E56](#evidence-e56) [E57](#evidence-e57) |

## D. Missing integration report và nguyên nhân gốc

| ID  | Missing connection / bug                                        | Root cause                                                                                                                | File path / evidence                                                                | Severity                                    | FE/BE                | Required fix / API reuse / demo impact                                                                                                                                                              |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Location/Room wizard không ghi backend                          | Generic portal ở API mode trả unavailable                                                                                 | [E01](#evidence-e01) [E02](#evidence-e02) [E03](#evidence-e03)                      | P0                                          | FE                   | Adapter/client live cho đúng LocationWrite/RoomWrite, invalidate query; reuse locations/rooms, không xây API thứ hai. Chặn bước 1                                                                   |
| D02 | RoomType yêu cầu trong demo trái thiết kế hiện tại              | Quyết định bỏ Chain/RoomType 04/11; FE chưa đồng bộ                                                                       | [E06](#evidence-e06) [E07](#evidence-e07) [E75](#evidence-e75)                      | P1                                          | Scope + FE           | Chốt demo theo Location→Room hoặc phê duyệt khôi phục RoomType. Không tự thêm bảng/route chỉ để hợp thức màn cũ                                                                                     |
| D03 | Mobile setup không bootstrap được                               | Promise.all gọi capture/chains; rename dùng chain singleton cũ; room-types absent; create room gửi roomTypeId bị Disallow | [E04](#evidence-e04) [E05](#evidence-e05) [E65](#evidence-e65) [E85](#evidence-e85) | P1                                          | FE                   | Bỏ phụ thuộc catalog cũ, dùng existing capture/rooms hoặc rooms DTO. Thay test mock giả route bằng contract/API integration test                                                                    |
| D04 | Staff/tenants quản trị còn portal mock/unavailable              | ResourcePage không có live adapter                                                                                        | [E12](#evidence-e12) [E13](#evidence-e13) [E01](#evidence-e01)                      | P1                                          | FE                   | Reuse staff, assignment, residents APIs. Staff-only onboarding có thể dùng Mobile sau khi prerequisites tồn tại                                                                                     |
| D05 | Tạo account Tenant mới không hoàn tất qua UI                    | Invite và accept APIs không có consumer trong FE đã rà                                                                    | [E19](#evidence-e19) [E20](#evidence-e20) [E21](#evidence-e21) [E22](#evidence-e22) | P1                                          | FE + delivery config | Nối invite/accept flow hiện hữu; kiểm delivery; reuse account đang active là demo rút gọn, không chứng minh onboarding account mới                                                                  |
| D06 | Real signing chưa được chứng minh                               | MySign cần credential/settings/certificate, provider approval; tests dùng synthetic remote CA hoặc simulated signing      | [E27](#evidence-e27) [E29](#evidence-e29) [E66](#evidence-e66)                      | P1                                          | Integration/config   | Kiểm authenticated config và staging; chuẩn bị hai signer/certificate hợp lệ. Simulation chỉ nhánh thử nghiệm có nhãn, không đổi sang ký thật hoặc bypass activation                                |
| D07 | Không có nguồn Tenant meter trước draft                         | TenantMeterHistoryScreen đọc invoice lines; capture roles không cho Tenant                                                | [E38](#evidence-e38) [E05](#evidence-e05)                                           | P2                                          | FE + BE read scope   | Cần read projection có scope theo tenancy hoặc quyết định giới hạn demo sau Draft. Không cấp capture quyền rộng cho Tenant                                                                          |
| D08 | Không xử lý được utility delta sau Final invoice                | Invoice chọn Periodic, Final không là nguồn charge; settlement so khớp exact date/value                                   | [E43](#evidence-e43) [E53](#evidence-e53) [E54](#evidence-e54)                      | P1                                          | BE + FE              | Thiết kế approved final-charge/adjustment path liên kết Final readings, loại trừ phần đã billed, sau đó Owner review. Không sửa invoice Final hoặc tạo invoice trùng room/period                    |
| D09 | Real automatic bank reconciliation không khả dụng               | DI dùng UnconfiguredBankProvider                                                                                          | [E28](#evidence-e28) [E45](#evidence-e45) [E46](#evidence-e46)                      | P1 nếu yêu cầu auto; manual là nhánh có sẵn | Integration          | Demo trung thực bằng sao kê/giao dịch thật và Owner manual verification; nếu auto bắt buộc thì tích hợp provider/sandbox được duyệt, chống duplicate/authenticity. Không tạo payment thành công giả |
| D10 | Bootstrap nhiệm vụ/baseline khi jobs off thiếu đường UI ổn định | Task APIs có; setup hỏng; Owner meters page chủ yếu monitor; run-now còn plan/date guards                                 | [E04](#evidence-e04) [E34](#evidence-e34) [E73](#evidence-e73)                      | P1                                          | FE/config            | Sửa setup hoặc nối thao tác tạo Initial/Periodic có sẵn; không bật Jobs globally. Prepare đủ baseline/date trước buổi demo                                                                          |
| D11 | Assignment cho phép end date rỗng nhưng backend từ chối         | UI effectiveTo=null; CaptureRepository yêu cầu không null                                                                 | [E04](#evidence-e04) [E74](#evidence-e74)                                           | P2                                          | FE                   | Gửi effectiveTo hợp lệ theo API đang có, validation trên form; không đổi nghiệp vụ assignment tùy tiện                                                                                              |
| D12 | OCR thật/native/cross-machine chưa nghiệm thu                   | 2 model tests cần BHOME_OCR_LOCAL_EVALUATION_ROOT; camera/device và shared MinIO chưa chạy                                | [E63](#evidence-e63) [E64](#evidence-e64)                                           | P1 với demo bắt buộc OCR thật               | Ops/QA               | Chạy ảnh tổng hợp có license với pinned models; xác nhận manual fallback; test native camera/permissions và cùng private MinIO. Health 200 không thay proof file roundtrip                          |

**Không coi là thiếu:** đã có manual draft/finalize, Initial/Periodic/Final capture APIs, handover Staff/Tenant confirmation, manual payment ledger, deposit refund/deduction workflows, settlement reference và room release guards. Không đề xuất xây lại chúng. Một số tài liệu delivery cũ nói “ledger unconfigured” đã lỗi thời so với DI hiện tại; kết luận ở đây dựa source + integration chạy lại.

## E. Demo script có điểm dừng rõ ràng

Đây là runbook để người vận hành thực hiện; audit này **không thực thi các bước ghi vào Neon**. Không đưa mật khẩu/token/CCCD thật vào tài liệu. Với shared Neon, trước khi chạy cần approval cho danh sách mutation cụ thể; khuyến nghị dùng DB và MinIO cô lập cho rehearsal.

### E0. Dữ liệu và môi trường chuẩn bị

1. Chọn một đích Development được xác minh project/branch trong Neon Console, hoặc DB tạm. Backend phải ready; Web mode=api; Mobile đi đúng API có TLS tin cậy; MinIO cùng instance/bucket private.
2. Chuẩn bị Owner, Staff, Tenant synthetic riêng, active, có credentials nhận qua kênh riêng. Nếu demo tạo Tenant mới, D05 phải sửa trước; không thay việc mời/kích hoạt bằng insert password vào DB.
3. Dùng label `DEMO-AUDIT-20261108`, phòng `AUD-101`, capacity 2; RoomType **dừng chốt scope D02**. Giá minh họa trên môi trường synthetic: rent 3.000.000 VND/tháng, điện 3.000 VND/kWh, nước 15.000 VND/m³, service 100.000 VND/tháng; đây là test fixture, không khẳng định giá hợp pháp/thực tế. Owner phải nhập đủ loại method/scope/effective date/schedule theo form hiện có.
4. Chọn kỳ còn được phép cấu hình, ngày Draft/Final đã tới theo múi giờ nghiệp vụ, representative contract hợp lệ. Initial readings phải sớm hơn Periodic; không nén một tháng thành cùng ngày bằng sửa đồng hồ server/DB. Một meter đang có baseline không được tạo Initial lần nữa ([E34](#evidence-e34) [E35](#evidence-e35) [E41](#evidence-e41) [E42](#evidence-e42) [E43](#evidence-e43)).
5. Cần meter điện và nước active, installedOn không sau ngày đọc, đúng display/precision, assignment Staff hiệu lực; asset inventory sẵn sàng; không unresolved emergency/maintenance blocker. Chuẩn bị ít nhất một ảnh evidence synthetic hợp lệ cho handover và ảnh từng meter.
6. Chọn **real signing** với provider/certificate hai bên đã xác minh hoặc **simulation Development** được chấp thuận và hiển thị rõ. Chọn phương án payment thật/manual evidence hoặc sandbox được duyệt; không mặc định demo data là đã thu tiền.

### E1. Owner — Owner Web `/locations`, `/rooms/new`, `/pricing`, `/staff`

Tạo cơ sở `DEMO-AUDIT-20261108`, địa chỉ thử; tạo `AUD-101`; cấu hình capacity, giá/phí và lịch; assign Staff. Kỳ vọng backend tạo locations/rooms/policies/assignment, GET lại cùng ID/version sau reload. **Hiện tại phải dừng ngay ở Location/Room/Staff generic portal (D01/D04); đổi sang mock để “bấm thành công” không phải demo DB.** Không dùng Postman thay UI rồi báo toàn bước UI đã đạt.

Sau khi D01/D02 được giải quyết mới tiếp tục. Nếu rehearsal bắt đầu với dữ liệu pre-provisioned thì ghi rõ đây là demo rút gọn bỏ bước 1.

### E2. Staff — Mobile onboarding; Owner — Web contracts; Tenant — Mobile

Staff mở onboarding, chọn cơ sở/phòng đủ điều kiện, nhập người đại diện và một co-occupant tổng hợp. Chụp/chọn ảnh synthetic CCCD front/back, xem proposal, sửa dữ liệu, confirm từng người. Kỳ vọng POST resident rồi POST confirm; list trả Verified, không có raw CCCD/ảnh hay plaintext identity. Owner không thay Staff thực hiện identity-confirm API.

Owner mở `/contracts`, tạo Main Draft từ Resident đã verified, nhập kỳ thuê/terms/cọc đã duyệt; reuse account Tenant được link rõ hoặc dùng invitation flow sau khi D05 sửa. Generate/review PDF, chọn tenant account, xác nhận humanReviewed và release đúng expectedVersion/reviewedFileId. Kỳ vọng PendingSigning, không Occupied. **Dừng nếu không có active account hoặc không tạo/đọc lại private reviewed PDF được.**

Owner và Tenant lần lượt request signing rồi sync, tải evidence; chỉ tiếp khi server xác nhận đúng Signed (hoặc Simulated có nhãn cho nhánh thử). Owner xác minh cọc bằng chứng giao dịch hợp lệ, xem readiness hết blockers, Activate. Kỳ vọng Contract Active và Room Occupied trong cùng transaction. Tenant đăng nhập/xem đúng tenancy của mình. **Dừng tại provider nếu D06 chưa nghiệm thu; không đánh cọc/paid hoặc signing thành công giả.**

### E3. Staff → Tenant → Staff — Mobile nhận phòng; Owner monitor

Owner tạo Initial task điện và nước qua UI đã nối API; Staff capture mỗi meter, upload evidence và confirm. Ví dụ initial điện 1.000 kWh, nước 100 m³ (precision theo meter). Staff mở hợp đồng Active → bàn giao: inventory/condition/keys, chọn 2 confirmed reading IDs đúng ngày, upload ≥1 ảnh, save version. Tenant kiểm tra và confirm đúng version; Staff confirm sau cùng. Owner `/handovers` xem Confirmed và tải evidence. Kỳ vọng snapshot/history không đổi khi Asset condition về sau đổi; missing/conflicting version phải chặn ([E30](#evidence-e30) [E31](#evidence-e31)).

### E4. Staff — Mobile meter-reading

Mở task Periodic đúng kỳ, điện đề xuất 1.030 kWh và nước 103 m³; nhận OCR proposal, sửa nếu sai, human confirm. Kỳ vọng evidence ID riêng từng task, proposed riêng confirmed, consumption 30 kWh/3 m³, task Completed và reading persist. Retake/replay không sinh reading thứ hai. **Dừng nếu không có Initial hợp lệ trước ngày Periodic hoặc task sai kỳ/assignment.** Tenant chưa có draft sẽ chưa xem được meter qua màn hiện tại; phải trình bày giới hạn D07.

### E5. Owner — Web `/invoices`; Tenant — Mobile invoice

Owner chọn room, billingPeriod `yyyy-MM-01`, representative contract, tạo Draft; xem lines/source readings/policy versions/missingInputs. Nhấn refresh nếu nguồn đổi, review rồi Finalize với expectedVersion hiện tại. Với full-month, không điều chỉnh và các số minh họa E0/E4, tổng kiểm tra tay là 3.235.000 VND; nếu partial-month/rent source khác thì dùng **kết quả chính sách thực tế server**, không ép số này. Kỳ vọng invoice Final, read-only lines, due date, recipients; Tenant reload thấy đúng hóa đơn. Không cần global jobs; nếu chưa tới ngày scheduledFinalDate thì **dừng**, không bypass clock/date guard.

### E6. Tenant — Mobile payment; Owner — Web `/payments`

Tenant mở đúng invoice, kiểm receiving account/reference/amount/QR. Nếu account chưa cấu hình hoặc Availability khác Available/InstructionsOnly thì dừng để Owner xử lý. Tenant chuyển khoản thật theo phương án đã phê duyệt ngoài app. Owner đối chiếu sao kê, nhập bank reference, occurredAt, amount, currency VND, statementReference/reason/HumanVerified và register; response mới là PendingReview, chưa tự Paid. Owner allocate đúng invoice và eligible payer, rồi cả hai reload payment/debt/history. Kỳ vọng allocation verified, outstanding giảm đúng, replay không double-credit. Nếu không có giao dịch/bằng chứng thật hoặc sandbox được duyệt, **dừng ở hướng dẫn thanh toán**, không tạo dòng success giả. Không trình bày nhánh này là bank tự động ([E45](#evidence-e45) [E46](#evidence-e46)).

### E7. Tenant → Owner → Staff → Owner — trả phòng

Tenant contract panel gửi early termination với proposedDate >= hôm nay và < EndDate, reason; nhánh normal expiry do Owner gọi expiry-move-out, proposedDate >= EndDate. Owner approve và schedule Staff, Staff inspection đúng ngày, chụp Final điện/nước và confirm, so room/assets/keys với handover Confirmed, upload evidence. Owner inspection-review (no additional charges chỉ khi thật sự đúng, hoặc xử lý damage deduction có bằng chứng theo policy).

Đọc settlement-summary. **Dừng nếu `final_invoice_coverage_required`, `unbilled_final_usage_pending`, debt/shared liability/excess/dispute/bank review/deposit/holding còn pending**. Một rehearsal giới hạn có thể kiểm closure khi Periodic và Final đúng cùng ngày/value đã billed, không phát sinh charge thêm; đó không chứng minh trường hợp thông thường đã dùng thêm sau hóa đơn. Không sửa chỉ số, ép noAdditionalCharges hay 0 deposit để xóa blocker.

Nếu summary thật sự resolved: hoàn cọc đúng workflow request/approval/execution/evidence và số dư; Owner xác nhận settlement với reference vừa đọc; complete với actualEndDate đúng inspection date. Kỳ vọng Contract Terminated, MoveOut Completed, residents ResidenceTo cập nhật; Room Available **chỉ khi không còn active contract**, nếu còn thì Occupied. Reload history/payment/refund/occupancy để xác nhận, không lấy toast thành công làm chứng cứ ([E53](#evidence-e53)–[E59](#evidence-e59)).

## F. Kế hoạch sửa tối thiểu để đạt READY

1. **Chốt mô hình demo RoomType** theo decision 04/11 trước mọi implementation liên quan. Không tự khôi phục schema. Sửa D01/D03/D04 bằng live clients/DTO hiện hữu cho Location/Room/Staff/assignment; FE không tiếp tục serialize PortalRecord vào API.
2. **Nối invitation và acceptance** với APIs hiện có; đảm bảo delivery có đường nhận token thật an toàn. Nếu chỉ reuse account, ghi rõ scope demo rút gọn. Identity vẫn Staff-confirmed và ảnh chỉ transient.
3. **Nghiệm thu signing và PDF/storage** trên staging thật với hai signer, canonical reviewed PDF, settings/certificate hợp lệ; hoặc chấp thuận riêng demo simulation có nhãn. Không bỏ readiness/signature/deposit guard.
4. **Hoàn thiện final utility/final charge path** cho D08: so đúng meter, final observation, billing interval và lượng đã billed; không double-charge, không mutate Final invoice; nối Owner review/phát sinh obligation/payment/refund rồi summary reference. Chốt OQ/policy chưa được duyệt trước khi quyết định penalty/deduction/proration.
5. **Giữ jobs tắt**, nối UI tạo Initial/Periodic và billing manual hoặc explicit run-now đã có, chỉ trong giới hạn plan/date. Giải quyết D07 bằng scoped read model hoặc scope demo được duyệt. Giữ assignment form khớp end date backend.
6. **Payment acceptance trung thực:** manual statement verification đã có đủ khung, chỉ bổ sung provider nếu tiêu chí bắt buộc auto. Kiểm receiving account, exact/partial/excess/unmatched/duplicate, không mock success.
7. **Chạy lại full rehearsal bằng UI** trên DB/MinIO tạm, ghi bằng chứng từng actor, ID/version/state transition và network request/response đã redacted; thêm contract test phát hiện các route/DTO stale, không dùng mock khẳng định endpoint tồn tại. Sau đó kiểm native camera/OCR thật và shared storage. Chỉ đổi verdict READY sau lần chạy đủ 7 bước với kịch bản/scope đã chốt.

Ưu tiên sửa là nối API đang có và xử lý đúng khoản cuối, không rebuild Contracts/Billing/Payment/Settlement engine đang chạy được trong isolated tests. Audit không chỉnh production code hoặc tự implement kế hoạch này.

## G. Test evidence thực thi trong lượt audit

| Command/action                                                             | Environment                                                    | Result                                                                  | Evidence / practical limit                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`               | Local Windows, Release                                         | PASS, 0 warnings/errors                                                 | `.tools/demo-audit-backend-build.log`; không dừng API Debug đang chạy                                                          |
| `npm run lint`                                                             | Project Node 22                                                | PASS                                                                    | `.tools/demo-audit-frontend.log`                                                                                               |
| `npm run build`                                                            | Node 22; all workspace build scripts                           | PASS                                                                    | Client-core/Owner Web/Public Web scripts; không phải native mobile export/device                                               |
| `npm run typecheck --workspace ./src/mobile`                               | Node 22                                                        | PASS                                                                    | `.tools/demo-audit-frontend.log`                                                                                               |
| `npm test`                                                                 | Node 22, FE test harness                                       | PASS: Owner Web 162, Mobile 844                                         | 25+67 test files; mocked/DOM tests, không live UI→Neon                                                                         |
| Application unit tests Release no-build                                    | Offline test data                                              | PASS 361/361                                                            | `demo-readiness-application.trx`                                                                                               |
| Domain unit tests Release no-build                                         | Offline test data                                              | PASS 106/106                                                            | `demo-readiness-domain.trx`                                                                                                    |
| Selected Compact24 integration Release no-build                            | New loopback PostgreSQL container, random disposable databases | PASS 105/105, 0 skipped                                                 | `demo-readiness-compact24.trx`; Auth/Assignment/Property/OwnerSetup/Contract/MainDraft/Payment; workflow storage substitute    |
| Invoice + meter/capture integration Release no-build                       | Same disposable admin + independent Testcontainers PG/MinIO    | PASS 20; SKIP 2; FAIL 0                                                 | `demo-readiness-meter-invoice.trx`; real model tests skipped for missing explicit evaluation root, not silently counted passed |
| `scripts/Test-Database.ps1 -EnvironmentFile .env.neon.dev04`               | Shared Neon runtime role, READ ONLY transaction rolled back    | PASS TLS VerifyFull/ChannelBinding Require, schema and runtime EF query | `.tools/demo-audit-neon.log`; tenant_records_read=0, history applied=1/pending=0                                               |
| GET `/health/live`, `/health/ready`                                        | Running API HTTP 5240                                          | HTTP 200/200                                                            | Live availability/DB readiness only                                                                                            |
| GET MinIO `/minio/health/ready`                                            | Local localhost:9000                                           | HTTP 200                                                                | Không chứng minh cross-machine object visibility                                                                               |
| GET contracts/invoices without token                                       | Running API                                                    | HTTP 401/401, expected                                                  | Authentication guard check; role/object scope proved separately in isolated tests                                              |
| GET Swagger v1 inventory                                                   | Running API                                                    | 272 paths; stale Chain/RoomType paths absent                            | `.tools/demo-audit-runtime-routes.json`; 401 on arbitrary path không chứng minh path exists                                    |
| Authenticated read-only role walkthrough on Neon                           | Live                                                           | NOT EXECUTED                                                            | Không tạo login/session/refresh token khi chưa có approval shared writes; không suy ra isolated roles proof = live acceptance  |
| Native Android/iOS OCR/camera; MySign/bank provider; multi-machine storage | Real integrations                                              | NOT VERIFIED                                                            | Không có bằng chứng thực thi trong audit; 2 real-model tests skip                                                              |

Lệnh tái lập các test đã chọn (chạy từ repo root; test admin chỉ là DB loopback **mới/tạm**, tuyệt đối không gán Neon):

```powershell
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj -c Release --no-build
dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj -c Release --no-build
# Set BHOME_COMPACT24_TEST_ADMIN qua môi trường cục bộ tới PostgreSQL tạm.
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --no-build --filter 'FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~Compact24MainDraftRegressionTests|FullyQualifiedName~Compact24PaymentRegressionTests|FullyQualifiedName~Compact24PropertyRegressionTests|FullyQualifiedName~Compact24OwnerSetupTests|FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~Compact24AssignmentTests'
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --no-build --filter 'FullyQualifiedName~Compact24InvoiceRegressionTests|FullyQualifiedName~CompactMeterOcrWorkflowTests|FullyQualifiedName~CaptureWorkflowTests'
```

TRX/logs nằm trong `.tools/demo-audit-results` và `.tools/demo-audit-*.log`, bị Git ignore; số test ở đây được lấy từ lần thực thi, không lấy từ tài liệu cũ. Không chạy toàn bộ backend integration suite; không tuyên bố toàn CI đã green. Không chạy commands seed demo hiện hữu vì chưa xác minh chúng sẽ nhắm DB nào. Container audit riêng được dọn sau kiểm thử; không dừng container development PostgreSQL/MinIO.

## 2. End-to-end state / foreign-key validation

| Link/state                       | Điều kiện source đã kiểm                                                                                           | Kết quả / rủi ro                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location → RoomType → Room       | Current model là Location→Room, RoomWrite không nhận type                                                          | Exact requested chain không tồn tại theo decision đã ghi, không khôi phục legacy migration ([E06](#evidence-e06) [E07](#evidence-e07) [E75](#evidence-e75))                                                               |
| Location → Staff                 | Assignment effective dates và scope đọc lại theo server                                                            | Isolated tests kiểm expired/revoked/cross-location; UI capture endDate mismatch ([E61](#evidence-e61) [E74](#evidence-e74))                                                                                               |
| Room → Resident → Tenant account | Resident.RoomId; verified identity; link TenantUserId explicit                                                     | Tạo resident không tự tạo account usable; thiếu invitation FE ([E14](#evidence-e14) [E18](#evidence-e18) [E19](#evidence-e19) [E21](#evidence-e21))                                                                       |
| Tenant → Contract → occupancy    | Sealed snapshot, tenant account, signatures, deposit, date/capacity/conflict                                       | Activate đổi Contract Active và Room Occupied; pending không đủ ([E25](#evidence-e25) [E26](#evidence-e26))                                                                                                               |
| Room → Meter → task → reading    | Active meter, profile/precision, task purpose/date, evidence ownership                                             | Initial/Periodic chronology; current value không thấp hơn baseline; duplicate task confirm idempotent ([E34](#evidence-e34) [E35](#evidence-e35))                                                                         |
| Handover ↔ baseline              | Reading IDs/date/value/hash và asset snapshot, Tenant/Staff version                                                | Confirmed handover dùng cho inspection; billing baseline lấy prior confirmed meter reading, không tự lấy input tùy ý trong handover ([E30](#evidence-e30) [E31](#evidence-e31) [E43](#evidence-e43) [E52](#evidence-e52)) |
| Reading → Invoice                | Exactly one completed Periodic per utility/period, linked uploaded evidence, valid prior reading; policy snapshots | Không tự dùng Final reading để phát sinh final bill ([E43](#evidence-e43))                                                                                                                                                |
| Invoice → Payment → Debt/History | Real transfer record + verified allocation; lock/idempotency + financial projection                                | Register PendingReview chưa Paid; Amount min(transfer,outstanding), excess giữ review ([E45](#evidence-e45) [E46](#evidence-e46))                                                                                         |
| Contract → request → inspection  | Active, no open renewal; early vs expiry dates; assigned Staff/final readings/baseline                             | Request/approve chưa terminate; same-day inspection checks enforce chronology ([E50](#evidence-e50) [E51](#evidence-e51) [E52](#evidence-e52))                                                                            |
| Inspection → settlement          | Coverage từng tháng, debt/disputes/excess/bank review, exact billed final observation, deposit/refund/deduction    | Final utility delta thiếu charge path, giữ blocker; shared liability không tự phân bổ ([E53](#evidence-e53) [E54](#evidence-e54) [E55](#evidence-e55))                                                                    |
| Settlement → close → release     | Re-read resolved ledger và reference, actualEndDate trùng inspection; otherActive check                            | Room chỉ Available khi đủ; lịch sử retained, không xóa contract; còn co-tenant active giữ Occupied ([E56](#evidence-e56))                                                                                                 |

## Phụ lục: catalog chứng cứ source

Mỗi mã dưới đây trỏ file và dòng bắt đầu đoạn đã kiểm. Các link dùng path tương đối từ báo cáo để review trên repository; line numbers là baseline đã nêu, có thể thay đổi ở commit sau. Không dùng tài liệu mô tả endpoint thay cho source route/controller.

<a id="evidence-e01"></a>

- **E01 — Generic portal repository fails closed in API mode:** [src/owner-web/src/app/PortalProvider.tsx:28](../../src/owner-web/src/app/PortalProvider.tsx#L28).

<a id="evidence-e02"></a>

- **E02 — Location wizard writes demo repository:** [src/owner-web/src/features/locations/pages/LocationsListPage.tsx:139](../../src/owner-web/src/features/locations/pages/LocationsListPage.tsx#L139).

<a id="evidence-e03"></a>

- **E03 — Room/config mutation writes portal repository:** [src/owner-web/src/features/property/usePropertyMutation.ts:8](../../src/owner-web/src/features/property/usePropertyMutation.ts#L8).

<a id="evidence-e04"></a>

- **E04 — Mobile setup loads removed Chain route:** [src/mobile/src/app/setup.tsx:50](../../src/mobile/src/app/setup.tsx#L50).

<a id="evidence-e05"></a>

- **E05 — Capture RoomInput rejects unmapped roomTypeId:** [src/backend/BHome.Application/Ocr/CaptureContracts.cs:10](../../src/backend/BHome.Application/Ocr/CaptureContracts.cs#L10).

<a id="evidence-e06"></a>

- **E06 — Recorded decision removes Chain and RoomType:** [docs/development/API_RESET_REVIEW_2026-11-04.md:5](../../docs/development/API_RESET_REVIEW_2026-11-04.md#L5).

<a id="evidence-e07"></a>

- **E07 — Current Room DTO has no RoomType:** [src/backend/BHome.Application/PropertyManagement/PropertyContracts.cs:46](../../src/backend/BHome.Application/PropertyManagement/PropertyContracts.cs#L46).

<a id="evidence-e08"></a>

- **E08 — Location controller and creation route:** [src/backend/BHome.Api/Controllers/LocationsController.cs:17](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L17).

<a id="evidence-e09"></a>

- **E09 — Room routes, permission and PropertyService:** [src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs:10](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L10).

<a id="evidence-e10"></a>

- **E10 — Pricing has a real API branch:** [src/owner-web/src/features/property/FinancePages.tsx:17](../../src/owner-web/src/features/property/FinancePages.tsx#L17).

<a id="evidence-e11"></a>

- **E11 — Billing policy and schedule UI:** [src/owner-web/src/features/invoices/BillingConfigurationPage.tsx:24](../../src/owner-web/src/features/invoices/BillingConfigurationPage.tsx#L24).

<a id="evidence-e12"></a>

- **E12 — Staff administration still generic portal:** [src/owner-web/src/features/staff/pages/StaffPage.tsx:3](../../src/owner-web/src/features/staff/pages/StaffPage.tsx#L3).

<a id="evidence-e13"></a>

- **E13 — Tenant administration still generic portal:** [src/owner-web/src/features/tenants/pages/TenantsPage.tsx:3](../../src/owner-web/src/features/tenants/pages/TenantsPage.tsx#L3).

<a id="evidence-e14"></a>

- **E14 — Real Staff onboarding and resident creation:** [src/mobile/src/screens/OnboardingScreen.tsx:30](../../src/mobile/src/screens/OnboardingScreen.tsx#L30).

<a id="evidence-e15"></a>

- **E15 — Identity OCR request and manual confirmation UI:** [src/mobile/src/features/onboarding/IdentityWizard.tsx:236](../../src/mobile/src/features/onboarding/IdentityWizard.tsx#L236).

<a id="evidence-e16"></a>

- **E16 — Binary identity OCR endpoint:** [src/backend/BHome.Api/Controllers/Ocr/OcrController.cs:14](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs#L14).

<a id="evidence-e17"></a>

- **E17 — OCR clears temporary image buffer:** [src/backend/BHome.Infrastructure/Ocr/LocalOcrService.cs:110](../../src/backend/BHome.Infrastructure/Ocr/LocalOcrService.cs#L110).

<a id="evidence-e18"></a>

- **E18 — Staff identity confirmation and encryption:** [src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs:93](../../src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs#L93).

<a id="evidence-e19"></a>

- **E19 — Existing invitation/acceptance APIs:** [src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs:12](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L12).

<a id="evidence-e20"></a>

- **E20 — Account creation, random password and invitation delivery:** [src/backend/BHome.Infrastructure/IdentityAccess/AccountInvitations.cs:36](../../src/backend/BHome.Infrastructure/IdentityAccess/AccountInvitations.cs#L36).

<a id="evidence-e21"></a>

- **E21 — Existing account reuse is connected:** [src/owner-web/src/features/contracts/ContractDraftDialog.tsx:229](../../src/owner-web/src/features/contracts/ContractDraftDialog.tsx#L229).

<a id="evidence-e22"></a>

- **E22 — Reviewed PDF and version-bound Main Draft release:** [src/owner-web/src/features/contracts/MainDraftReleasePanel.tsx:88](../../src/owner-web/src/features/contracts/MainDraftReleasePanel.tsx#L88).

<a id="evidence-e23"></a>

- **E23 — Main Draft API release route:** [src/backend/BHome.Api/Controllers/MainDraftsController.cs:30](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L30).

<a id="evidence-e24"></a>

- **E24 — Server Main Draft release and account/snapshot guards:** [src/backend/BHome.Application/Contracts/MainDraftService.cs:294](../../src/backend/BHome.Application/Contracts/MainDraftService.cs#L294).

<a id="evidence-e25"></a>

- **E25 — Signing/deposit/effective-date readiness guards:** [src/backend/BHome.Application/Contracts/ContractService.cs:278](../../src/backend/BHome.Application/Contracts/ContractService.cs#L278).

<a id="evidence-e26"></a>

- **E26 — Activation transaction and occupancy transition:** [src/backend/BHome.Application/Contracts/ContractService.cs:336](../../src/backend/BHome.Application/Contracts/ContractService.cs#L336).

<a id="evidence-e27"></a>

- **E27 — Default-disabled simulation and legal-signature labeling:** [src/backend/BHome.Infrastructure/Contracts/DevelopmentContractSigningAdapter.cs:13](../../src/backend/BHome.Infrastructure/Contracts/DevelopmentContractSigningAdapter.cs#L13).

<a id="evidence-e28"></a>

- **E28 — Unconfigured bank adapter registration:** [src/backend/BHome.Infrastructure/DependencyInjection.cs:173](../../src/backend/BHome.Infrastructure/DependencyInjection.cs#L173).

<a id="evidence-e29"></a>

- **E29 — Real provider configuration prerequisites:** [src/digital-signing/BHome.DigitalSigning.Application/DigitalSigningPolicy.cs:12](../../src/digital-signing/BHome.DigitalSigning.Application/DigitalSigningPolicy.cs#L12).

<a id="evidence-e30"></a>

- **E30 — Move-in snapshots, meter/evidence/version validation:** [src/backend/BHome.Application/Contracts/ContractHandoverService.cs:52](../../src/backend/BHome.Application/Contracts/ContractHandoverService.cs#L52).

<a id="evidence-e31"></a>

- **E31 — Tenant then Staff same-version confirmation:** [src/backend/BHome.Application/Contracts/ContractHandoverService.cs:77](../../src/backend/BHome.Application/Contracts/ContractHandoverService.cs#L77).

<a id="evidence-e32"></a>

- **E32 — Staff/Tenant handover UI:** [src/mobile/src/features/contracts/ContractHandoverPanel.tsx:24](../../src/mobile/src/features/contracts/ContractHandoverPanel.tsx#L24).

<a id="evidence-e33"></a>

- **E33 — Owner handover page opens contract monitoring:** [src/owner-web/src/features/handovers/pages/HandoversPage.tsx:5](../../src/owner-web/src/features/handovers/pages/HandoversPage.tsx#L5).

<a id="evidence-e34"></a>

- **E34 — Manual Initial/Periodic/Final task validation:** [src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs:147](../../src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs#L147).

<a id="evidence-e35"></a>

- **E35 — Meter/evidence/chronology/consumption confirmation:** [src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs:228](../../src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs#L228).

<a id="evidence-e36"></a>

- **E36 — Staff meter OCR screen:** [src/mobile/src/app/meter.tsx:235](../../src/mobile/src/app/meter.tsx#L235).

<a id="evidence-e37"></a>

- **E37 — Confirmed reading HTTP client:** [src/mobile/src/services/meterService.ts:10](../../src/mobile/src/services/meterService.ts#L10).

<a id="evidence-e38"></a>

- **E38 — Tenant meter history is derived from invoice lines:** [src/mobile/src/screens/TenantMeterHistoryScreen.tsx:12](../../src/mobile/src/screens/TenantMeterHistoryScreen.tsx#L12).

<a id="evidence-e39"></a>

- **E39 — Owner manual draft invoice action:** [src/owner-web/src/features/invoices/pages/InvoicesPage.tsx:197](../../src/owner-web/src/features/invoices/pages/InvoicesPage.tsx#L197).

<a id="evidence-e40"></a>

- **E40 — Manual invoice draft/finalize/schedule endpoints:** [src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs:17](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L17).

<a id="evidence-e41"></a>

- **E41 — Room-period idempotency, schedule and draft date:** [src/backend/BHome.Application/Billing/InvoiceService.cs:70](../../src/backend/BHome.Application/Billing/InvoiceService.cs#L70).

<a id="evidence-e42"></a>

- **E42 — Final invoice guards, recalculation and issuance event:** [src/backend/BHome.Application/Billing/InvoiceService.cs:151](../../src/backend/BHome.Application/Billing/InvoiceService.cs#L151).

<a id="evidence-e43"></a>

- **E43 — Billing only selects Periodic readings with valid prior baseline:** [src/backend/BHome.Infrastructure/Billing/InvoiceRepository.cs:67](../../src/backend/BHome.Infrastructure/Billing/InvoiceRepository.cs#L67).

<a id="evidence-e44"></a>

- **E44 — Owner manual register/allocate/reject APIs:** [src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs:12](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L12).

<a id="evidence-e45"></a>

- **E45 — Verified statement registration, idempotency and pending review:** [src/backend/BHome.Application/PaymentsDebt/PaymentService.cs:46](../../src/backend/BHome.Application/PaymentsDebt/PaymentService.cs#L46).

<a id="evidence-e46"></a>

- **E46 — Verified allocation, partial/excess handling and ledger effect:** [src/backend/BHome.Application/PaymentsDebt/PaymentService.cs:131](../../src/backend/BHome.Application/PaymentsDebt/PaymentService.cs#L131).

<a id="evidence-e47"></a>

- **E47 — Server bank account, QR/reference and outstanding balance:** [src/backend/BHome.Application/PaymentsDebt/TransferInstructionsService.cs:54](../../src/backend/BHome.Application/PaymentsDebt/TransferInstructionsService.cs#L54).

<a id="evidence-e48"></a>

- **E48 — Owner payment administration UI:** [src/owner-web/src/features/payments/PaymentManagementPage.tsx:31](../../src/owner-web/src/features/payments/PaymentManagementPage.tsx#L31).

<a id="evidence-e49"></a>

- **E49 — Tenant transfer details and payment refresh UI:** [src/mobile/src/screens/TenantPaymentPanel.tsx:28](../../src/mobile/src/screens/TenantPaymentPanel.tsx#L28).

<a id="evidence-e50"></a>

- **E50 — Early termination vs normal expiry request guards:** [src/backend/BHome.Application/Contracts/ContractService.cs:565](../../src/backend/BHome.Application/Contracts/ContractService.cs#L565).

<a id="evidence-e51"></a>

- **E51 — Staff final readings, evidence and assignment checks:** [src/backend/BHome.Application/Contracts/ContractService.cs:611](../../src/backend/BHome.Application/Contracts/ContractService.cs#L611).

<a id="evidence-e52"></a>

- **E52 — Confirmed handover baseline vs final inspection snapshot:** [src/backend/BHome.Application/Contracts/ContractFinalInspectionService.cs:24](../../src/backend/BHome.Application/Contracts/ContractFinalInspectionService.cs#L24).

<a id="evidence-e53"></a>

- **E53 — Unbilled final usage blocks settlement:** [src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs:73](../../src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs#L73).

<a id="evidence-e54"></a>

- **E54 — Final invoice coverage, debt and pending disputes:** [src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs:57](../../src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs#L57).

<a id="evidence-e55"></a>

- **E55 — Owner settlement approval bound to current reference:** [src/backend/BHome.Application/Contracts/ContractService.cs:636](../../src/backend/BHome.Application/Contracts/ContractService.cs#L636).

<a id="evidence-e56"></a>

- **E56 — Fresh ledger check before contract/room release:** [src/backend/BHome.Application/Contracts/ContractService.cs:675](../../src/backend/BHome.Application/Contracts/ContractService.cs#L675).

<a id="evidence-e57"></a>

- **E57 — Owner lifecycle, inspection review, refund and settlement UI:** [src/owner-web/src/features/contracts/ContractLifecyclePanel.tsx:38](../../src/owner-web/src/features/contracts/ContractLifecyclePanel.tsx#L38).

<a id="evidence-e58"></a>

- **E58 — Tenant request and Staff move-out UI:** [src/mobile/src/features/contracts/ContractLifecyclePanel.tsx:24](../../src/mobile/src/features/contracts/ContractLifecyclePanel.tsx#L24).

<a id="evidence-e59"></a>

- **E59 — Deposit refund request/approval/evidence routes:** [src/backend/BHome.Api/Controllers/RefundsController.cs:17](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L17).

<a id="evidence-e60"></a>

- **E60 — Logical entities project onto physical Compact24 tables:** [src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DomainModel.cs:72](../../src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DomainModel.cs#L72).

<a id="evidence-e61"></a>

- **E61 — Loopback-only disposable DB fixture:** [tests/backend/BHome.IntegrationTests/Compact24/Compact24AuthTests.cs:262](../../tests/backend/BHome.IntegrationTests/Compact24/Compact24AuthTests.cs#L262).

<a id="evidence-e62"></a>

- **E62 — Workflow fixture explicitly substitutes storage:** [tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs:16](../../tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs#L16).

<a id="evidence-e63"></a>

- **E63 — Real isolated PostgreSQL and MinIO Testcontainers:** [tests/backend/BHome.IntegrationTests/Ocr/CaptureWorkflowTests.cs:512](../../tests/backend/BHome.IntegrationTests/Ocr/CaptureWorkflowTests.cs#L512).

<a id="evidence-e64"></a>

- **E64 — Real OCR model tests require explicit model root:** [tests/backend/BHome.IntegrationTests/Ocr/CompactMeterOcrWorkflowTests.cs:26](../../tests/backend/BHome.IntegrationTests/Ocr/CompactMeterOcrWorkflowTests.cs#L26).

<a id="evidence-e65"></a>

- **E65 — Mocked test accepts route missing from actual API:** [src/mobile/src/**tests**/setup-api.test.tsx:75](../../src/mobile/src/__tests__/setup-api.test.tsx#L75).

<a id="evidence-e66"></a>

- **E66 — Isolated LibreOffice converter prerequisite:** [src/backend/BHome.Infrastructure/Contracts/PrivateContractConversion.cs:17](../../src/backend/BHome.Infrastructure/Contracts/PrivateContractConversion.cs#L17).

<a id="evidence-e67"></a>

- **E67 — Role-scoped mobile routes:** [src/mobile/src/features/workspace/navigation.ts:4](../../src/mobile/src/features/workspace/navigation.ts#L4).

<a id="evidence-e68"></a>

- **E68 — Owner Web navigation entry points:** [src/owner-web/src/app/router.tsx:70](../../src/owner-web/src/app/router.tsx#L70).

<a id="evidence-e69"></a>

- **E69 — Runtime readiness endpoint:** [src/backend/BHome.Api/Program.cs:58](../../src/backend/BHome.Api/Program.cs#L58).

<a id="evidence-e70"></a>

- **E70 — Runtime EF context and repository composition:** [src/backend/BHome.Infrastructure/DependencyInjection.cs:41](../../src/backend/BHome.Infrastructure/DependencyInjection.cs#L41).

<a id="evidence-e71"></a>

- **E71 — Development file fallback and override precedence:** [src/backend/BHome.Api/Configuration/DevelopmentEnvironmentFile.cs:10](../../src/backend/BHome.Api/Configuration/DevelopmentEnvironmentFile.cs#L10).

<a id="evidence-e72"></a>

- **E72 — Explicit runtime environment file selection:** [scripts/Start-Api.ps1:1](../../scripts/Start-Api.ps1#L1).

<a id="evidence-e73"></a>

- **E73 — Explicit Owner billing operation without enabling global jobs:** [src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs:20](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L20).

<a id="evidence-e74"></a>

- **E74 — Capture assignment rejects null end date:** [src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs:63](../../src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs#L63).

<a id="evidence-e75"></a>

- **E75 — Current room save deliberately clears old RoomType:** [src/backend/BHome.Application/PropertyManagement/PropertyService.cs:191](../../src/backend/BHome.Application/PropertyManagement/PropertyService.cs#L191).

<a id="evidence-e76"></a>

- **E76 — Receiving account and transfer-instructions routes:** [src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs:11](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L11).

<a id="evidence-e77"></a>

- **E77 — Contract DTOs and lifecycle input contracts:** [src/backend/BHome.Application/Contracts/ContractContracts.cs:10](../../src/backend/BHome.Application/Contracts/ContractContracts.cs#L10).

<a id="evidence-e78"></a>

- **E78 — Versioned handover input/output contract:** [src/backend/BHome.Application/Contracts/ContractHandoverContracts.cs:7](../../src/backend/BHome.Application/Contracts/ContractHandoverContracts.cs#L7).

<a id="evidence-e79"></a>

- **E79 — Invoice draft/finalize request contracts:** [src/backend/BHome.Application/Billing/InvoiceContracts.cs:15](../../src/backend/BHome.Application/Billing/InvoiceContracts.cs#L15).

<a id="evidence-e80"></a>

- **E80 — Verified transfer registration/allocation contracts:** [src/backend/BHome.Application/PaymentsDebt/PaymentContracts.cs:9](../../src/backend/BHome.Application/PaymentsDebt/PaymentContracts.cs#L9).

<a id="evidence-e81"></a>

- **E81 — Shared authenticated contract client:** [packages/client-core/src/contracts.ts:326](../../packages/client-core/src/contracts.ts#L326).

<a id="evidence-e82"></a>

- **E82 — Shared typed invoice client:** [packages/client-core/src/invoices.ts:84](../../packages/client-core/src/invoices.ts#L84).

<a id="evidence-e83"></a>

- **E83 — Shared typed payment client:** [packages/client-core/src/payments.ts:145](../../packages/client-core/src/payments.ts#L145).

<a id="evidence-e84"></a>

- **E84 — Closure fixture constructs matching Periodic/Final readings and finalized invoice directly:** [tests/backend/BHome.IntegrationTests/PaymentsDebt/ContractClosureTests.cs:31](../../tests/backend/BHome.IntegrationTests/PaymentsDebt/ContractClosureTests.cs#L31).

<a id="evidence-e85"></a>

- **E85 — Capture compatibility endpoints reuse PropertyService:** [src/backend/BHome.Application/Ocr/CaptureService.cs:20](../../src/backend/BHome.Application/Ocr/CaptureService.cs#L20).

<a id="evidence-e86"></a>

- **E86 — Handover can choose Initial or Periodic readings; not an independent billing baseline:** [src/backend/BHome.Infrastructure/Contracts/ContractHandoverRepository.cs:19](../../src/backend/BHome.Infrastructure/Contracts/ContractHandoverRepository.cs#L19).

<a id="evidence-e87"></a>

- **E87 — Default mode is mock unless explicitly api:** [src/owner-web/src/services/config.ts:1](../../src/owner-web/src/services/config.ts#L1).

## H. Mười câu trả lời cuối cùng

1. **Which stages can be demonstrated now?** Backend có thể chứng minh các phần cấu hình Location/Room/price, xác minh identity, Main Draft/signing thử, activation, handover, invoice, manual payment và closure bằng kiểm thử cô lập đã chạy. FE có các màn live hợp đồng/handover/billing/payment/move-out, nhưng chưa có bằng chứng buổi demo UI đủ chuỗi trên Neon; chỉ coi chúng là candidate demo rút gọn sau khi chuẩn bị dữ liệu đúng.
2. **Which stages are partially implemented?** Cả 7 stage có phần chạy được; cấu hình đầu luồng/Staff/Tenant mới, OCR device/model, pre-invoice meter view, signing live và final charges là các phần chưa khép kín. Xem B và D để phân biệt partial, backend-only, missing, blocked.
3. **Which stages cannot be demonstrated?** Exact RoomType stage trái current model; Location/Room Web thao tác ghi thật còn đứt; account invite/accept chưa nối UI; real signing/bank tự động chưa được chứng minh; generic final-usage settlement sau paid Final invoice chưa có operation khép kín.
4. **What is the single most critical blocker?** **D01: Owner Web Location/Room setup vẫn gọi demo/unavailable repository**, nên exact demo từ dữ liệu mới dừng ở bước 1. RoomType scope conflict D02 cần giải quyết cùng lúc, không né bằng mock success.
5. **Which FE screens are not connected to real backend APIs?** `/locations` wizard, Room property/create flows, `/staff`, `/tenants`, RoomType/template configuration dùng generic portal/React state; API mode không biến chúng thành persistence thật. Mobile `/setup` có HTTP calls nhưng gọi stale route/DTO. `/pricing` có live branch, không gộp nó vào nhóm mock; `/handovers` API mode có contract monitoring.
6. **Which existing APIs are unused or incorrectly used?** Location/Room/Staff/assignment CRUD chưa được Web setup consumer dùng đúng; resident invitation/acceptance chưa có consumer FE đã tìm; Mobile gọi capture/chains và room-types đã bỏ, gửi roomTypeId vào Capture RoomInput bị cấm; optional effectiveTo trái validation. Manual invoice/payment/lifecycle APIs đã được dùng và nên reuse.
7. **What data must exist before starting the demo?** Active synthetic Owner/Staff/Tenant và account link; Location/Room/capacity/status; Staff assignment hiệu lực; effective price/fee/billing schedule; meter điện/nước/profile/precision/install date; earlier confirmed baseline, đúng kỳ tasks/evidence; asset inventory và confirmed handover; signing/config/certificate/PDF; receiving account và bằng chứng bank/refund thực; đủ invoice coverage, không debt/dispute/excess/holding pending. Không tự seed Neon để tạo prerequisites.
8. **Can the whole demo run with background jobs disabled?** Engine có manual task/create/draft/finalize và explicit run-now nên scheduler không phải điều kiện bắt buộc cho từng mutation; nhưng **hiện chưa chạy được toàn bộ exact UI flow với jobs off** vì setup UI/stale API và gaps D01–D10. Notification/reminder delivery tự động cũng không được bảo đảm. Giữ global jobs off, nối thao tác hiện có.
9. **Can payment be demonstrated honestly using the current supported integration?** **Có điều kiện qua Owner manual verification** với sao kê/giao dịch thật, hoặc sandbox đã được phê duyệt và gắn nhãn trên môi trường cô lập; source/tests chứng minh ledger. **Chưa** thể gọi đây là auto bank integration. Audit không phát sinh payment thật hoặc fake success và chưa nghiệm thu bank provider hiện tại.
10. **What exact changes are required to reach READY?** Chốt lại RoomType scope; nối Web setup/Staff và sửa Mobile stale contracts; nối invitation/acceptance; nghiệm thu signing/PDF/provider và OCR/native/shared storage; bổ sung approved final-utility/final-charge path không double billing; chuẩn bị dữ liệu/date/receiving account đúng, dùng manual operations/jobs off; chạy đủ rehearsal qua UI với real/sandbox evidence đã duyệt, lưu proof state/permissions/history. Chỉ sau lần thực thi trọn vẹn mới chuyển verdict READY.
