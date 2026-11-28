# Bỏ chặn phê duyệt mẫu hợp đồng thuê

## Nguồn và phạm vi

Quyết định trực tiếp của chủ dự án ngày 27/11/2026: dùng giao dịch Live và
“không cần hợp đồng Live chỉ được gửi ký khi đúng mẫu đã được phê duyệt”.
Quyết định này thay điều kiện duyệt mẫu trong luồng BF-03B / UC-15, GBR-04;
không yêu cầu bổ sung mẫu mới hoặc chuyển hợp đồng Live sang Test.

Hai correlation ID staging `278ebf42-d1b8-47c0-bdad-6e7d98d9adb1` và
`a25652ab-90f7-4d0a-a345-a240422cda94` trả 503 với mã
`main_draft_signing_template_not_approved`. Bản nháp dùng Live theo lựa chọn
Owner, ngoài phạm vi HoldingTesting; server chưa cấu hình hash mẫu được duyệt.
Mobile Staff gọi signing-review để lấy PDF ngay ở màn xem trước nên bị chặn tại đây.

## Thay đổi

- MainDraftRenderer cho phép dùng mẫu hiện có mà không xét môi trường,
  phạm vi sandbox, cờ AllowStagingSigningReview hay ApprovedProductionTemplateSha256.
- MainDraftService bỏ điều kiện phê duyệt khi tạo tài liệu xem trước/chuyển sang ký;
  nhãn DevelopmentOnly cũ không làm mất hiệu lực tài liệu đã xem.
- ContractSigningDocumentSource bỏ điều kiện phê duyệt khi tạo/đọc tài liệu ký.
- Tài liệu mới của hợp đồng Live không mô phỏng được phân loại Live.
- Tái sử dụng endpoint, DTO, lưu trữ riêng tư và template hiện có; không migration.

Quyền Owner/Staff theo cơ sở, trạng thái Draft, xác nhận đã xem, snapshot/phiên bản,
hash file và idempotency vẫn được thực thi tại backend. Quyết định này chỉ bỏ chặn
phê duyệt mẫu, không thay các điều kiện tiền/kích hoạt hay quyền ký của các bên.

## Tiêu chí chấp nhận và kiểm thử

- Live trên Staging/Production xem được PDF, chuyển PendingSigning, đọc đúng PDF
  để ký khi không có hash phê duyệt và khi cờ staging tắt/ngoài phạm vi sandbox.
- Test vẫn dùng được mẫu; nhãn DevelopmentOnly phản ánh chế độ hợp đồng.
- Tài liệu cũ có nhãn DevelopmentOnly vẫn dùng được nếu snapshot/hash/phiên bản hợp lệ.
- Tài liệu phiên bản cũ bị từ chối; Staff ngoài cơ sở không đọc/tạo tài liệu;
  gửi lại cùng idempotency key không tạo bản Preview trùng.

Coverage: SePayHoldingPreviewGuardTests, MainDraftDocumentRegressionTests,
MainDraftApiTests.DemoTemplateCanBeReviewedReleasedAndReadInEveryEnvironment.

## Kết quả thực thi

- `dotnet build src/backend/BHome.sln --configuration Release --no-restore --verbosity quiet`:
  PASS, 0 warnings / 0 errors.
- `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --configuration Release --no-restore`
  với filter SePayHoldingPreviewGuardTests, MainDraftPreviewTests,
  MainDraftDocumentRegressionTests, Contracts.MainDraftApiTests, MainDocxTemplateTests:
  PASS 69/69, 0 skipped; có PostgreSQL/MinIO dùng riêng cho test và LibreOffice thật.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore --include ...`:
  PASS cho các file C# thay đổi.
- Prettier check ba tài liệu thay đổi và `git diff --check`: PASS.

Lượt test mở rộng đầu có 1 lỗi fixture vì thử sửa nhãn trên bằng chứng append-only;
đã sửa fixture bằng cách sinh thêm tài liệu qua renderer cũ và chạy lại toàn bộ 69 ca.
Một lệnh build chạy đồng thời test bị khóa DLL trên Windows; chạy build tuần tự
sau đó thành công như trên. Không thay constraint database để làm test qua.

## Triển khai Staging theo yêu cầu trực tiếp

Đã triển khai ngày 27/11/2026, trước khi merge develop:

- Image: `bhome/staging-contract-template:20261127-ab10fd612d8e`.
- Image ID: `sha256:f838ff86c60d94250c67ea195c981ee3ab5e85a00de6ade746db1eafe2231489`.
- Nền chính xác là image Staging của commit `219288c65d5e33c554d9fa513b658287bebdd5a8`,
  cộng đúng ba file backend trong bản sửa. Build Linux; image chỉ thay
  `BHome.Application.dll` / `BHome.Infrastructure.dll`, không đưa thay đổi OCR
  khác của nhánh cá nhân vào hotfix.
- Probe bằng chính image mới: Live không cần hash phê duyệt, tạo PDF LibreOffice
  thành công (56.828 byte). Checksum hai assembly trong API đang chạy khớp payload.
- Health live/ready nội bộ với Host Staging: HTTP 200. HTTPS Owner/Public/API,
  đăng nhập/refresh/logout tài khoản tổng hợp, cách ly CORS/auth và từ chối webhook
  không xác thực: PASS theo `smoke-staging.sh`.
- Biến môi trường, mount API và các container Production, PostgreSQL/MinIO,
  Owner/Public Staging được đối chiếu trước/sau: không thay đổi. Không migration.
- Backup database và cấu hình hoàn tác riêng tư:
  `/opt/bhome-backups/staging-contract-template-20261127T055542Z` trên VPS;
  dump được kiểm tra bằng `pg_restore --list`.

Script kiểm tra release cũ đòi BillingAutomation__AutomaticJobsEnabled=false,
khác cấu hình đang chạy. Hotfix giữ nguyên cấu hình thực tế và kiểm tra toàn bộ
biến môi trường/mount cùng ID/image của container được bảo vệ trước/sau.
Probe sức khỏe ban đầu dùng IP nội bộ bị Host filtering từ chối (400); đã xác nhận
hoàn tác và triển khai lại với Host canonical. Lượt cuối PASS như trên.

Không gửi email ký hoặc tạo giao dịch Live trong kiểm thử.
Người dùng mở lại bản nháp trên điện thoại và thử lại bản xem trước; chưa kiểm tra
thao tác trực tiếp trên iPhone/Android sau triển khai. Lần CD tiếp theo từ develop
sẽ thay hotfix bằng image release thông thường chứa bản sửa đã merge.

## Chuẩn bị commit và CI/CD

Theo yêu cầu kiểm tra trước khi push ngày 27/11/2026:

- Danh mục test CI cần thay đúng 16 định danh cũ của bốn nhóm test bị đổi theo
  quyết định bỏ duyệt mẫu, bằng 23 trường hợp mới đã thực thi. Các định danh còn
  lại được giữ nguyên; không tắt bước kiểm tra inventory/discovery.
- `Verify-StagingRegressions.py` yêu cầu ba trường hợp Test Staging / Live Staging /
  Live Production của MainDraftDocumentRegressionTests, thay cho hai trường hợp cũ.
- Build Release toàn solution: 0 warnings / 0 errors. Kiểm tra format toàn solution,
  ESLint mã nguồn và Prettier toàn repo: PASS. ESLint bỏ qua `.artifacts/**` là
  artifact local đã bị Git ignore, không tồn tại trong checkout CI.
- Typecheck Mobile, build client-core, Owner/Public Web và export Mobile web: PASS.
- Test frontend: Owner Web 1.078, Mobile 1.827, Public Web 11; browser Public Web 16:
  tất cả PASS.
- Bộ backend CI đầy đủ theo `BHome.CI.slnf` và `tests/backend/ci.runsettings`:
  Application 777, Domain 115, Infrastructure 252, DigitalSigning 41,
  Integration 1.579 PASS; 32 trường hợp Integration opt-in được bỏ qua đúng
  allowlist hiện có. Tổng 2.764 PASS, 32 skipped, 0 failed.
- `Verify-BackendTrx.py` đối chiếu cả năm assembly với inventory đã cập nhật và
  discovery từ source hiện tại: PASS. `Verify-StagingRegressions.py`: cả 21 nhóm
  bắt buộc PASS. Chỉ thay 16 hàng inventory đã được đối chiếu với TRX baseline
  trước đó bằng 23 hàng mới PASS; các định danh khác được giữ nguyên.
- Cả ba image API/Owner/Public build bằng Dockerfile release với cấu hình Staging:
  PASS. Probe trên image API chứa source hiện tại tạo PDF Live thành công.
- Test deployment Python 102, Node 26, email preflight 7; cú pháp Bash,
  Test-SePaySandboxScripts.ps1 và hai cấu hình Compose mẫu: PASS.

Guard CD trên VPS đã được đồng bộ với source `deploy/vps/release-safety.py` trong
repo, SHA-256 `c4f0cd07d91791ab754a9d17e44b55efb7921dd25dabf13b783aa78eccfd4700`.
Bản guard cũ từ chối cấu hình billing đang chạy và chưa hỗ trợ kiểm tra SePay
Test/Live mới. Guard mới đã qua `check staging` và đối chiếu `unchanged staging`;
backup tại `/opt/bhome-deploy/staging/guard-sync-20261127T060421Z` trên VPS.
Không thay biến môi trường hay khởi động lại ứng dụng trong bước đồng bộ guard.

Lượt CI local trước bị ngắt khi môi trường chạy khởi động lại, chưa đủ TRX và
không được tính là PASS. Bộ kiểm tra được chạy lại với PostgreSQL disposable
riêng và log statement đã tắt bind parameters. GitHub Actions/CD từ commit mới
chỉ được xác nhận sau khi người dùng push/merge; các kiểm tra local không thay
thế kết quả đó.

## File thay đổi

- `src/backend/BHome.Application/Contracts/MainDraftService.cs`
- `src/backend/BHome.Infrastructure/Contracts/MainDraftRenderer.cs`
- `src/backend/BHome.Infrastructure/Contracts/ContractSigningDocumentSource.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/SePayHoldingPreviewGuardTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/MainDraftDocumentRegressionTests.cs`
- `tests/backend/BHome.IntegrationTests/Contracts/MainDraftReleaseTests.cs`
- `tests/backend/BHome.IntegrationTests/Contracts/MainDocxTemplateTests.cs`
- `tests/backend/ci-test-inventory.json`
- `scripts/Verify-StagingRegressions.py`
- `docs/development/BHOME_STAGING_DEPLOYMENT.md`
- `docs/development/BHOME_PRODUCTION_RELEASE_RUNBOOK.md`
- Tài liệu này.
