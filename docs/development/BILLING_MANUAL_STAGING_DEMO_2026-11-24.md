# Mở chạy thử lập hóa đơn trên Staging — 24/11/2026

## Yêu cầu và nguyên nhân

Người dùng yêu cầu bỏ chặn chạy thử trên màn `/billing-automation` và cập nhật Staging để demo. Truy vết: BF-05 / UC-20/21 / JOB-09/10, GBR-01/02/07/09/18; tham chiếu `AGENTS.md`, `docs/api/BILLING_AUTOMATION.md`, controller/service/DI và test hiện có.

Backend trước đó chỉ bật `BillingAutomationRuntime.DeveloperActionsEnabled` trong Development/Testing; Staging luôn trả `developerActionsEnabled=false` trong preview. Client hiển thị cảnh báo và khóa các nút đúng theo capability này. Đây là chặn môi trường, không phải thiếu quyền Owner hay lỗi dữ liệu công tơ.

## Thay đổi

- Thêm opt-in `BillingAutomation:ManualActionsEnabled`, mặc định false, chỉ có hiệu lực trong Staging. Cấu hình mẫu `.env.staging.example` ghi rõ cờ và giữ worker tắt.
- `BillingAutomationRuntime.CanRunManualActions` dùng cho preview/run-now/manual-meter-tasks. Preview giữ nguyên DTO/field `developerActionsEnabled`, để client hiện có tự mở khóa khi tải lại.
- Cờ manual không thay `DeveloperActionsEnabled` gốc, nên không mở thao tác thử xử lý thông báo. Không bật `Jobs:Enabled` hoặc `BillingAutomation:AutomaticJobsEnabled`.
- Giữ quyền Owner, Location, lịch hiệu lực/ngày nghiệp vụ, nhiệm vụ/chỉ số đã xác nhận, chống trùng, hợp đồng đại diện, version và quyền phát hành Final. Không tạo/chốt hóa đơn hoặc giao nhiệm vụ khi bật cờ.

## Kiểm thử

- `dotnet test tests/backend/BHome.Infrastructure.UnitTests --no-restore --filter FullyQualifiedName~BillingAutomationRuntimeTests`: **9 PASS**, không skip; gồm Development/Testing, Staging bật/tắt, Production/custom, và worker độc lập với manual.
- PostgreSQL 16 dùng một lần, `Test-Compact24Isolated.ps1 -Filter FullyQualifiedName~Compact24BillingManualActionsTests` trên nguồn Release đúng Staging: **2 PASS**, không skip. Kiểm tra capability preview, tạo Initial/Periodic khi plan chỉ lưu lịch, ngày chưa tới, ngày nhập không hợp lệ, duplicate và từ chối Staff/Tenant. Lượt đầu trên working tree chạy bản test có route preview sai, 2 FAIL 404; đã sửa sang endpoint có sẵn `/billing-automation/preview` trước khi chạy lại nguồn Staging.
- Chạy lại cuối trên working tree: **2 PASS**, không skip, evidence `working-tree-final/`.
- Owner Web `Automation.test.tsx`: **24 PASS**. Không sửa/build lại frontend vì capability hiện có đủ để bỏ banner và mở nút.
- API Linux Release build: PASS. C# whitespace format verify, `git diff --check` và Prettier tài liệu API: PASS.
- Probe ban đầu dùng chuỗi enum thay vì enum số theo contract hiện có, bị `400 validation_error` trước service. Đã sửa payload probe; các lần này dừng trước recreate/cập nhật cấu hình Staging, không phát sinh nghiệp vụ.

Evidence local: `.tools/billing-manual-staging/` chứa TRX/log, artifact checksum, source patch và provenance. Không chạy CI đầy đủ; các kết quả trên không thay thế CI.

## Triển khai và vận hành

Nguồn dựng tiếp tục PR163 `c4860aa44caca6795b55bb4022375dc45d8fd1f5` cùng các hotfix đã có, bao gồm sửa Tenant ký bàn giao. Image API mới kế thừa `bhome/handover-tenant403-api:20261124`, thay Application/Infrastructure assembly và PDB; không đưa toàn bộ working tree vào Staging.

Worker `/opt/bhome-deploy/operator-billing-manual-20261124/` có khóa release, backup database/release config, kiểm checksum, snapshot container bảo vệ, readiness/smoke và rollback API/config nếu lỗi. Cờ `BillingAutomation__ManualActionsEnabled=true` được lưu riêng trong service API của release override Staging. Production không triển khai hoặc đổi cấu hình; không migration/seed/commit/push/merge.

Probe đọc preview và gửi request có meter UUID tổng hợp không tồn tại để kiểm tra service gate, không thể tạo nhiệm vụ. Owner trước mở phải nhận `403 developer_actions_disabled`, sau mở nhận `404 meter_not_found`; Staff/Tenant vẫn 403. Worker preview phải false. Probe không tạo/chốt hóa đơn hoặc ký thay người dùng.

Kết quả thực tế: triển khai **PASS**, worker exit 0, image `bhome/billing-manual-api:20261124`. API preview trả 200 với `developerActionsEnabled=true`, `workerEnabled=false`; request kiểm tra Owner trả 404 như mong đợi, Staff/Tenant 403. HTTPS/auth/CORS/webhook smoke và probe chỉ đọc biên bản/PDF/thanh toán PASS. Đối chiếu SHA-256 cả hai assembly đang chạy khớp artifact.

Lượt triển khai đầu đã rollback thành công do bộ kiểm tra chuẩn so fingerprint toàn bộ environment và phát hiện cờ manual mới. Lượt sau dùng kiểm tra delta riêng: cho phép chính xác `BillingAutomation__ManualActionsEnabled` chuyển sang true, so hash **toàn bộ environment còn lại** và toàn bộ container được bảo vệ với snapshot trước; đồng thời vẫn gọi `release-safety.check_environment` để kiểm các anchors/job/DB/storage. Không sửa/nới bộ kiểm tra release chuẩn. Backup DB có kiểm danh mục `pg_restore`; chưa diễn tập restore database. Evidence kết quả: `deployed.json`, `billing.before.json`, `billing.after.json` local; logs/backup private ở thư mục worker VPS.

Để demo: tải lại `/billing-automation` bằng Ctrl+F5 rồi chọn phòng/công tơ và thực hiện từng bước. Nhiệm vụ đã tồn tại hoặc dữ liệu chưa đủ vẫn hiển thị lý do nghiệp vụ; không cần tạo trùng nhiệm vụ khởi tạo. Cờ demo nằm trong release override thủ công; lần CD chuẩn tiếp theo cần chủ động giữ cờ nếu vẫn muốn mở chạy thử.

Các file repository sửa: `.env.staging.example`, `docs/api/BILLING_AUTOMATION.md`, `src/backend/BHome.Application/Billing/BillingAutomationJobs.cs`, `src/backend/BHome.Infrastructure/DependencyInjection.cs`, `tests/backend/BHome.Infrastructure.UnitTests/BillingAutomationRuntimeTests.cs`, `tests/backend/BHome.IntegrationTests/PaymentsDebt/BillingManualActionsTests.cs`, `tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentApiTests.cs`, `tests/backend/BHome.IntegrationTests/Compact24/Compact24BillingManualActionsTests.cs`, báo cáo này.
