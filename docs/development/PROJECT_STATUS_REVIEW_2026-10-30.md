# Rà soát hiện trạng BHOME — 30/10/2026

Đối chiếu tại commit `6f57628`, nhánh `develop`; working tree sạch trước rà soát.
Đây là rà soát tài liệu, mã nguồn và một phần kiểm thử, không phải nghiệm thu E2E hoặc kiểm toán bảo mật đầy đủ.
Không thay đổi mã ứng dụng, schema, cấu hình hoặc dữ liệu; không chạy migration, commit hay push.

## Nguồn và cách đánh giá

- `docs/reports/BHOME_Report-1_Project_Introduction (3).docx`: v1.3, mục đích, phạm vi và exclusions.
- `docs/reports/BHOME_Report-2_Project_Management_Plan (3).docx`: v1.2, kế hoạch ba Sprint và quality gates.
- `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`: v1.3, có revision đến 21/10/2026; dùng master UC, permission matrix, GBR, DBR, jobs và OQ làm chuẩn nghiệp vụ.
- `docs/reports/Report-4_Software Design Specification (5).docx`: kiến trúc, dữ liệu và bảo mật; vẫn có placeholder `table_name3`.
- Các tài liệu architecture, API và development; đặc biệt `STAFF_LOCATION_ASSIGNMENTS.md`, `OCR_MOBILE_DELIVERY.md`, `INTERNAL_OCR.md`, `OWNER_PORTAL_STITCH.md`.
- Đối chiếu controller, DI, application, repository, domain, EF model/migrations, client routes/data sources và tests thực tế.

DOCX được trích nội dung XML để đọc; không kiểm chứng hình vẽ nhúng hay bố cục Word. Không tìm thấy Report 5–7, workbook kiểm thử hoặc tài liệu workshop trong danh sách file hiện có của `docs`.
Tên file và revision khác danh mục AGENTS.md. Mã FE giữa Report 1 và SRS cũng khác nhau; báo cáo này ưu tiên BF/UC và mapping SRS, không đồng nhất FE chỉ theo số.

“Có triển khai” nghĩa là tìm thấy xử lý thật trong mã nguồn, không tự suy ra đã chạy đạt trong môi trường triển khai. “Demo” nghĩa là dữ liệu/lifecycle ở client mô phỏng; “chưa có backend” nghĩa là chưa tìm thấy vertical slice tương ứng trong backend chính được rà soát.

## Hiểu về sản phẩm

BHOME quản lý vận hành một hệ thống nhà trọ nhiều cơ sở. Owner cấu hình và quyết định; Staff tác nghiệp theo Location đang được phân công; Tenant tự phục vụ trên dữ liệu của mình; Guest chỉ xem thông tin được duyệt công khai.

Chuỗi nghiệp vụ chính: cấu hình cơ sở/phòng/giá và phân công → ghi nhận từng cư dân → hợp đồng giữ chỗ hoặc hợp đồng thuê, ký và xác minh tiền → kích hoạt, nhận phòng → ghi chỉ số, hóa đơn, thu tiền/công nợ → gia hạn hoặc trả phòng/quyết toán. Song song là tác vụ nhân viên, sự cố/bảo trì, thông báo và tài chính/What-if.

Các chốt quan trọng: OCR chỉ đề xuất; Staff xác nhận; hợp đồng không Active chỉ vì đã gửi yêu cầu ký; tiền chuyển chưa xác minh không được coi là đã thu; hóa đơn finalized không sửa trực tiếp; nghiệp vụ tiền/phòng phải chống xử lý trùng và cạnh tranh; Guest không đặt phòng/thanh toán/gửi enquiry; đăng ký tạm trú diễn ra ngoài BHOME.

## Ma trận hiện trạng

| Phạm vi | Hiện có | Phần còn thiếu để hoàn thành nghiệp vụ |
| --- | --- | --- |
| UC-01–03, GBR-01/02/13: tài khoản | Identity, login email, JWT, refresh rotation, logout/logout-all, me, đổi/reset mật khẩu, fixed permissions, audit; mobile dùng SecureStore | Gửi email reset vẫn `UnconfiguredPasswordResetDelivery`; chưa có MFA hoàn chỉnh, cập nhật hồ sơ đầy đủ và kích hoạt Tenant theo hợp đồng |
| BF-01 / UC-04 | Chain, Location, Room tối thiểu; API setup và mobile | Room Type, cấu hình phòng đầy đủ, lifecycle phòng theo hợp đồng; nối Owner Web với API |
| BF-01 / UC-05–07 / GBR-08 | Các màn tài sản, giá/phí, phòng/dashboard ở Owner Web | Backend tài sản, biểu giá theo hiệu lực, occupancy/history; model Room hiện chỉ gồm LocationId và RoomNumber ngoài trường dùng chung |
| BF-02 / UC-08 / DBR-01 | Tạo Staff trong capture API; phân công theo ngày, kiểm role active, tra Location hiện tại, chống khoảng ngày chồng lấn | Quản lý employment/compensation, sửa/ngừng phân công có lịch sử, UI quản trị nối API đầy đủ |
| BF-02 / UC-09–12 | Có tác vụ ghi đồng hồ tối thiểu, gắn Location qua Meter/Room | Chưa có lịch ca và tác vụ tổng quát với tiến độ, blocker, Owner duyệt/rework; các màn Owner đang demo |
| BF-03 / UC-13 / GBR-05/07 | Resident gắn Room; OCR CCCD, nhập tay, human confirmation; mã hóa/HMAC; lưu trạng thái và actor/time | Household/ContractResident, tài khoản Tenant, onboarding đầy đủ, lifecycle người ở gắn hợp đồng |
| BF-03/04 / UC-14–16 / GBR-04 | Owner Web demo; module ký PDF Viettel độc lập | Chưa có Holding/Main Contract/addendum/renewal trong backend chính; tiền cọc, activation, occupancy và tích hợp signing còn thiếu |
| BF-03/04 / UC-17–19 / GBR-03/06 | Có chỉ số ban đầu làm một đầu vào; các màn Owner demo | Bàn giao hai bên, checklist tài sản/khóa, cư trú theo từng occupant, gia hạn/termination, quyết toán và trả phòng |
| BF-05 / UC-20 / GBR-07/09 | Mobile camera → OCR → sửa/nhập tay → Staff xác nhận → EF và evidence private; initial/periodic, baseline, monotonicity, retry cùng kết quả, transaction/audit | Tenant xem chỉ số; liên kết hợp đồng/occupied room đầy đủ; thay/reset đồng hồ là nhánh bị từ chối chờ xử lý, chưa có workflow riêng |
| BF-05 / UC-21 / DBR-06/07 | Màn hóa đơn demo | Backend Draft/Final, charge breakdown, giá theo thời điểm, due date, immutable invoice/adjustment và JOB-10 |
| BF-06 / UC-22–25 / GBR-10/18 | Interfaces, adapter chưa cấu hình; màn payment/debt demo | Đối soát ngân hàng, allocation, trả thiếu/thừa, manual review, công nợ, điều chỉnh, hoàn tiền và lịch sử thật |
| BF-07 / UC-26–30 / GBR-11/12 | Màn sự cố/Work Order demo | Backend report/emergency, thông báo, proposal/approval, thực hiện/nghiệm thu, tài sản và chi phí liên kết |
| UC-31–34 / GBR-15/16 | Dashboard, expense/report/What-if phía demo | Investment/OPEX/report/query/công thức trên dữ liệu thật; kiểm chứng What-if không làm đổi dữ liệu server |
| UC-35–36 / GBR-14 | Màn notifications demo, provider interface, durable queue | In-app notification nghiệp vụ, recipient scope, đọc/chưa đọc, push/email và retry delivery |
| UC-37–38 / GBR-17 | Owner public-content demo; Public Web trang chào | Xuất bản và truy vấn dữ liệu được duyệt; danh sách/chi tiết cơ sở/phòng công khai. Nút `/locations` hiện không có route tương ứng |
| JOB-01–10 / GBR-18 | PostgreSQL queue/worker, idempotency key, lease/retry; riêng cleanup evidence có hosted service | Chưa thấy business handler/scheduler triển khai 10 job SRS; cleanup evidence không thay thế JOB-09/10 |

## Bằng chứng mã nguồn tiêu biểu

- Auth: `src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs`, `Infrastructure/IdentityAccess`, `Domain/IdentityAccess`, `src/mobile/src/lib/SessionProvider.tsx`.
- Phân công: `src/backend/BHome.Api/Controllers/LocationsController.cs`, `Infrastructure/Locations/PostgresLocationAssignments.cs`; quyết định 29/10 trong `STAFF_LOCATION_ASSIGNMENTS.md` cho Owner quản lý toàn hệ thống, một Location tối đa một Staff tại một ngày, một Staff có thể nhiều Location.
- Capture: `src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs`, `Application/Ocr/CaptureService.cs`, `Infrastructure/Ocr/CaptureRepository.cs`, `CaptureScope.cs`, `Persistence/CaptureConfiguration.cs`.
- Engine thật được DI đăng ký: `IOcrService → LocalOcrService`, `IOcrEngine → OnnxOcrEngine`; không còn chỉ là OCR interface chưa triển khai.
- Model chính có Identity/auth, jobs, Chain/Location/Room, StaffLocationAssignment, Resident, Meter/OperationalTask/MeterEvidence/MeterReading. Có 5 migration chính; không suy ra schema PostgreSQL đang chạy đã áp dụng chúng.
- `CaptureRepository.ConfirmMeterAsync` khóa Meter/Task, kiểm lại quyền, kiểm baseline/evidence/thứ tự kỳ, ghi reading/task/audit trong transaction. Test tình huống cạnh tranh, ảnh private, retry và lỗi storage nằm trong `tests/backend/BHome.IntegrationTests/Ocr/CaptureWorkflowTests.cs` nhưng chưa chạy lại trong lượt rà soát này.

## Owner Web và ký số cần được ghi nhận đúng mức

Owner Web đã có công sức triển khai đáng kể: layout, routing, bảng/form, tìm/lọc, CRUD demo, chuyển trạng thái và báo cáo/What-if. Tuy nhiên `src/owner-web/src/app/PortalProvider.tsx` dùng `createMockRepository`; dữ liệu lưu localStorage. `services/config.ts` mặc định mock nếu `VITE_API_MODE` không phải `api`. Khi chọn API, repository nghiệp vụ ném lỗi “Chưa có hợp đồng API nghiệp vụ”. Login có nhánh gọi auth thật riêng. Vì vậy test Owner Web đạt không chứng minh hợp đồng/hóa đơn/thanh toán backend hoạt động.

`src/digital-signing` có solution riêng, adapter Viettel, xử lý ký PDF, API, persistence, sandbox và test. README ghi rõ chưa tích hợp vào BHOME, chưa thử Viettel thật. Backend chính vẫn đăng ký `UnconfiguredElectronicContractProvider`. Đây là nền tích hợp đã làm, chưa phải UC-14–16 hoàn chỉnh. Module độc lập cho Staff ký tài liệu của mình; trước khi nối vào hợp đồng cần giới hạn người ký đúng Owner/Tenant theo SRS. Fake certificate/key chỉ được xem là phương tiện sandbox, không phải cơ chế ký hợp đồng production.

## Sai lệch tài liệu và điểm cần quyết định

- `SPRINT_2_AUDIT.md` là ảnh chụp cũ: nhận xét thiếu SRS, thiếu Location/Resident/Meter không còn đúng với checkout này.
- `ARCHITECTURE.md` vẫn có đoạn OCR chưa cấu hình, mobile memory-only/Capacitor và chỉ migration nền; code hiện dùng ONNX, Expo/React Native, SecureStore và migration capture. README cũng có một số mô tả cũ về provisioning/schema.
- Report 1 và SRS không thống nhất mã FE. Nên chuẩn hóa traceability trước khi chấm tỷ lệ hoàn thành theo FE.
- UC-18/JOB-08 vẫn cần đối chiếu phần Staff hỗ trợ với GBR-06; UC-37 contact form với GBR-17. Không triển khai nhánh mâu thuẫn chỉ từ một đoạn detailed flow.
- OQ-01–08 trong SRS vẫn mở: khấu trừ/quyết toán cọc, phê duyệt adjustment, hạn giữ chỗ/thanh toán, response-time sự cố, cách thu phí hư hỏng, đầu vào chi phí Staff, retention identity, email và người nhận thông báo của co-occupant.
- Cần rà soát tiếp logic dedup identity: `CreateResidentAsync` gán `OwnerUserId = Actor` dù Owner/Staff đều được tạo, còn HMAC/index dựa trên OwnerUserId. Đây là điểm cần làm rõ phạm vi chống trùng theo mô hình Owner global, chưa phải lỗi đã tái hiện bằng test trong lượt này.
- Chưa đánh giá đầy đủ mọi quyền/IDOR, business transaction và audit. Một catalog permission có đủ tên chức năng không chứng minh các chức năng đó đã triển khai.

## Kiểm chứng thực hiện lần này

| Lệnh | Kết quả |
| --- | --- |
| `git status --short`, `git branch --show-current`, `git rev-parse --short HEAD` | Ban đầu sạch; `develop`, `6f57628` |
| `npm.cmd test` | Lần trong sandbox lỗi `spawn EPERM`; chạy lại ngoài sandbox PASS: Owner Web 46, mobile 43; tổng 89 test. Lệnh chỉ chạy workspace có script test, không chứng minh test mọi client/package |
| `npm.cmd run typecheck --workspace ./src/mobile` | PASS |
| `npm.cmd run lint --workspace ./src/mobile` | Không chạy được ESLint: executable không có trong môi trường dependency hiện tại |
| `dotnet test src/backend/BHome.sln --no-restore --filter 'Category!=Docker' --verbosity minimal -m:1 -nr:false` | Không chạy được test: NETSDK1004, thiếu `obj/project.assets.json` của các project test |
| `dotnet test src/digital-signing/BHome.DigitalSigning.sln --no-restore --verbosity minimal -m:1 -nr:false` | Không chạy được test: NETSDK1004 tương tự |

Hai lần gọi .NET đầu trong sandbox không trả kết quả; đã gửi Ctrl+C, sau đó thử với một MSBuild worker ngoài sandbox để nhận lỗi cụ thể nêu trên. Không lấy số test PASS trong tài liệu lịch sử làm kết quả hôm nay.

NOT RUN: full build, full lint/format, PostgreSQL/MinIO integration, applied migration inspection, OCR inference/accuracy benchmark, camera thiết bị thật, Viettel/bank/push/email thật, security/performance/UAT toàn hệ thống. Không cài lại dependency hoặc sửa mã để thay đổi kết quả kiểm tra.

## Việc nên ưu tiên theo phụ thuộc nghiệp vụ

1. Chuẩn hóa tài liệu hiện trạng/mapping, chốt OQ của nhánh sắp làm; khôi phục môi trường build/test có thể lặp lại.
2. Hoàn thiện Location/Room Type/Room/giá có hiệu lực và quản trị Staff; nối từng màn Owner với API thật hiện có hoặc được triển khai.
3. Hoàn thiện Resident/ContractResident và chuỗi Holding/Main Contract → ký provider → xác minh cọc → Owner kích hoạt → bàn giao. Giữ sandbox ký số tách khỏi chứng cứ production.
4. Dựa trên meter capture đã có để làm Tenant xem reading, Draft/Final Invoice, payment allocation/debt/adjustment và JOB-09/10.
5. Tiếp tục lịch ca/tác vụ tổng quát, incident/Work Order, notifications; xây finance/publication trên dữ liệu và quyền server đã hoàn chỉnh.

So với Report 2: nền Sprint 1 đã có nhưng rental baseline chưa đủ; Sprint 2 có meter capture, chưa đủ billing/payment; phần lớn backend Sprint 3 chưa có. Không đưa phần trăm hoàn thành chung vì số màn hình/demo không tương đương số use case đã nghiệm thu.
