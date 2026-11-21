# OCR nội bộ — phạm vi và truy vết

> Đây là báo cáo pha nền OCR ban đầu. Phần phát triển tiếp đã bổ sung schema, repository,
> xác nhận và mobile thực tế; xem [OCR_MOBILE_DELIVERY.md](OCR_MOBILE_DELIVERY.md) để chạy
> phiên bản hiện tại. Những mục “chưa có module/chưa tích hợp” bên dưới mô tả thời điểm pha nền.

## Khảo sát trước triển khai (28/10/2026)

Nguồn đã đọc: `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
(có revision 21/10/2026), `Report-4_Software Design Specification (5).docx`,
`docs/api/API_CONVENTIONS.md`, DbContext, toàn bộ migrations và các test hiện có.
Tên/version tệp khác danh mục AGENTS.md; không mặc định chúng giống bản v1.3 được nêu.

| Yêu cầu                                | Nguồn                                     | Thành phần / kiểm chứng                                                 |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Đề xuất CCCD, nhập tay, xác nhận riêng | BF-03, UC-13, GBR-07/13; Report 4 privacy | Parser, IOcrService; không tự ghi Resident                              |
| OCR chỉ số, không tự dùng để tính tiền | BF-05, UC-17/20/21, GBR-07/09, JOB-09/10  | Parser số; không ghi reading/invoice                                    |
| Phân quyền tài nguyên trước xử lý      | GBR-02, NFR privacy                       | ResourceAccess + tài nguyên tra cứu từ server; test chéo Location       |
| Ảnh CCCD tạm thời                      | SRS data protection, Report 4 CCCD OCR    | Stream RAM giới hạn; không DbContext/MinIO/temp-file trong pipeline     |
| AES-256-GCM, HMAC riêng                | Yêu cầu trực tiếp trong master prompt     | Envelope có version, nonce/tag, AAD theo phạm vi; test giả mạo/đổi khóa |
| CPU Linux, fallback <=10s cần đo       | SRS Internal OCR Processing               | ONNX/OpenCV, giới hạn concurrency/deadline; smoke Docker                |

Hiện có Controller -> Application -> Infrastructure, Identity/JWT/session, ResourceAccess,
IObjectStorage/MinioObjectStorage, background queue. IOcrService là adapter chưa cấu hình.
Không có Chain/Location/Staff assignment/Resident/Meter/MeterReading/OperationalTask/Invoice,
repository nghiệp vụ, lifecycle xác minh hoặc các job JOB-09/10. Mobile App.tsx là demo,
không có đăng nhập/navigation/onboarding/task/billing. PostgreSQL local đã kiểm tra chỉ có
9 bảng foundation (7 bảng AspNet*, BackgroundJobs, __EFMigrationsHistory); không có bảng nghiệp vụ.

Không tạo schema/lifecycle thay thế cho những module này. Không có dữ liệu identity plaintext
trong EF model để chuyển đổi. Không tạo migration rỗng hoặc bảng OCR dư thừa. Confirmation,
billing, lưu evidence và màn hình mobile tích hợp cần các module thật trước khi hoàn thành.

## Kế hoạch và tiêu chí

1. Thay adapter OCR bằng engine ONNX CPU tái sử dụng session, OpenCV, model pin/checksum.
2. Trả proposal có cảnh báo/thiếu trường, không tự xác minh hay ghi database.
3. API binary stream: xác thực + role + scope server trước đọc ảnh; mặc định fail closed khi
   chưa có repository tài nguyên. Không dùng multipart/IFormFile vì có thể buffer ảnh CCCD ra đĩa.
4. Primitive AES-GCM/HMAC có kiểm thử, chưa gắn vào bảng không tồn tại; không cung cấp API giải mã.
5. Test lỗi ảnh, parse mơ hồ, cancellation, quyền và inference Linux thật; báo rõ phần chưa chạy.

Các trường hợp bắt buộc: Owner đúng scope/Staff đúng Location được tạo proposal; Guest/Tenant,
Staff khác Location và tài nguyên không tồn tại bị từ chối trước inference; model lỗi/timeout
cho phép nhập tay; ảnh lỗi không ghi dữ liệu; nhiều số mơ hồ không được tự chọn thành chỉ số;
AES sửa ciphertext/tag/AAD hoặc dùng sai khóa phải thất bại.

## Quyết định model

Từ điển `monkt/paddleocr-onnx` Latin v5 đã kiểm tra thiếu nhiều ký tự tiếng Việt, nên không chọn.
Chọn thử nghiệm PP-OCRv6 DBNet + recognizer tiếng Việt Run 6 do tác giả OcrDoc phát hành:
https://huggingface.co/truonggiabao7/ocrdoc-models/tree/9b5346432fb84a447fdc4d780a7741126b446b0f
Model card công bố Apache-2.0 cho weights. Không lấy số accuracy của tác giả làm kết quả BHOME.
Nhận dạng input BGR NCHW 48x320/640, normalize [-1,1]; CTC + charset cố định.
Detection dùng RGB ImageNet normalization, map xác suất DB. Recognizer BGR [-1,1],
48x320, giữ tỉ lệ/pad nếu đủ chiều rộng; dòng quá dài co về 320. Không triển khai MRZ 640.

Đây vẫn là ONNX Runtime/OpenCvSharp .NET theo yêu cầu, không đổi provider hoặc gửi ảnh ra ngoài.
AES/HMAC được yêu cầu rõ trong master prompt; chưa có quyết định schema/key vault của dự án.

## Kiến trúc và API thực tế

`OcrController -> OcrWorkflowService -> IOcrWorkflowResources + ResourceAccess -> IOcrService`
`-> LocalOcrService -> IOcrEngine/OnnxOcrEngine -> IImagePreprocessor/OpenCV -> ONNX Runtime CPU`.
Không có bước repository ghi dữ liệu trong luồng proposal. `UnavailableOcrWorkflowResources`
trả 503 cho đến khi module thật cung cấp scope và trạng thái từ database. Không nhận ownerId,
locationId hoặc meter type từ client để xác định quyền. `IStaffLocationAccess` hiện vẫn fail closed.

| POST /api/v1/ocr/           | Quyền / dữ liệu                                                           | Kết quả            |
| --------------------------- | ------------------------------------------------------------------------- | ------------------ |
| identity/{residentId}/front | Owner đúng scope hoặc Staff được gán Location; body PNG/JPEG nhị phân     | Proposal mặt trước |
| identity/{residentId}/back  | Quyền như trên; body nhị phân, không multipart/base64                     | Proposal mặt sau   |
| meter-tasks/{taskId}        | Staff được gán Location; server tra loại meter, eligibility/assignee/task | Proposal reading   |

Hai mặt được nhận riêng; chưa có lưu/merge hay đối soát chéo hai mặt. Parser chưa xác nhận
đúng loại thẻ hoặc đúng mặt. Mặt trước thiếu dữ liệu báo missingFields; không suy diễn trường
không đọc được. Nhãn hoặc địa chỉ nhiều dòng có thể thiếu; luôn yêu cầu kiểm tra/nhập tay.

DTO giữ `proposedFields`, `engineVersion`, thêm `confidence`, `warnings`, `missingFields`,
`requiresConfirmation:true`, `manualEntryAvailable:true`, `isFallback`. Confidence là điểm CTC
tư vấn, không phải xác suất danh tính đúng. Không trả raw OCR text hay ảnh. Cảnh báo là mã ổn định,
client tương lai phải hiển thị thông báo tiếng Việt. Ảnh lỗi 400/413, MIME ngoài JPEG/PNG 415;
không đăng nhập 401, role sai 403, resource vắng/ngoài scope 404, task đóng 409,
workflow/model tắt 503. Model lỗi runtime/bận/timeout trả proposal rỗng với fallback rõ ràng.
Tất cả response OCR có no-store, gồm lỗi. Không có endpoint xác nhận hoặc giải mã giả lập.

## Xử lý ảnh, tài nguyên và bảo mật

Đọc RAM tối đa 5 MiB + 1 byte, kiểm magic/dimensions PNG/JPEG trước giải mã (12 triệu pixel),
giới hạn cạnh sau giải mã 1600. Buffer input được zero trong finally khi thành công/lỗi/hủy.
Stream thuộc caller, không tự đóng. Không dùng EnableBuffering, IFormFile, DbContext, storage,
file ảnh tạm hoặc HTTP client trong engine. Không log ảnh, proposal, raw text hoặc exception detail.
Không bật request-body logging ở ingress/APM; quản lý swap/core dump theo môi trường triển khai.

Mỗi process có một detector/recognizer, giới hạn 1 pipeline đang chạy; yêu cầu thêm nhận fallback
`ocr_busy` ngay. Deadline 8s gồm đọc ảnh và inference; cancellation gọi RunOptions.Terminate rồi
đợi native call dừng trước khi trả slot/xóa buffer. Decode/OpenCV đồng bộ chỉ kiểm deadline ở
ranh giới xử lý, nên chưa bảo đảm hard deadline cho mọi ảnh bất thường. Không tạo Task.Run rồi
bỏ mặc native job sau timeout. Warmup kiểm model/checksum trước HTTP listener khi Ocr.Enabled=true;
thiếu/sai model làm startup thất bại thay vì tải mạng hoặc giả vờ chạy.

Sáu profile có thể cấu hình riêng ở `Ocr:Profiles:<enum name>`. Mặc định giữ màu;
ClockwiseQuarterTurns/EnhanceContrast/Denoise/Threshold là tùy chọn. OpenCV hỗ trợ EXIF khi decode;
chưa có bộ phân loại hướng 180 độ hay căn phối cảnh toàn thẻ. Cắt vùng chữ DB + min-area rectangle
và warp cục bộ; không tự đoán góc thẻ nếu không chắc chắn. Blur/glare chỉ cảnh báo heuristic,
nền trắng cũng có thể gây cảnh báo glare. Chưa có so sánh accuracy trên bộ ảnh thực tế.

`IIdentityProtection` là primitive cho JSON trường đã xác nhận, không cấp quyền đọc/ghi.
AES-256-GCM: nonce random 96 bit, tag 128 bit, envelope ciphertext/nonce/tag/keyVersion;
AAD gắn OwnerId + ResidentId + version chống hoán đổi record/scope. Caller phải xóa plaintext
sau sử dụng. HMAC-SHA-256 chuẩn hóa Trim + đúng 12 ASCII digits, index gắn OwnerId để không
match chéo tổ chức. Đây là kiểm format, không xác thực CCCD/chip/pháp lý. Chưa tự merge/trả
thông tin người khác. Key mã hóa và HMAC riêng, 256 bit từ cấu hình deployment; không có key mặc định.

Ví dụ tên biến (giá trị phải được secret manager cấp, không commit):

```text
IdentityProtection__ActiveEncryptionVersion=v1
IdentityProtection__EncryptionKeys__v1=<base64 32 random bytes>
IdentityProtection__ActiveHmacVersion=h1
IdentityProtection__HmacKeys__h1=<different base64 32 random bytes>
Ocr__Enabled=true
Ocr__ModelDirectory=/models
```

Key version cũ vẫn có thể giải mã nếu còn trong keyring. HMAC rotation cần dual-index/backfill
theo module persistence tương lai; không thay key rồi bỏ index cũ. Giới hạn 16 KiB payload.
Không tuyên bố đã mã hóa database: hiện không có bảng Resident để gắn primitive.

## Database / migration / tích hợp còn thiếu

Không tạo/chạy migration nghiệp vụ và không thay schema production. Migration Identity hiện có
được test hồi quy trên PostgreSQL disposable. Khi có Resident phải kiểm các consumer tìm kiếm,
hợp đồng, export; chọn envelope + HMAC versioned theo scope thật, cập nhật bằng EF migration
và backfill ứng dụng có key. Giữ plaintext nguồn đến khi đối soát hoàn tất; không dump/log PII.
Rollback phải bảo toàn envelope và key cũ, không downgrade bằng cách xóa dữ liệu đã mã hóa.

Chưa triển khai: confirmation/persistence/verification/audit nghiệp vụ; duplicate lookup + index
constraint; reading monotonicity, rollover/replacement/reset, precision, high usage policy,
period/idempotency/task lifecycle; MinIO evidence upload + DB transaction/compensation;
billing confirmed-only; JOB-09/10; capture/cleanup và navigation React Native thật.
Không thay App.tsx bằng màn hình demo mới vì không có workflow nào để nối vào.
Các luồng này cần dữ liệu domain và chính sách được duyệt, không được thay bằng mock production.

## Lệnh tái lập

```powershell
powershell -ExecutionPolicy Bypass -File scripts/Get-OcrModels.ps1
dotnet build src/backend/BHome.sln
dotnet test src/backend/BHome.sln
dotnet format src/backend/BHome.sln --verify-no-changes
dotnet run --project tools/BHome.OcrSmoke -- .tools/ocr-models tests/fixtures/ocr
docker compose -f deploy/docker/compose.ocr-smoke.yml build
docker compose -f deploy/docker/compose.ocr-smoke.yml run --rm smoke
docker build -f deploy/docker/Api.Dockerfile -t bhome/api:ocr-local .
```

Model chỉ tải lúc provisioning bằng script pin revision/checksum; không được commit weights.
Smoke container non-root, network none, filesystem read-only, model mount read-only, 2 CPU,
768 MiB RAM, 128 PIDs; không dùng GPU. API image cũng dùng Debian bookworm, OpenCV slim +
libgomp1. Chỉ bật OCR sau kiểm model mount. Các giới hạn CPU/RAM API cần cấu hình tại deployment
thật (compose gốc hiện chỉ có PostgreSQL/MinIO). Native OpenCV analyzer không tương thích Roslyn
4.11 được loại riêng qua Directory.Build.targets; SDK analyzers vẫn hoạt động.

Smoke in shapes, thời gian, CPU và working set, không in nội dung identity. Nó trả exit 1 nếu
exact match synthetic thất bại. Bộ ảnh có 3 ảnh tự sinh, không phải kiểm định CCCD/thực tế đồng hồ.
Xem kết quả thực thi ở phần tiếp theo; không suy ra >=90% accuracy hoặc SLA từ smoke.

## Kết quả thực thi 28/10/2026

Môi trường host Windows x64, .NET SDK 8.0.427; Docker Desktop Linux/amd64.
Test backend dùng PostgreSQL 16 disposable, không migrate database local của người dùng.

| Lệnh / kiểm chứng                                                          | Kết quả thực tế                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `dotnet build src/backend/BHome.sln`                                       | PASS, 0 warnings / 0 errors                                                                      |
| `dotnet test src/backend/BHome.sln`                                        | PASS: Domain 1, Application 44, Integration 98; tổng 143, fail 0, skip 0; có Docker/PostgreSQL   |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`     | PASS sau sửa format các file mới                                                                 |
| `git diff --check`                                                         | PASS                                                                                             |
| `scripts/Get-OcrModels.ps1`                                                | PASS checksum cả model, charset và model card                                                    |
| Prettier check các JSON/YAML/Markdown thay đổi                             | PASS                                                                                             |
| Compose config (gốc với .env.example và OCR smoke)                         | PASS                                                                                             |
| Build `OcrSmoke.Dockerfile`, `Api.Dockerfile`                              | PASS, biên dịch thực tế trong SDK Linux                                                          |
| `docker compose -f deploy/docker/compose.ocr-smoke.yml run --rm smoke`     | **FAIL exact match mặt trước**, exit 1; native decode + inference thực tế chạy cả 6 lượt profile |
| API container bật OCR, non-root UID 1654, 2 CPU/768 MiB, root FS read-only | Startup/warmup PASS; `/health/live` 200; POST OCR anonymous 401; container thử nghiệm đã xóa     |
| Mobile/E2E onboarding, DB identity, MinIO evidence, billing                | **NOT RUN / chưa triển khai**, thiếu module nghiệp vụ                                            |

Smoke dùng **3 ảnh tổng hợp**: mặt trước, mặt sau và một ảnh số in được tái dùng cho 4 profile
meter. Đây là 6 lượt xử lý, không phải 6 mẫu độc lập hay bộ >=50 ảnh đánh giá accuracy.

| Profile Linux (2 CPU, 768 MiB) | Elapsed ms | CPU ms | So khớp trường kỳ vọng                                         |
| ------------------------------ | ---------: | -----: | -------------------------------------------------------------- |
| IdentityFront                  |        976 |   1810 | FAIL tên có dấu; số CCCD tổng hợp cũng bị thiếu trong proposal |
| IdentityBack                   |        483 |    950 | PASS ngày cấp                                                  |
| MechanicalElectricity          |        309 |    620 | PASS số in                                                     |
| MechanicalWater                |        292 |    590 | PASS cùng ảnh số in                                            |
| DigitalElectricity             |        296 |    590 | PASS cùng ảnh số in                                            |
| DigitalWater                   |        276 |    560 | PASS cùng ảnh số in                                            |

Khởi tạo/checksum/session Linux: 8132 ms, trước request. Working set của process smoke đo được
512856064–553390080 bytes; có thêm session tạm để in metadata, nên không dùng số này làm
memory budget API chuẩn. Shapes thực tế: detector `x:[N,3,H,W] -> [N,1,H,W]`, recognizer
`x:[N,3,48,W] -> [N,T,230]`. Charset file 228 dòng + blank CTC + space = 230 classes.

Windows smoke cũng exit 1 ở tên mặt trước; lượt cuối đo 244–997 ms mỗi profile. Các phép đo
trên chưa gồm capture/mobile/network/TLS, không có p95/concurrency load và không chứng minh
SLA <=10s trong evaluation workload. Chưa đo ảnh đồng hồ cơ khí/digital thật, rollover, glare,
CCCD thật đã ẩn danh hoặc ảnh nghiêng. Không tuyên bố production-ready/accuracy đạt mục tiêu.

Build đầu tiên gặp CS9057 do analyzer OpenCV/Roslyn; đã sửa bằng lọc analyzer riêng. Test AES
ban đầu dùng assertion exact base exception, đã sửa để chấp nhận AuthenticationTagMismatchException
là subclass CryptographicException. Format ban đầu FAIL; lần kiểm cuối PASS. Không che kết quả
smoke nhận dạng còn FAIL bằng cách đổi expected label hoặc coi proposal là verified.

| Phase trong master prompt | Đã thực hiện / kiểm chứng                                            | Còn thiếu                                                                   |
| ------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1 Assessment              | Đọc code, report, migration, schema local, auth/storage/tests        | Không có domain workflow để tích hợp                                        |
| 2 Engine                  | ONNX/OpenCV local; 6 profile; chạy Linux CPU thật                    | Tên có dấu chưa exact; chưa đánh giá layout/ảnh thực tế                     |
| 3 Backend                 | API proposal, validation, scope port, fail closed; API/app tests     | Resource repository production và confirmation                              |
| 4 Security/persistence    | AES-GCM/HMAC, key version/AAD, transient input; test tamper/scope    | Resident schema, migration/backfill, duplicate lookup/audit, MinIO evidence |
| 5 Mobile                  | Không thay demo thành luồng giả                                      | Toàn bộ capture/edit/confirm cần màn hình/nghiệp vụ thật                    |
| 6 Verification            | Build/143 tests/format, Docker build/startup/inference, đo synthetic | E2E/SLA/accuracy thật và các tiêu chí còn thiếu ở trên                      |

## Các file thay đổi trong nhiệm vụ OCR

Các đường dẫn dưới đây tương đối từ repository root. Không sửa các thay đổi có sẵn của người dùng
ở README.md, docs/development/LOCAL_DEVELOPMENT.md, package.json hoặc .expo/.

| Đường dẫn                                                                              | Mục đích                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Directory.Build.targets`                                                              | Tương thích analyzer OpenCV với SDK 8 cho API/tools/tests           |
| `src/backend/BHome.Application/Ocr/IOcrService.cs`                                     | Giữ hợp đồng legacy, thêm profile/proposal/fallback                 |
| `src/backend/BHome.Application/Ocr/OcrContracts.cs`                                    | Engine boundary, kinds, lines, lỗi input                            |
| `src/backend/BHome.Application/Ocr/OcrFieldParser.cs`                                  | Parse tiếng Việt/date/chỉ số bảo thủ                                |
| `src/backend/BHome.Application/Ocr/OcrWorkflowService.cs`                              | Role/scope/state trước inference, resource port                     |
| `src/backend/BHome.Application/Ocr/IIdentityProtection.cs`                             | Envelope và crypto boundary                                         |
| `src/backend/BHome.Infrastructure/Ocr/OcrOptions.cs`                                   | Giới hạn và sáu profile                                             |
| `src/backend/BHome.Infrastructure/Ocr/ImagePreprocessor.cs`                            | Kiểm ảnh, OpenCV, crop input/quality                                |
| `src/backend/BHome.Infrastructure/Ocr/OnnxOcrEngine.cs`                                | Model checksum/session, detection/recognition/CTC                   |
| `src/backend/BHome.Infrastructure/Ocr/LocalOcrService.cs`                              | Bounded RAM/concurrency, deadline/fallback/zero buffer              |
| `src/backend/BHome.Infrastructure/Ocr/UnavailableOcrWorkflowResources.cs`              | Chặn khi thiếu repository thật                                      |
| `src/backend/BHome.Infrastructure/Ocr/OcrWarmup.cs`                                    | Khởi tạo model trước listener                                       |
| `src/backend/BHome.Infrastructure/Ocr/IdentityProtection.cs`                           | AES-GCM/HMAC/key version/scope binding                              |
| `src/backend/BHome.Infrastructure/DependencyInjection.cs`                              | Đăng ký OCR/crypto/options                                          |
| `src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj`                         | ONNX/OpenCV/native runtime pinned                                   |
| `src/backend/BHome.Infrastructure/Integrations/UnconfiguredAdapters.cs`                | Bỏ adapter OCR cũ, giữ các provider khác                            |
| `src/backend/BHome.Api/Controllers/Ocr/OcrController.cs`                               | Binary proposal API và status mapping                               |
| `src/backend/BHome.Api/Program.cs`                                                     | No-store cả response/error OCR                                      |
| `src/backend/BHome.Api/appsettings.json`                                               | OCR disabled mặc định và giới hạn không chứa secret                 |
| `tests/backend/BHome.Application.UnitTests/Ocr/OcrParserTests.cs`                      | Unicode, ngày, số mơ hồ/âm/thiếu                                    |
| `tests/backend/BHome.Application.UnitTests/Ocr/OcrWorkflowTests.cs`                    | Owner/Staff/Tenant, Location/state và không gọi engine khi cấm      |
| `tests/backend/BHome.IntegrationTests/Ocr/IdentityProtectionTests.cs`                  | Roundtrip, tamper, nonce/AAD/key rotation/HMAC                      |
| `tests/backend/BHome.IntegrationTests/Ocr/LocalOcrTests.cs`                            | Header/size/decode/cancellation/concurrency/fallback/cleanup        |
| `tests/backend/BHome.IntegrationTests/Ocr/OcrApiTests.cs`                              | HTTP role/scope/state/MIME/size/no-store và mặc định fail closed    |
| `tools/BHome.OcrSmoke/BHome.OcrSmoke.csproj`, `Program.cs`                             | Real model smoke, metadata và số đo synthetic                       |
| `scripts/Get-OcrModels.ps1`                                                            | Provision artifacts theo revision/checksum, không tải trong request |
| `scripts/New-SyntheticOcrFixtures.ps1`                                                 | Sinh fixture không dùng dữ liệu thật                                |
| `tests/fixtures/ocr/identity-front.png`, `identity-back.png`, `meter.png`, `README.md` | Mẫu giả lập và giới hạn sử dụng                                     |
| `deploy/docker/Api.Dockerfile`                                                         | Headless Linux native dependencies + SDK analyzer filter            |
| `deploy/docker/OcrSmoke.Dockerfile`, `compose.ocr-smoke.yml`                           | Smoke Linux CPU/read-only/no-network có giới hạn tài nguyên         |
| `deploy/docker/README.md`, `docs/api/API_CONVENTIONS.md`                               | Hướng dẫn smoke và API proposal                                     |
| `docs/development/INTERNAL_OCR.md`                                                     | Truy vết, thiết kế, cấu hình, kết quả và phần chưa hoàn thành       |

Nhánh làm việc `member/QHuy`; chưa commit, push, merge hay triển khai production.
