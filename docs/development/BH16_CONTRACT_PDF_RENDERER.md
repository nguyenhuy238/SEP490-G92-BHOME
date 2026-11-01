# BH-16 — Main Contract PDF Renderer & Signing Integration

Ngày triển khai: **01/11/2026**. Nhánh: `member/QHuy`, base HEAD `04a3e91`. Chỉ backend và automated tests. Không commit/push/merge/deploy, không sửa môi trường người dùng hoặc chạy migration trên DB cá nhân/production.

## A. Implementation summary

Đã thay `UnconfiguredContractRenderer` bằng `ContractPdfRenderer` trong DI. Renderer tạo PDF A4 bằng iText hiện có, dùng snapshot đã sealed, font Tinos có sẵn trong repository và template JSON được embed vào assembly. Không thêm package, không thêm service ký, endpoint, response field, bảng hoặc migration; không sửa Invoice/Payment/Room occupancy.

Không tìm thấy template đã được phê duyệt trong repository. Theo yêu cầu implementation hiện tại, mẫu `main-contract-development-v1` chỉ dành Development/Testing và luôn có cảnh báo **CHƯA PHÊ DUYỆT CHO SỬ DỤNG THỰC TẾ**. Mẫu không thêm điều khoản pháp lý: phần Terms lấy nguyên văn từ snapshot đã lưu. Production vẫn từ chối ký; chưa có cơ chế config tự phê duyệt một template.

### Truy vết và kế hoạch đã thực hiện

| Yêu cầu                               | Nguồn và implementation                                                                                                             | Acceptance / test                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tạo tài liệu từ dữ liệu đã xác nhận   | SRS v1.3 UC-15 §2.2, BF-03B; `ContractDocument` → renderer; dữ liệu do `ContractService.Document` lấy từ persistence                | PDF-01/02: dữ liệu bắt buộc, GUIDs/amounts/dates/residents/Terms đúng snapshot; reject invalid input             |
| Snapshot/version và evidence truy vết | GBR-04/13/18, DBR-03; `ContractDocumentSnapshot.Hash`, PDF metadata, `ContractSignature.SourceHash/PreparedHash/SignedHash` hiện có | PDF-04: sửa Terms hoặc occupant mà không reseal bị409; signed PDF giữ contract ID/hash/template version          |
| Ký hai bên bằng provider ngoài        | UC-15, GBR-04; giữ `ViettelMySignContractAdapter`, `IPdfSigner`, certificate store, storage và signing saga                         | SIGN-01/02/03/04: hai incremental signatures, wrong signer/key, timeout, tampering; real provider gate ghi riêng |
| Không kích hoạt sớm                   | UC-15, GBR-03; giữ readiness/deposit/Owner activation và transactional Room update                                                  | SIGN-05 + existing Contract UT: thiếu ký/cọc/identity hoặc sai actor bị chặn                                     |
| Privacy và lỗi tích hợp               | AGENTS, Report4 layered backend/private MinIO/security; renderer không thêm logging hoặc đọc identity envelope                      | Không có public PDF route, token/secret hoặc CCCD mới; lỗi chỉ status/code an toàn                               |

Đã đọc `AGENTS.md`, bốn báo cáo `HUY_*`, các phần Contract của SRS tại `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`, Report4/reference delivery và source/test liên quan. Audit tại HEAD `9c68c89` là baseline lịch sử; tài liệu này ghi thay đổi renderer tiếp theo, không sửa kết quả audit cũ thành kết quả mới.

Thứ tự đã làm: kiểm tra interface/provider/fixture → viết renderer tests → triển khai renderer/versioned resource/shared snapshot hash → nối gate vào adapter/DI → thay fake renderer trong real-persistence API test bằng concrete renderer → thêm regression → build/test/format/diff. Thuật toán hash giữ nguyên JSON serialization trước đây, không đổi seal của Contract cũ.

### Cấu hình và giới hạn template

| Setting                                                   | Mặc định        | Hành vi                                                                   |
| --------------------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| `ContractPdf:TemplateId`                                  | Không chọn      | Render/signing bị503 `contract_template_not_configured`                   |
| `main-contract-development-v1`                            | Phải chọn rõ    | Chỉ dùng khi `IHostEnvironment` là `Development` hoặc `Testing`           |
| Cùng ID trên Production/Staging/không có host environment | Không được dùng | 503 `contract_template_not_approved`; không gọi yêu cầu ký ngoài sau gate |
| ID hợp lệ nhưng không tồn tại                             | Không fallback  | 503 `contract_template_not_found`                                         |
| ID chứa path/URL hoặc dài hơn80 ký tự                     | Không hợp lệ    | Options validation fail; không đọc file ngoài assembly                    |

Ví dụ process-local trong môi trường phát triển đã có các cấu hình DB/JWT/storage cần thiết:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ContractPdf__TemplateId = 'main-contract-development-v1'
```

Không tự ghi setting này vào `.env*` hoặc bật cho Production. Không thêm flag `Approved=true` để biến mẫu thử thành mẫu production. Template approved thực sự cần một version/resource được nhóm review và quy trình phê duyệt được ghi nhận trong task tiếp theo.

Renderer scoped; font bytes và template resource immutable được lazy-load dùng chung, mỗi PDF tạo `PdfFont` riêng. Reuse font OFL từ `src/digital-signing/BHome.DigitalSigning.Infrastructure/Pdf/Fonts/Tinos-Regular.ttf`, license nằm cạnh file. Không phụ thuộc font OS, đường dẫn tuyệt đối hoặc network call.

Các trường được hiển thị chính là14 properties hiện có của `ContractDocument`: contract/version ID, snapshot hash, Room ID, Owner/Tenant signer IDs, representative/occupant IDs, start/end dates, monthly rent, required deposit, Holding reference/applied amount, Terms. Không tự giải mã/thêm họ tên, CCCD, địa chỉ hoặc điều khoản ngoài snapshot để làm mẫu trông như một hợp đồng đã được duyệt. Renewal dùng Contract ID mới làm identity phiên bản theo mô hình hiện có.

Date hiển thị `dd/MM/yyyy`, tiền nguyên VND theo format Việt Nam. Không tính phí, cọc, prorating hoặc payment status trong renderer. Tiếng Việt được encode Unicode và embed font; glyph ngoài phạm vi font bị reject rõ ràng, không âm thầm bỏ ký tự. Terms được xử lý như plain text, giữ newline, không chạy HTML. Giới hạn resident/Terms/money tái kiểm tra theo contract/DTO hiện hành; renderer không log nội dung.

### Snapshot và signing pipeline

```text
ContractService (đọc persistence, kiểm actor/scope và seal)
  → ViettelMySignContractAdapter (chứng thư thuộc đúng actor)
    → IContractDocumentRenderer.ValidateAsync (template + snapshot; cả hai signer)
    → RenderAsync cho signer đầu / reuse signed PDF cho signer tiếp theo
    → IPdfSigner.Prepare → durable prepared object/attempt
    → MySign request/poll → IPdfSigner.Complete/verify
    → private signed object + hash/evidence
    → readiness + verified deposit + Owner activation hiện có
```

`ValidateAsync` là bổ sung vào port renderer nội bộ, không thay DTO của web/mobile. Gate chạy cả khi adapter nhận `previousPdf`, vì chỉ kiểm trong `RenderAsync` sẽ bỏ lọt chữ ký thứ hai khi tiếp tục một PDF Development dưới policy Production. Renderer không render lại nội dung cho signer thứ hai; adapter vẫn ký incremental trên PDF đã ký của bên đầu.

Mỗi PDF có metadata `BHomeContractId`, `BHomeSnapshotHash`, `BHomeTemplateId`, `BHomeTemplateVersion`; contract ID/hash và version template cũng xuất hiện trong nội dung. Source/prepared/signed hashes, provider reference và private object keys tiếp tục do flow hiện có lưu. Không tạo Signing service/certificate/private key mới trong ứng dụng.

`ContractDocumentSnapshot.Hash()` giữ chính xác cách hash cũ: SHA-256 của default JSON bytes với `SnapshotHash=""`, bao gồm các decimal serialization attributes hiện có. `ContractService.Seal/Intact` và renderer dùng chung thuật toán. Renderer copy mảng residents trước validate/hash/render để không dùng dữ liệu mutable thay đổi giữa các bước.

Timeout/network failure mơ hồ sau dispatch vẫn dùng saga cũ: durable ManualReview, chưa Signed, không tự resend khi replay cùng idempotency key. File/PDF tampering bị kiểm chứng qua crypto signer và hash guards hiện có. PDF được tạo hoặc request được gửi không đáp ứng activation.

## B. Modified files

| File                                                                                     | Thay đổi                                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/backend/BHome.Application/Contracts/ContractDocumentSnapshot.cs`                    | Mới; chia sẻ thuật toán hash đã dùng trước đây                                                                  |
| `src/backend/BHome.Application/Contracts/ContractContracts.cs`                           | Thêm `ValidateAsync` vào renderer port nội bộ                                                                   |
| `src/backend/BHome.Application/Contracts/ContractService.cs`                             | Seal/Intact gọi helper chung; không đổi state/payment/authorization logic                                       |
| `src/backend/BHome.Infrastructure/Contracts/ContractPdfOptions.cs`                       | Mới; chọn embedded template ID và validate config                                                               |
| `src/backend/BHome.Infrastructure/Contracts/ContractPdfRenderer.cs`                      | Mới; snapshot validation, PDF/Unicode/version/glyph handling và environment gate                                |
| `src/backend/BHome.Infrastructure/Contracts/Templates/main-contract-development-v1.json` | Mới; template Development/Testing version1, không thêm legal clauses                                            |
| `src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj`                           | Embed template và font đã có; không thêm dependency                                                             |
| `src/backend/BHome.Infrastructure/Contracts/ViettelMySignContractAdapter.cs`             | Gọi template/snapshot validation cho cả initial/incremental ký; bỏ renderer placeholder                         |
| `src/backend/BHome.Infrastructure/DependencyInjection.cs`                                | Bind/validate options, scoped concrete renderer                                                                 |
| `tests/backend/BHome.IntegrationTests/Contracts/ContractPdfRendererTests.cs`             | Mới; pure unit tests, không dùng DB/provider; có Unicode/font/version/validation/concurrency                    |
| `tests/backend/BHome.IntegrationTests/Contracts/ContractPdfSigningCompositionTests.cs`   | Thêm concrete-renderer signing composition, tamper/Production policy và6 anonymous HTTP checks                  |
| `tests/backend/BHome.IntegrationTests/Contracts/ContractLifecycleApiTests.cs`            | Real repository/storage test dùng concrete renderer với fake external CA; thêm Production incremental gate case |
| `tests/backend/BHome.IntegrationTests/Contracts/SyntheticRemoteSigningProvider.cs`       | Giữ synthetic remote provider, bỏ fake renderer đã được thay bằng implementation thật trong API test            |
| `tests/backend/BHome.Application.UnitTests/Contracts/ContractServiceTests.cs`            | Thêm timeout/network ManualReview/replay và wrong Owner signer tests                                            |
| `docs/api/CONTRACT_LIFECYCLE.md`                                                         | Cập nhật contract/config/error behavior, API shape giữ nguyên                                                   |
| `docs/development/BH16_CONTRACT_PDF_RENDERER.md`                                         | Tài liệu bàn giao này                                                                                           |

## C. Test results

Các kết quả dưới đây là **thực chạy trong task implementation**, không kế thừa số pass của audit. Artifact TRX cục bộ trong `.tools/bh16-pdf-renderer/`, đã Git ignore.

| Check                                          | Pass | Fail | Not Run / Blocked     | Evidence                                                                                                                                   |
| ---------------------------------------------- | ---: | ---: | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend build                                  |   Có |    0 | —                     | `dotnet build src/backend/BHome.sln --no-restore`,0 warning/error                                                                          |
| Application unit regression                    |  173 |    0 | —                     | `application-regression.trx`, trong đó27 Contract cases                                                                                    |
| Container-free backend regression              |  149 |    0 | —                     | `container-free-regression.trx`; gồm29 renderer unit +13 PDF/API composition cases và107 foundation/OCR/security/metadata regression cases |
| Digital Signing unit tests                     |   41 |    0 | —                     | `signing.trx`; synthetic cert/provider boundaries                                                                                          |
| Format các C# mới/sửa                          |   Có |    0 | —                     | `dotnet format ... --verify-no-changes --include <12 C# files>`                                                                            |
| Real ContractLifecycle API + PostgreSQL/MinIO  |    — |    — | **BLOCKED / NOT RUN** | Docker CLI có; Linux daemon pipe không kết nối được. Không dùng DB cá nhân thay thế                                                        |
| Real MySign sandbox/production signer identity |    — |    — | **NOT RUN**           | Không có provider environment/cert identity verification evidence                                                                          |
| Approved production template                   |    — |    — | **BLOCKED**           | Chưa được cung cấp; Production sample signing tiếp tục bị chặn                                                                             |

Tổng các lượt regression cuối:173+149+41=**363 case pass**,0 fail/skip. Không cộng thêm40 renderer/composition và24 Contract pass ở lượt trước vì chúng nằm trong các suites được chạy lại/superset.42 renderer/composition cases trong regression cuối là29+13; thư mục tên IntegrationTests không biến pure renderer unit tests thành real database integration. Sau khi tăng cường SIGN-04 để kiểm cả PDF đã ký bị sửa, đã build và chạy riêng case này thành công (`signed-integrity.trx`), không cộng trùng vào tổng.

Các lỗi compile trung gian của code mới đã được sửa trước lượt cuối: fluent-call sau `PdfDocumentInfo.SetMoreInfo` (API trả void) và nullable assertion trong test Holding ID. Không có thay đổi expected result để né một test đúng, không skip hoặc xóa test cũ. Không đo coverage/performance hoặc tuyên bố đạt production-ready.

### PDF/SIGN acceptance mapping

| ID      | Bằng chứng                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF-01  | Development/Testing render được PDF hợp lệ; all14 fields, IDs/hash/version/date/VND được assert                                                                             |
| PDF-02  | 13 invalid required-data cases bị400; không chứa dữ liệu trong exception message                                                                                            |
| PDF-03  | Missing/unconfigured template503; invalid path/URL config bị OptionsValidationException; không fallback mẫu khác                                                            |
| PDF-04  | Changed Terms hoặc occupant array với hash cũ bị409; original PDF/hash giữ nguyên                                                                                           |
| PDF-05  | Extract được đúng tiếng Việt, plain-text markup, font embedded và ToUnicode; long Terms qua nhiều trang                                                                     |
| SIGN-01 | Concrete renderer → existing PDF signer → synthetic remote →2 verified incremental signatures; fake CA không xác nhận danh tính thật                                        |
| SIGN-02 | Wrong Owner không được ký; unrelated private key bị reject. Actual adapter wrong-certificate ownership tests có source nhưng real DB suite NOT RUN                          |
| SIGN-03 | Timeout/network failure giữ ManualReview; replay không gọi Prepare/Request lần hai; chưa Signed/Active                                                                      |
| SIGN-04 | Sửa byte của prepared PDF làm Complete reject; sửa PDF đã ký khiến crypto integrity verification trả false. Existing stored-file activation test chưa chạy PG/MinIO lần này |
| SIGN-05 | Contract UT kiểm thiếu ký/cọc/sai terms/identity/conflict thì activation409, Room không Occupied; chỉ Owner có action                                                       |

### Lệnh chính đã chạy

```powershell
dotnet build src/backend/BHome.sln --no-restore
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-build --logger 'trx;LogFileName=application-regression.trx' --results-directory .tools/bh16-pdf-renderer
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~ContractPdfRendererTests|FullyQualifiedName~ContractPdfSigningCompositionTests|FullyQualifiedName~ApiFoundationTests|FullyQualifiedName~ArchitectureTests|FullyQualifiedName~MigrationConsistencyTests|FullyQualifiedName~MobileWebCorsTests|FullyQualifiedName~PermissionPolicyTests|FullyQualifiedName~SessionPolicyTests|FullyQualifiedName~Ocr.LocalOcrTests|FullyQualifiedName~Ocr.OcrRecognitionTests|FullyQualifiedName~Ocr.IdentityProtectionTests|FullyQualifiedName~Ocr.OcrApiTests|FullyQualifiedName~StaffOperations.OperationalTaskContractTests' --logger 'trx;LogFileName=container-free-regression.trx' --results-directory .tools/bh16-pdf-renderer
dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests/BHome.DigitalSigning.UnitTests.csproj --no-build --logger 'trx;LogFileName=signing.trx' --results-directory .tools/bh16-pdf-renderer
```

Lệnh chọn scope nhỏ để tái chạy khi cần, không chạy lại dư thừa nếu không có thay đổi/lỗi:

```powershell
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-build --filter 'FullyQualifiedName~Contracts'
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~ContractPdfRendererTests|FullyQualifiedName~ContractPdfSigningCompositionTests'
# Chỉ khi Docker test runner đã sẵn, không trỏ vào DB cá nhân:
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~ContractLifecycleApiTests'
```

## D. API verification

Không thêm hoặc đổi route/DTO. HTTP checks đã chạy bằng WebApplicationFactory với middleware/controllers thực; không có auth token và không dùng DB/provider ở sáu trường hợp sau:

| Endpoint                                          | Input thực trong test                                              | Result thực   |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------------- |
| `POST /api/v1/contracts`                          | Valid synthetic ContractDraftInput từ fixture; không Bearer        | 401, no-store |
| `POST /api/v1/contracts/{id}/signing`             | Synthetic contract/certificate GUID, idempotency key; không Bearer | 401, no-store |
| `POST /api/v1/contracts/{id}/signing/sync`        | Empty JSON, idempotency key; không Bearer                          | 401, no-store |
| `POST /api/v1/contracts/{id}/signing/recover`     | Synthetic provider reference, idempotency key; không Bearer        | 401, no-store |
| `GET /api/v1/contracts/{id}/document`             | Synthetic contract GUID; không Bearer                              | 401, no-store |
| `GET /api/v1/contracts/{id}/activation-readiness` | Synthetic contract GUID; không Bearer                              | 401, no-store |

Authorized positive API flow: đã cập nhật `ProductionAdapterAndPdfSignerCompleteTwoPartyContractThroughApiWithSyntheticRemoteCa` để dùng real renderer/adapter/PDF signer, actual PG/MinIO fixture và synthetic external provider. Test assert signed PDF contract ID/template/Unicode/hai signatures và Staff download forbidden. Thêm `ActualAdapterCannotContinueADevelopmentPdfInProductionAfterFirstPartySigns`: first party ký trong Testing; second party dùng cùng signed PDF với concrete Production renderer phải503, remote request count vẫn1, Contract chưa Active. **Hai real-persistence tests này chưa chạy do Docker**; build thành công không được dùng làm bằng chứng chúng pass.

Input validation, cryptographic integrity và state guards được xác minh độc lập trong renderer/composition/Contract UT; không gọi đó là authorized HTTP end-to-end. Không dùng fake auth/repository để báo real API integration Done.

Các lỗi renderer đi qua ContractException/ProblemDetails mapping hiện có:400 `invalid_contract_document` hoặc `contract_document_unsupported_character`;409 `signed_terms_changed`;503 `contract_template_not_configured`, `contract_template_not_found`, `contract_template_not_approved`, `contract_template_invalid` hoặc `contract_pdf_font_not_available`. Không trả snapshot/Terms/file path trong error hoặc logs mới.

## E. Remaining blockers và mức hoàn thành

| Mức                                                      | Kết luận                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code Complete trong phạm vi renderer Development/Testing | Đã implement và nối existing signing pipeline; không còn placeholder trên supported renderer path                                                  |
| Test Ready                                               | Có synthetic fixtures và repeatable tests/commands; relevant container-free checks pass                                                            |
| Integration Ready với real PG/MinIO/HTTP                 | Chưa xác nhận gate; code/tests đã có nhưng Docker runner thiếu                                                                                     |
| Fully Done BH-16/real provider                           | **Chưa**: cần approved production template, MySign sandbox và quy trình xác minh danh tính/chứng thư được duyệt, actual integration/peer review/CI |

Không tự phê duyệt template hoặc CA identity bằng self-signed certificate trong test. Bank/deposit/holding/settlement requirements ngoài phạm vi renderer vẫn theo audit và Contract lifecycle hiện tại; không bypass để demo Active.

## F. Next task

**BH-16: chạy và đóng gate real-persistence cho hai tests concrete renderer/actual adapter nêu trên trên runner PG16/MinIO cô lập.** Đây là một task verification nhỏ, có thể làm độc lập với frontend, OCR, ngân hàng và MySign thật vì external signer là synthetic boundary được ghi rõ. Output: TRX, PDF evidence tổng hợp, xác nhận Production incremental signing bị503 và không có duplicate request; chỉ sửa defect tái hiện thuộc scope này.

Commit message đề xuất sau review: `feat(contract): implement contract pdf renderer`. Chưa tạo commit/PR, chưa có peer review hoặc kết quả CI remote trong task này.
