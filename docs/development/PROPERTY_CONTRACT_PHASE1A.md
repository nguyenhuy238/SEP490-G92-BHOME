# Phase 1A — Property và Contract consistency

Ngày verification: 05/11/2026. Phạm vi backend; không commit, push, đổi branch, migration hoặc truy cập database dùng chung.

Nguồn đối chiếu: root `AGENTS.md`, Report 3 v1.3, `docs/api/PROPERTY_MANAGEMENT.md`, code Property/Contract,
Compact24 writer/schema và test fixtures. Traceability chính: BF-01, BF-03/04/05; UC-04 A2/A4, UC-15/16/19/20/21;
GBR-01..05, GBR-08/09/13/18; DBR-01/02/13.

## A. Code Review Results

Các lỗi audit ban đầu đã được xác nhận và được Phase 1A xử lý:

- Contract activation/completion trước đây đổi `Room.Status` mà không tăng `Room.Version`.
- Property dùng Location advisory lock, còn Contract dùng payment-ledger lock rồi Room row; chưa cùng khóa Location.
- Property chỉ dựa vào Resident và Room.Status, chưa truy vấn nghĩa vụ Contract thật.
- Tài liệu Property nói Contract/Invoice chưa tồn tại đã lỗi thời.

Kết quả review implementation hiện tại:

| Hạng mục                     | Kết quả xác minh                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Shared transition validation | `PropertyRules.CanChangeRoomStatus` được dùng bởi Property và Contract; giữ numeric RoomStatus 0..3                                      |
| Manual state                 | API cấu hình không tạo OnHold/Occupied; update metadata có thể giữ nguyên trạng thái workflow-controlled                                 |
| Contract activation          | Chỉ Available/Occupied hợp lệ; recheck Location/RoomType; đổi sang Occupied mới tăng Room.Version                                        |
| Contract termination         | Còn Contract Active khác thì giữ Occupied và không tăng version; không còn thì Occupied → Available và tăng version                      |
| Stale Property write         | expected version được kiểm tra trước transition/dependency checks; Compact24 writer vẫn dùng optimistic concurrency                      |
| Obligations                  | Phân biệt Resident record, current occupancy, Active Contract và pending có bằng chứng ký hoặc DepositVerification dương                 |
| Pending semantics            | Status pending đơn thuần không giữ phòng; bằng chứng chỉ bảo vệ cấu hình, không đánh dấu paid/active và không giả lập Holding            |
| Transaction/audit            | Room status/version và PropertyChange được SaveChanges trong transaction Contract; Contract security audit vẫn là event riêng            |
| Lock order                   | Contract: payment ledger → Location advisory → Room row; Property: Location; Invoice: Location → Room; payment/adjustment: ledger → Room |
| Authorization/API            | Không đổi PermissionAccess, ResourceAccess, controller, HTTP DTO, ProblemDetails hoặc Location scope                                     |
| Compact24                    | Runtime vẫn là Compact24DbContext; RoomType vẫn ở locations JSONB; audit record types không bị gộp/xóa                                   |
| Billing/Invoice              | Không đổi pricing; InvoiceRepository vẫn snapshot policy/occupancy và gọi RecordUsage trong transaction                                  |

Không phát hiện duplicate production validation mới ngoài việc `CanManuallyChange` ủy quyền cho shared validator để giữ compatibility.
Không phát hiện breaking API/schema change. Thuật toán capacity/overlap hiện có và mô hình nhiều Contract/Room được giữ nguyên.

Các file production chính: `PropertyConfiguration.cs`, `PropertyContracts.cs`, `PropertyService.cs`,
`PostgresPropertyRepository.cs`, `ContractService.cs`, `ContractRepository.cs`. Test bổ sung tại
`PropertyRulesTests.cs`, `PropertyServiceTests.cs`, `ContractServiceTests.cs`,
`PropertyContractConsistencyTests.cs` và `PropertyContractDockerTests.cs`.

Trong lượt verification, sửa thêm duy nhất fixture `OcrApiTests.Configure`: thay production `IOcrEngine`/`Lazy<IOcrEngine>`
bằng test engine để `OcrWarmup` không phụ thuộc weights ngoài Git. Không sửa OCR production.

## B. PostgreSQL Concurrency Tests

Docker CLI 29.4.0 có mặt nhưng Docker engine không chạy:

- `docker version`: FAIL khi kết nối `npipe:////./pipe/dockerDesktopLinuxEngine`.
- `docker info`: FAIL cùng lỗi; phần Server không khả dụng.
- Windows service `com.docker.service` đang `Stopped`, startup type `Manual`; verification không tự khởi động service.
- Testcontainers báo `DockerUnavailableException`, không kết nối được `npipe://./pipe/docker_engine`.
- `BHOME_COMPACT24_TEST_ADMIN` không được cấu hình; không có PostgreSQL disposable native thay thế.
- Không tự khởi động/cài Docker và không kết nối database `bhome`.

Lệnh đã chạy:

```powershell
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj `
  --no-build --filter "FullyQualifiedName~PropertyContractDockerTests"
```

Fixture thất bại ở constructor trước khi tạo container/schema. Runner ghi 10 FAIL do fixture, nhưng phân loại verification
là **BLOCKED BY ENVIRONMENT**; không test nào đi tới code nghiệp vụ và không được tính là product FAIL/PASS.

| #   | Test PostgreSQL 16 / tiêu chí                                 | Kết quả                |
| --- | ------------------------------------------------------------- | ---------------------- |
| 1   | Property update concurrent Contract activation                | BLOCKED BY ENVIRONMENT |
| 2   | Property update concurrent Contract termination               | BLOCKED BY ENVIRONMENT |
| 3   | Pending obligation bằng signed evidence                       | BLOCKED BY ENVIRONMENT |
| 4   | Pending obligation bằng verified payment evidence             | BLOCKED BY ENVIRONMENT |
| 5   | Nhiều Active Contract: termination không release Room/version | BLOCKED BY ENVIRONMENT |
| 6   | Owner/Staff permission và assigned Location scope             | BLOCKED BY ENVIRONMENT |
| 7   | Manual OnHold/Occupied và invalid scope bị từ chối            | BLOCKED BY ENVIRONMENT |
| 8   | Resident protection và OCR capture creation regression        | BLOCKED BY ENVIRONMENT |
| 9   | Property audit success/rollback và duplicate race             | BLOCKED BY ENVIRONMENT |
| 10  | BillingPolicy/Invoice snapshot và FirstUsedAt                 | BLOCKED BY ENVIRONMENT |

Static review xác nhận thứ tự khóa nhất quán nêu ở phần A và không thấy đường Location → payment ledger.
Unit tests xác nhận version/no-op/stale/multiple contracts ở mức Application. Hai nguồn này không thay thế PostgreSQL test
về deadlock, lost update, SQL translation, transaction rollback hoặc persistence audit.

## C. OCR Test Failures

Root cause của 23 lỗi cũ là test isolation:

- `.env` local bật `Ocr__Enabled=true` và trỏ `Ocr__ModelDirectory` tới `.tools/ocr-models`.
- `OcrWarmup` resolve production `IOcrEngine` khi host khởi động.
- `OcrApiTests` đã thay `LocalOcrService`, nhưng chưa thay registration `IOcrEngine` dùng bởi warmup.
- Vì `.tools/ocr-models/detection.onnx` không có, host chết trước khi test engine được dùng.

Model production được cố ý loại khỏi Git vì `.gitignore` bỏ toàn bộ `.tools/`. Setup được tài liệu hóa bằng
`scripts/Get-OcrModels.ps1`; script provisioning pin revision/checksum. Engine yêu cầu:

| File               | SHA-256 được code kiểm tra                                         |
| ------------------ | ------------------------------------------------------------------ |
| `detection.onnx`   | `eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1` |
| `recognition.onnx` | `767305d37d06728fe9578ff8132595ce23f66139df5e2937fd4131bd1dc34f12` |
| `charset.txt`      | `5d801bf60472c4c1b184b6b6843aa2c754d8daf1429247e07658ee0bd79ab448` |

Không tải model và không thay thuật toán production. Fixture API được sửa để warmup dùng test engine. Kết quả thực thi mới:
`OcrApiTests`: **35 PASS, 0 FAIL, 0 SKIP**. Smoke/accuracy với engine production vẫn **NOT RUN** vì model local không có;
muốn chạy phải provisioning bằng script được repository duyệt rồi dùng `BHome.OcrSmoke` theo `INTERNAL_OCR.md`.

## D. Regression Tests

| Lệnh thực thi ngày 05/11/2026                                                   | Kết quả                                                                                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln`                                            | PASS — 0 warning, 0 error                                                                                                                                       |
| `dotnet test src/backend/BHome.sln --no-build --filter "Category!=Docker"`      | PASS — Domain 90; Application 219; Integration 215 PASS + 126 SKIP; tổng 524 PASS, 0 FAIL                                                                       |
| `dotnet test ... --filter "FullyQualifiedName~OcrApiTests"`                     | PASS — 35/35                                                                                                                                                    |
| 10 `PropertyContractDockerTests`                                                | BLOCKED BY ENVIRONMENT — fixture DockerUnavailableException; 0 test nghiệp vụ được thực thi                                                                     |
| Full `dotnet test src/backend/BHome.sln`                                        | NOT RUN — Docker engine đã được xác minh không khả dụng; filtered critical suite đã ghi nhận blocker                                                            |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`          | FAIL — 43 whitespace diagnostics chỉ trong 2 file ngoài Phase 1A: `tools/BHome.Compact24Migration/Program.cs`, `tools/BHome.OcrSmoke/AutomaticOcrEvaluation.cs` |
| Format verify với `--include` toàn bộ 14 file C# Phase 1A/verification thay đổi | PASS — exit 0                                                                                                                                                   |
| `git diff --check`                                                              | PASS                                                                                                                                                            |

126 SKIP là các CompactPostgres tests cần `BHOME_COMPACT24_TEST_ADMIN`; không được tính là PASS.
TRX/log hiện tại nằm trong `%TEMP%/bhome-phase1a-verification-nondocker` và
`%TEMP%/bhome-phase1a-verification-docker`.

## E. Database Verification

- Embedded Compact24 SQL vẫn có 24 `CREATE TABLE`.
- Git diff không chứa `.sql`, migration, controller hoặc `.csproj` production change.
- Không tạo bảng/migration, không chạy `dotnet ef database update`, không truy cập database dùng chung.
- Fixture PostgreSQL 16 chỉ dùng embedded Compact24 schema trong disposable Testcontainer; lượt này container chưa được tạo.
- Schema version vẫn `compact24-2026-11-04`; RoomType/audit mapping không đổi.

## F. Remaining Risks

- Critical PostgreSQL concurrency tests chưa chạy; chưa có bằng chứng runtime về deadlock, lost update và atomic audit/Room write.
- Schema chưa có invariant đầy đủ xuyên Contract–Room; writer/direct SQL mới bỏ qua service có thể phá invariant.
- Holding Contract chưa hoàn chỉnh. Phase 1A chỉ giữ safeguard OnHold; không tạo/convert Holding hay Holding Deposit ledger.
- Resident lịch sử tiếp tục chặn cấu hình theo safeguard cũ; chưa có quyết định retention/release mới.
- Production OCR smoke/accuracy vẫn cần model được provisioning và dataset được phê duyệt.
- Format gate toàn solution còn fail ở hai file ngoài phạm vi; các file Phase 1A đã format sạch.

## G. Phase 1A Acceptance Decision

**NOT ACCEPTED: Critical concurrency tests could not be executed because Docker/PostgreSQL disposable infrastructure is unavailable.**

Các rule/unit/API regression hiện pass, nhưng yêu cầu Phase 1A cấm khẳng định concurrency safety nếu chưa có PostgreSQL-backed tests.

## H. Phase 1B Readiness

**Cập nhật quyết định 05/11/2026:** chủ dự án cho phép tiến hành Phase 1B chỉ-đọc mà không chờ Docker.
Không cho phép mở rộng write path Room/Contract và không được coi quyết định này là Phase 1A ACCEPTED.
10 `PropertyContractDockerTests` vẫn BLOCKED BY ENVIRONMENT và phải pass trước khi kết luận PostgreSQL
concurrency safety. Phase 1B và giới hạn verification được ghi ở `ROOM_READINESS_PHASE1B.md`.
