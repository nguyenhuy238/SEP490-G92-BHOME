# Mở mẫu hợp đồng cho demo — 24/11/2026

> Cập nhật theo yêu cầu tiếp theo cùng ngày: đã bỏ cảnh báo Development/mẫu chưa duyệt trên Owner Web, Mobile và tài liệu mới. Nội dung nhãn thử nghiệm bên dưới ghi lại quyết định trước đó và được thay thế ở phần cập nhật cuối tài liệu.

## Quyết định và truy vết

Người dùng yêu cầu bỏ chặn mẫu hợp đồng trên tất cả môi trường để demo hệ thống, bao gồm Staging hiện tại. Quyết định này thay giới hạn môi trường trước đây của template; không phải phê duyệt nội dung mẫu cho sử dụng thật.

Phạm vi: BF-03/BF-04, UC-15, GBR-04, DBR-03; đối chiếu `AGENTS.md`, `docs/api/CONTRACT_LIFECYCLE.md` và triển khai Main Draft hiện hữu. Không thay nhà cung cấp ký, quy tắc thanh toán hoặc quyền kích hoạt.

## Thay đổi

- `MainDraftRenderer`: cho tạo SigningReview ở mọi môi trường. DOCX/PDF SigningReview mới luôn ghi “TÀI LIỆU KIỂM THỬ – MẪU CHƯA ĐƯỢC DUYỆT CHO PRODUCTION”; bản nháp giữ nhãn bản nháp.
- `ContractSigningDocumentSource`: cho đọc canonical PDF và tạo nguồn DOCX cho hợp đồng chuyển đổi chưa ký ở mọi môi trường. Giữ nguyên snapshot/hash, khóa chống tạo trùng, quyền và điều kiện không thay nguồn đã ký/đã gửi lời mời.
- `ContractPdfRenderer`: cho render/validate mẫu thử có cấu hình hợp lệ ở mọi môi trường. Mẫu vẫn có notice và metadata thử nghiệm; thiếu/sai template vẫn báo lỗi.
- Không sửa PDF đã tồn tại, migration, dữ liệu thanh toán hay cờ mô phỏng ký. Quyền theo vai trò/Location, PDF bất biến, xác nhận xem xét, trạng thái PendingSigning và điều kiện Owner kích hoạt giữ nguyên.

## Tiêu chí kiểm chứng

- Development/Testing/Staging/Production và host không khai báo môi trường đều render mẫu thử được, có notice; metadata không đổi thành mẫu đã duyệt.
- Staging/Production tạo SigningReview, release idempotent và đọc đúng canonical bytes; người ngoài Location bị từ chối.
- PDF bị sửa hoặc review cũ vẫn bị từ chối. Release không tự ký, thanh toán hoặc kích hoạt hợp đồng.
- Adapter ký có thể tiếp tục tài liệu demo qua môi trường Production; chưa hoàn tất ký/điều kiện tài chính vẫn không kích hoạt.

## Kết quả đã thực hiện

- `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter "FullyQualifiedName~ContractPdfRendererTests|FullyQualifiedName~ContractPdfSigningCompositionTests|FullyQualifiedName~MainDocxTemplateTests|FullyQualifiedName~MainDraftDocumentRegressionTests|FullyQualifiedName~ActualAdapterCanContinueADemoPdfInProductionWithoutActivatingTheContract"`: **50/50 PASS**, không skip. Bao gồm PostgreSQL dùng một lần trong Docker, chuyển đổi LibreOffice thật, review/release/read ở Staging và Production; nhà cung cấp ký và storage là test substitute, không gửi yêu cầu ký thật.
- `dotnet test tests/backend/BHome.IntegrationTests --no-build --no-restore --filter "FullyQualifiedName~ReleaseRejectsStaleReviewAndTampering|FullyQualifiedName~ReviewedMainDraftReleasesOnceAndBothPartiesUseTheSamePdfThroughSimulatedActivation"`: **2/2 PASS**, không skip. Kiểm tra PDF bị sửa, review cũ, idempotency và activation trong workflow mô phỏng.
- `dotnet build src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj -c Release --no-restore`: **PASS**, 0 warnings/errors.
- `dotnet format whitespace` với `--verify-no-changes --no-restore --include` cho các file C# thay đổi trong Infrastructure và IntegrationTests: **PASS**. `npx.cmd --no-install prettier --check` cho hai tài liệu thay đổi: **PASS**. `git diff --check`: **PASS**.
- Evidence cục bộ: `.tools/contract-demo-all-environments/contract-demo-environments.trx` và `contract-demo-guards.trx`.

Lỗi trong lúc chuẩn bị đã được xử lý: test ban đầu gọi helper `internal` không khả dụng từ IntegrationTests, đã thay bằng DTO public với snapshot đã lưu. Publish Linux `--no-restore` thiếu RID assets; thay bằng assembly .NET portable build Release đúng source revision Staging. Lệnh `npx` bị PowerShell execution policy chặn; `npx.cmd` kiểm tra thành công.

## Staging thực tế

Đã cập nhật riêng API Staging từ revision nền `0909e9030e2a630d0ef00b4ea70867ab428e5a2c`, bằng image `bhome/contract-demo-all-environments:20261124` kế thừa đúng image đang chạy và thay assembly Infrastructure đã build. SHA-256 artifact được đối chiếu trước build. Giữ bản release manifest/image trước để rollback; không đổi schema, cấu hình môi trường hoặc database/storage containers.

HTTPS smoke, đăng nhập/refresh/logout tổng hợp, kiểm tra auth/CORS và từ chối webhook không xác thực: **PASS**. API `signing-review` trả **200**, download PDF trả **200**, PDF header hợp lệ, 73.522 bytes và `developmentOnly=true`. Chỉ tạo tài liệu review; không release, ký hoặc kích hoạt hợp đồng trên server để kiểm chứng. Snapshot bảo vệ xác nhận Production và database/storage/edge containers không đổi.

Một bản nháp khác trả **409 `draft_configuration_changed_save_again`** vì cấu hình lưu trước đã cũ. Lượt triển khai kiểm chứng đầu tự rollback khi gặp bản nháp này; sau khi phân biệt lỗi nghiệp vụ và kiểm tra bản nháp hiện hành, triển khai lại thành công. Bản nháp cũ cần người dùng lưu lại rõ ràng trước khi tạo review; không tự sửa giá/điều khoản để vượt kiểm tra.

Evidence VPS: `/opt/bhome-deploy/operator-contract-demo-20261124/` chứa artifact checksums, build log, manifest trước triển khai, protected snapshot, live probe và `deployed.json`. Không lưu credentials/token/PDF có thông tin cá nhân trong báo cáo.

Mã nguồn áp dụng cho mọi môi trường; runtime chỉ cập nhật Staging trong lượt này. Production đang chạy chưa được triển khai lại. Không commit/push/merge. CI/CD tiếp theo cần chứa thay đổi nguồn này để giữ việc mở chặn.

Renderer JSON dự phòng trên Staging vẫn thiếu `ContractPdf:TemplateId` (`contract_template_not_configured` trong configuration). Đây là cấu hình sẵn có; luồng Main DOCX/canonical PDF hiện tại đã tạo/tải thành công và không dùng renderer dự phòng đó. Chưa kiểm chứng ký/provider production hoặc UI native end-to-end.

## Cập nhật: bỏ cảnh báo môi trường theo yêu cầu người dùng

Người dùng xác nhận đã biết môi trường phát triển và yêu cầu bỏ các cảnh báo liên quan, đồng thời cập nhật Staging.

- Gỡ banner/nhãn Development, template notice và thông báo mẫu chưa được duyệt trên luồng review/tài liệu/hợp đồng/ký của Owner Web và Mobile. Giữ trạng thái “Ký mô phỏng” để phương thức vẫn đúng với dữ liệu backend; không đổi trạng thái thành ký thật.
- Tài liệu Main SigningReview mới không chèn cảnh báo môi trường. Bản nháp vẫn có nhãn “BẢN NHÁP”. Renderer dự phòng không in notice; simulation adapter giữ metadata nhưng bỏ watermark cảnh báo.
- `IMainDraftRenderer.DocumentVersion` mặc định 1, renderer Main hiện tại dùng 2. Generate/review chỉ tái sử dụng tài liệu unsigned cùng revision, tạo record/file mới cho revision cũ và giữ nguyên lịch sử. Release từ chối review khác rendering revision. Canonical PDF đã phát hành, lời mời đang dùng hoặc tài liệu đã ký không bị thay byte.
- Metadata `developmentOnly`, chế độ Test/Live, quyền, human review, hash/snapshot, chống trùng và điều kiện tài chính giữ nguyên.

Kiểm thử: backend **59/59 PASS**, Owner Web **14/14 PASS**, Mobile **33/33 PASS**; build API Release và Owner Web Staging PASS; Mobile typecheck/lint và ESLint các file Web/shared thay đổi PASS. Detector Impeccable chạy một lượt cho các surface chính: `[]`. Owner build còn advisory chunk lớn có sẵn; jsdom báo chưa hỗ trợ canvas trong Owner signing tests nhưng tests vẫn PASS. Lỗi import Pill/ui trong lượt sửa đã được sửa và kiểm lại.

Đã cập nhật API và Owner Web Staging bằng hai image `bhome/contract-no-warnings-api:20261124` và `bhome/contract-no-warnings-owner:20261124`; HTTPS/auth/CORS/webhook smoke PASS và protected snapshot không đổi. Tại probe sau triển khai chỉ còn một Draft cũ báo `draft_configuration_changed_save_again`; contract hiện hành đã chuyển sang ký nên không dựng lại PDF đó. Không tuyên bố đã thay cảnh báo bên trong tài liệu đã ký. Evidence VPS: `/opt/bhome-deploy/operator-contract-no-warnings-20261124/`.

Mobile đã sửa nguồn và kiểm thử; không phát hành native binary/EAS update trong lượt này. Không commit/push/merge.

Visual QA bổ sung: render component review thực tế với API/identity tổng hợp ở Chromium/Edge, viewport 1440 và 390 px; không còn cảnh báo môi trường, không tràn ngang, checkbox xác nhận vẫn bắt buộc, không lỗi JavaScript. Hai ảnh đã xem tại `.tools/contract-no-warnings-20261124/review-no-warnings-*.png`; khung PDF trong harness dùng bytes giả để kiểm tra UI, không phải kiểm chứng nội dung tài liệu thật.
