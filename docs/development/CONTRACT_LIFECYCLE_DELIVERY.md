# D011 + D012 — Bàn giao backend Contract Activation và Lifecycle

Ngày kiểm chứng: 30/10/2026. Nhánh: `member/QHuy`. Không commit, push hoặc merge.

**Trạng thái tổng thể: Partial.** Có mã nghiệp vụ, persistence, phân quyền, migration và kiểm thử
qua HTTP với PostgreSQL 16/MinIO thật. Ký MySign/PDF thật và quyết toán tài chính thật chưa được
xác minh E2E. Adapter giả chỉ nằm trong project test; cấu hình backend mặc định không cho vượt
qua các điều kiện ký, cọc hoặc quyết toán còn thiếu.

## 1. Nguồn và truy vết

Đã đọc `AGENTS.md`, `docs/api/API_CONVENTIONS.md`, mã nguồn và test hiện có; đối chiếu trực tiếp:

- `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`: BF-03B;
  BF-04A; FE-03; UC-15, UC-16, UC-19; bảng quyền; GBR-01/02/04/05/18; DBR-02/03;
  phần Security Deposit, ContractResident và OQ-01/02/05.
- `docs/reports/Report-4_Software Design Specification (5).docx`: kiến trúc phân lớp,
  contract/signing/resident/deposit, PostgreSQL, lưu object key trong DB, MinIO và provider ngoài.
- `src/digital-signing/`: provider MySign, chuẩn bị/hoàn thiện PDF, lưu chứng thư,
  sandbox, dependency và các kiểm thử thực tế. Không dùng số test trong yêu cầu làm bằng chứng.

SRS có đặc tả UC-16 độc lập. Trong SRS, tiêu đề BF-04A còn ghi Holding Contract/Deposit nhưng
nội dung mô tả expiry/renewal/move-out; phần này được truy vết bằng UC-16/19 và nội dung luồng,
không tạo thêm một luồng Holding trùng lặp.

| Yêu cầu | Thực hiện | Tiêu chí chấp nhận / kiểm thử |
| --- | --- | --- |
| UC-15, GBR-01/02/05 | Draft từ Room, tài khoản Tenant có sẵn, Resident đã xác minh; chọn đại diện và co-occupants | Sai ngày, tiền lẻ/âm, Resident sai Room, sai vai trò hoặc Staff ngoài Location bị từ chối |
| UC-15/16, GBR-04, DBR-03 | Hai bên ký nối tiếp; snapshot, digest, provider reference, file riêng tư | Gửi yêu cầu không đồng nghĩa đã ký; thiếu một bên hoặc sai toàn vẹn bị chặn |
| UC-15, DBR-02, GBR-18 | Cọc, Owner activation, Room Occupied trong một transaction | T01–T07; kích hoạt song song chỉ một hợp đồng thắng; retry không cộng tiền/audit lần hai |
| UC-16/19 | Renewal tạo phiên bản mới, giữ nguyên bản đã ký; Owner kích hoạt hoặc hủy renewal đang chờ | T08–T09; ngày sai, chưa ký, renewal trùng bị chặn; bản cũ còn nguyên |
| UC-19, GBR-01/02 | Tenant yêu cầu, Owner phê duyệt; Staff inspection đúng Location | T10–T12, T16; gửi yêu cầu không đóng Contract/giải phóng Room |
| UC-19; OQ-01/02/05 | Lưu quyết định Owner và lịch sử append-only; adapter tài chính xác nhận nghĩa vụ | T13–T14; thiếu dữ liệu/hoàn tiền/thu tiền hoặc ledger đổi thì không giải phóng phòng |
| GBR-04/18; NFR bảo mật | Provider không sẵn sàng, retry, file riêng tư, cleanup intent | T15; không gửi lại yêu cầu ký có kết quả mơ hồ; upload lỗi không tạo signature trỏ tới file thiếu |

Không triển khai nhánh đang tranh chấp về công thức khấu trừ cọc, ngưỡng phê duyệt hoặc cách
tính phí hư hỏng. Không thay ký provider bằng OTP/chữ ký vẽ nội bộ.

## 2. Code changes

Các file mới chính:

| File / thư mục | Vai trò |
| --- | --- |
| `src/backend/BHome.Domain/TenantContracts/Contract.cs` | Contract, phiên bản renewal, occupants, signing attempt, xác minh cọc, move-out, inspection evidence, settlement review, idempotency, upload intent |
| `src/backend/BHome.Application/Contracts/ContractContracts.cs` | DTO, validation metadata, repository và các boundary provider/ledger/file |
| `src/backend/BHome.Application/Contracts/ContractService.cs` | Kiểm tra vai trò/phạm vi, điều kiện chuyển trạng thái, signing saga, activation, renewal và move-out |
| `src/backend/BHome.Infrastructure/Contracts/ContractRepository.cs` | EF queries, khóa Room, transaction, audit và đọc dữ liệu đã xác nhận |
| `src/backend/BHome.Infrastructure/Contracts/ViettelMySignContractAdapter.cs` | MySign/PDF adapter, runtime account source, các dependency chưa được cấu hình |
| `src/backend/BHome.Infrastructure/Contracts/ContractSigningCertificateStore.cs` | Tái sử dụng dịch vụ chứng thư của signing module với DbContext backend |
| `src/backend/BHome.Infrastructure/Contracts/ContractFiles.cs` | Upload intent bền vững, kiểm tra ảnh, dọn orphan |
| `src/backend/BHome.Infrastructure/Persistence/ContractConfiguration.cs` | Mapping, FK, precision, unique/check constraints |
| `src/backend/BHome.Api/Controllers/ContractsController.cs` | API Contract và Lifecycle |
| `src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs` | Danh mục chứng thư của chính Owner/Tenant |
| `src/digital-signing/BHome.DigitalSigning.MySign/` | Project chỉ biên dịch lại source MySign client hiện có, không tham chiếu iText |
| `tests/backend/BHome.Application.UnitTests/Contracts/ContractServiceTests.cs` | Unit test nghiệp vụ |
| `tests/backend/BHome.IntegrationTests/Contracts/ContractLifecycleApiTests.cs` | HTTP + PostgreSQL/MinIO; test adapter được đánh dấu rõ |
| `src/backend/BHome.Infrastructure/Persistence/Migrations/20261029170352_ContractActivationLifecycle.cs` và `.Designer.cs` | Migration mới |

Các phần có sửa:

- `PropertyRecords.cs`: thêm Room status. `MeterCapture.cs`, `CaptureContracts.cs`,
  `CaptureRepository.cs`, `CaptureConfiguration.cs`: đọc chốt `Final = 2`, gắn đúng Contract;
  giữ nguyên `Initial = 0`, `Periodic = 1` và request cũ không có ContractId.
- `BHomeDbContext.cs`, model snapshot, Infrastructure DI/project reference, hai solution;
  API exception handler và cache-control trong `Program.cs`.
- Signing module: tách `ISigningCertificateStore` khỏi `IDigitalSigningStore`, cập nhật DI và
  `SigningCertificateService`; giữ interface store cũ kế thừa interface mới. Tái sử dụng dịch vụ
  thay vì sao chép toàn bộ sandbox. Log lỗi MySign không còn in subscriber/credential/provider body.
- `PdfSignerTests.cs`: thêm test hai người ký trên các incremental revisions.

### Transaction, concurrency và history

Mỗi mutation Contract khóa `Rooms ... FOR UPDATE`, đọc lại dữ liệu và phạm vi, rồi commit
Contract/Room, allocation metadata, idempotency và audit cùng transaction. Renewal chuyển bản
cũ sang Superseded và flush trong transaction trước khi Active bản mới để tránh xung đột index.

DB có unique cho một Active Contract/Room, renewal còn hiệu lực/parent, bank transaction
reference, Holding Contract/allocation reference, signature chưa thất bại/signer, provider
transaction reference và idempotency `(ActorId, Operation, Key)`. Trigger bảo vệ snapshot đã
đưa đi ký, occupants, signing evidence đã xác minh, allocation ngân hàng và lịch sử quyết toán.

Idempotency-Key là GUID bắt buộc cho các mutation Contract có JSON, trừ `signing/sync`.
Ảnh binary không dùng key này. Cùng key/nội dung trả cùng resource/effect; dùng key với nội
dung khác trả 409. DTO trạng thái được chiếu từ trạng thái hiện tại, không lưu toàn bộ HTTP body.

Chữ ký đi qua Prepared → Dispatching → Pending → Signed/Failed. Ý định Prepared được commit
trước khi gọi MySign. Lỗi/mất phản hồi được giữ ManualReview hoặc Dispatching nếu process
dừng; retry không tự gửi lại. Signer có thể gắn provider reference qua recovery, sau đó vẫn
phải sync và kiểm tra chữ ký PDF. Failed attempt được giữ lại và có thể tạo attempt mới.
Không có webhook không xác thực; dùng polling qua API của chính signer.

Prepared/signed PDF và ảnh inspection nằm trong MinIO. DB lưu key/hash/metadata, không lưu
PDF hay private key. Upload intent được ghi bằng context độc lập trước external write;
cleanup kiểm tra lại reference dưới khóa Room, xóa orphan sau cửa sổ kỹ thuật một ngày.
Đây không phải chính sách giữ/xóa chứng cứ nghiệp vụ. Chứng cứ đã gắn được giữ nguyên.

## 3. API và ví dụ

Bearer token bắt buộc. Owner dùng quyền toàn hệ thống theo cấu hình hiện có; Staff phải có
assignment còn hiệu lực tại Location trên ngày Việt Nam; Tenant phải là TenantUserId của
Contract. Lookup ngoài phạm vi trả 404; sai vai trò tại route trả 403. Staff không ký thay,
không xác minh cọc và không quyết định tài chính. File không có public URL.

Prefix `C = /api/v1/contracts`, `S = /api/v1/digital-signing/certificates`.
Các ID trong ví dụ là placeholder; phải thay bằng UUID của dữ liệu được phép truy cập.
Tiền VND nhận chuỗi decimal hoặc số nguyên và trả **chuỗi decimal**, không có phần lẻ;
precision lưu trữ `numeric(18,0)`. Ngày là `YYYY-MM-DD`, instant là UTC.

| Method / route | Actor | Request ví dụ | Response / validation chính | Trạng thái |
| --- | --- | --- | --- | --- |
| POST `C` | Owner, Staff | D bên dưới | 201 `{id}`; Room khả dụng, Resident verified, đại diện hợp lệ, tài khoản signers đang hoạt động, ngày/tiền/terms hợp lệ | Done trực tiếp; Partial nếu dùng Holding |
| GET `C/{id}` | Owner, Staff đúng Location, Tenant của Contract | Không body | 200 ContractView: loại, trạng thái, terms, period, residents, signer/status, holding application; không trả object key/credential | Done |
| GET `C/{id}/activation-readiness` | Owner, Tenant của Contract | Không body | 200 R; blockers rõ ràng, không tự activate | Done |
| POST `C/{id}/deposit-verifications` | Owner | P | 200 `{id}` của verification; amount > 0, reference duy nhất; Owner xác minh sao kê, không có payment giả | Done — manual fallback |
| POST `C/{id}/signing` | Owner signer hoặc Tenant signer | `{"certificateId":"{certificateId}"}` | SignatureView; chứng thư thuộc chính actor, không khóa/hết hạn; 503 nếu capability thiếu | Partial — chờ PDF/template/config |
| POST `C/{id}/signing/sync` | Chính signer | Không body | 200 ContractView; chỉ Signed sau khi PDF verifier thành công; gọi lặp không nhân đôi | Partial — chờ ký thật |
| POST `C/{id}/signing/recover` | Chính signer | `{"providerReference":"{verified-provider-transaction-id}"}` | 200 ContractView; chỉ gắn lại attempt mơ hồ, vẫn Pending và phải sync | Done boundary; chưa xác minh provider thật |
| GET `C/{id}/document` | Owner, Tenant của Contract | Không body | 200 PDF riêng tư; 409 nếu chưa có bản ký | Done storage; chờ PDF thật |
| POST `C/{id}/activate` | Owner | Không body | 200 ContractView Active; đủ hai bằng chứng ký, cọc, residents, kỳ hiệu lực, không tranh chấp Room | Partial E2E — ký thật chưa sẵn sàng |
| POST `C/{id}/renewals` | Owner, Staff đúng Location | `{"endDate":"2027-12-31","monthlyRent":"4000000","terms":"Điều khoản gia hạn đã thống nhất"}` | 201 `{id}`; parent Active, expiry mới lớn hơn cũ, không renewal/move-out xung đột | Done chuẩn bị; Partial ký/kích hoạt thật |
| POST `C/{renewalId}/renewal-cancellation` | Owner | Không body | 200 Cancelled; chỉ renewal còn chờ, giữ parent và toàn bộ lịch sử | Done |
| POST `C/{id}/termination-requests` | Tenant của Contract | `{"proposedDate":"2026-11-30","reason":"Lý do trả phòng"}` | 200 M Requested; ngày không trong quá khứ, trước expiry; Contract vẫn Active | Done |
| POST `C/{id}/expiry-move-out` | Owner | `{"proposedDate":"2026-12-31","reason":"Không gia hạn khi hết hạn"}` | 200 M Requested; ngày từ expiry trở đi, không đóng phòng tự động | Done API; JOB-02 chưa tích hợp |
| GET `C/{id}/move-out` | Owner, Staff đúng Location, Tenant của Contract | Không body | 200 M, inspection notes, final reading IDs và các evidence ID được phép xem | Done |
| POST `C/{id}/move-out/approve` | Owner | Không body | 200 M Approved; không có nhánh Staff phê duyệt/Owner rejection tự tạo | Done |
| POST `C/{id}/move-out/schedule` | Owner, Staff đúng Location | `{"scheduledAt":"2026-11-30T03:00:00Z"}` | 200 M; move-out Approved, thời điểm UTC không trong quá khứ | Done |
| POST `C/{id}/move-out/evidence` | Staff đúng Location | Binary PNG/JPEG, Content-Type phù hợp | 200 `{id}`; tối đa 5 ảnh, mỗi ảnh ≤5 MiB; kiểm tra header/giải mã, key do server sinh | Done |
| GET `C/{id}/move-out/evidence/{evidenceId}` | Owner, Staff đúng Location, Tenant của Contract | Không body | 200 binary; trước khi gắn inspection chỉ uploader được đọc | Done |
| POST `C/{id}/move-out/inspection` | Staff đúng Location | I | 200 M Inspected; đã schedule, đến ngày trả phòng, final readings đúng Contract/Room/type/ngày, evidence thuộc uploader | Done; chưa có Asset/move-in baseline module |
| POST `C/{id}/move-out/settlement` | Owner | `{"decision":"Nội dung quyết định và căn cứ của Owner"}` | 200 M PendingSettlement hoặc Settled; ghi journal, chỉ Settled khi ledger xác minh đủ nghĩa vụ/cọc/chuyển tiền | Partial — ledger/policy còn thiếu |
| GET `C/{id}/move-out/settlement-history` | Owner, Tenant của Contract | Không body | 200 SettlementReviewView[] mới nhất trước, tối đa 100; Staff bị chặn | Done |
| POST `C/{id}/move-out/complete` | Owner | `{"actualEndDate":"2026-11-30"}` | 200 ContractView Terminated; đọc lại ledger/version, inspection/final readings đầy đủ; Room Available cùng transaction | Partial — ledger thật chưa có |
| GET `S` | Owner, Tenant | Không body | 200 CertificateView[] của chính actor; subscriber được che | Done |
| POST `S` | Owner, Tenant | `{"providerUserId":"{own-mysign-subscriber}","serialNumber":"{serial-or-null}"}` | 201 CertificateView sau khi hỏi MySign; 503 nếu chưa cấu hình, không tự tạo chứng thư | Partial — cấu hình MySign thật |
| POST `S/{certificateId}/lock` | Chủ chứng thư Owner/Tenant | `{"locked":true}` | 204; chứng thư người khác 404 | Done |

Ví dụ D — tạo Draft, header `Idempotency-Key: {new-guid}`:

```json
{
  "roomId": "{roomId}",
  "ownerSignerId": "{ownerUserId}",
  "tenantUserId": "{tenantUserId}",
  "representativeResidentId": "{residentId}",
  "residentIds": ["{residentId}", "{coOccupantId}"],
  "startDate": "2026-10-30",
  "endDate": "2027-10-29",
  "monthlyRent": "3000000",
  "requiredDeposit": "3000000",
  "terms": "Điều khoản thuê do các bên thống nhất",
  "holdingContractId": null
}
```

Ví dụ P — Owner xác minh chuyển khoản thực, không gửi mật khẩu/token/ảnh CCCD:

```json
{
  "bankTransactionReference": "{unique-bank-statement-transaction-reference}",
  "amount": "2000000",
  "verificationReason": "Đã đối chiếu giao dịch với sao kê ngân hàng của nghĩa vụ cọc"
}
```

Reference phải dùng định danh ổn định trên sao kê; API không suy đoán normalization hay hành vi
của một ngân hàng chưa được chọn. Khoản vượt cọc vẫn được giữ đầy đủ trong verification ledger;
không tự hoàn/chuyển Tenant Credit hay đưa vào doanh thu. Module Payment sau này phải dùng cùng
namespace định danh giao dịch và không phân bổ lại một giao dịch đã xác minh ở đây.

Ví dụ R và M — response readiness và move-out:

```json
{
  "ready": false,
  "verifiedDeposit": "1000000",
  "remainingDeposit": "2000000",
  "blockers": ["verified_signature_evidence_required", "security_deposit_insufficient"]
}
```

```json
{
  "id": "{moveOutId}",
  "status": "PendingSettlement",
  "proposedDate": "2026-11-30",
  "reason": "Lý do trả phòng",
  "inspectionScheduledAt": "2026-11-30T03:00:00Z",
  "pendingReason": "financial_ledger_and_deposit_policy",
  "inspectionNotes": "Hiện trạng phòng và tài sản đã kiểm tra",
  "inspectedAt": "2026-11-30T03:30:00Z",
  "electricityReadingId": "{electricityReadingId}",
  "waterReadingId": "{waterReadingId}",
  "evidenceIds": ["{evidenceId}"]
}
```

Đọc chốt dùng API hiện có `POST /api/v1/capture/meter-tasks` bởi Owner:

```json
{
  "meterId": "{meterId}",
  "purpose": 2,
  "readingDate": "2026-11-30",
  "billingPeriod": null,
  "contractId": "{activeContractWithApprovedMoveOutId}"
}
```

Sau đó Staff upload/confirm qua `/capture/meter-tasks/{taskId}/evidence` và `/confirm` như trước.
Cần baseline, số đo không giảm, human confirmation, meter đang hoạt động và evidence hợp lệ.
Final được phép cùng ngày một reading Initial/Periodic trước đó; vẫn không dùng reading của
Contract khác. Một task Final còn hiệu lực cho mỗi Meter/Contract được bảo vệ bằng index.

Ví dụ I — ghi inspection sau khi có hai reading confirmed và ảnh:

```json
{
  "electricityReadingId": "{electricityReadingId}",
  "waterReadingId": "{waterReadingId}",
  "notes": "Hiện trạng phòng, tài sản, chìa khóa và các vấn đề phát hiện",
  "evidenceIds": ["{evidenceId}"]
}
```

Đọc Contract/status trả ContractView với các trường `id`, `roomId`, `kind`, `status`, `startDate`,
`endDate`, `monthlyRent`, `requiredDeposit`, `terms`, `previousContractId`, `residentIds`,
`signatures`, `activatedAt`, `ownerSignerId`, `tenantUserId`, `representativeResidentId`,
`holdingContractId`, `appliedHoldingDeposit`. SignatureView ví dụ:
`{"id":"{attemptId}","signerUserId":"{userId}","status":"Pending","signedAt":null}`.
`signedAt` là thời điểm BHOME nhận và xác minh kết quả ký, không phải timestamp độc lập được CA chứng thực.

Lỗi dùng ProblemDetails hiện có: 400 validation, 401 chưa xác thực, 403 sai role, 404 ngoài phạm
vi/không tồn tại, 409 state/concurrency/idempotency conflict, 413 ảnh quá lớn, 503 capability
chưa cấu hình/provider unavailable. Không trả stack trace hoặc provider body.

## 4. MySign, license và cấu hình

Backend đã nối với `ViettelMySignContractAdapter` và project mới `BHome.DigitalSigning.MySign`.
Project mới link ba file provider/messages/text hiện có, tái sử dụng async signHash, status
polling, token cache và client qua HTTPS. Không tham chiếu `BHome.DigitalSigning.Infrastructure`.
Dịch vụ quản lý chứng thư cũ được tái sử dụng qua interface nhỏ, không mang transaction store
chứa PDF binary của sandbox vào backend.

Phần phụ thuộc iText nằm trong signing Infrastructure: `ITextPdfSigner`, render appearance,
CMS/PAdES assembly/verification và các test PDF/sandbox. Dependency kiểm tra trong repo là
`itext` và `itext.bouncy-castle-adapter` 9.6.0. Chưa có bằng chứng phương án license của dự án
được phê duyệt; không kết luận pháp lý hay tự chọn thư viện thay thế. Backend package graph
đã kiểm tra không có iText/BouncyCastle từ signing Infrastructure.

Để ký thật cần đồng thời:

1. Quyết định license/implementation PDF được phê duyệt. Đăng ký `IPdfSigner` đáp ứng Prepare /
   Complete, incremental signing, xác minh chữ ký CMS và byte range; default là unavailable.
2. Template hợp đồng được phê duyệt qua `IContractDocumentRenderer`, dựng từ snapshot và dữ
   liệu server authoritative; default là unavailable. Không nhận PDF tùy ý từ người gọi để
   thay nội dung đã ký. Repo backend trước nhiệm vụ chưa có generator/template này.
3. Cấu hình `DigitalSigning__Viettel__BaseUrl` (HTTPS), `ClientId`, `ClientSecret`, `ProfileId`
   nếu provider yêu cầu; có thể đặt LoginPath, CredentialsPath, SignHashPath, StatusPath,
   TimeoutSeconds (1–120). Dùng environment/user-secrets, không ghi credentials vào repo.
4. Mỗi Owner/Tenant khai báo chứng thư của chính mình qua API; dữ liệu được đối chiếu với
   MySign. Không tạo certificate/private key tại BHOME.
5. MinIO riêng tư và cấu hình Database hiện có; không thay cơ chế xác thực JWT hiện hành.

Không có flag cấu hình bật mock trên production. Test PDF hai signer dùng CA tổng hợp trong
test sandbox, không phải chứng thư thật. Ký hash thành công chưa đủ: adapter chỉ chấp nhận
Signed sau `IPdfSigner.Complete` xác minh PDF. Sandbox vẫn độc lập và build/test được.

## 5. Dependency còn thiếu và giới hạn cụ thể

| Dependency / quyết định | Hành vi hiện tại | Tác động |
| --- | --- | --- |
| BF-03A Holding Contract/Payment chưa có | `IContractHoldingLedger` mặc định 503. Adapter tương lai phải xác minh Holding Active/đủ ký/chưa hết hạn/đúng Room và Tenant, phân bổ/convert cùng DbContext transaction. Kết quả lưu có unique keys | Holding → Main chưa chạy với dữ liệu thật; positive allocation được test qua adapter test |
| Pricing/rates/fees module chưa có | Draft ghi rent/deposit/terms và cần Owner ký; không giả định đã tra được effective rate/fee policy | Chưa xác minh tích hợp giá/phí có hiệu lực |
| Tenant account onboarding chưa có trong Contract slice | Chỉ link tài khoản Tenant đang hoạt động đã tồn tại | Không tự tạo credential hoặc gửi mật khẩu cho Tenant |
| Invoice/Payment/refund/deposit-settlement module chưa có | `IContractSettlementLedger` mặc định trả chưa sẵn sàng; Owner decision giữ PendingSettlement | Không tạo final invoice giả, không tính/khấu trừ/hoàn tiền giả, không đóng hợp đồng thật khi chưa có ledger |
| OQ-01/02/05 còn mở | Lưu từng lần review append-only và căn cứ; không hardcode công thức, ưu tiên phân bổ, ngưỡng hoặc hạn hoàn tiền | Team cần chốt cách xử lý nợ/hư hỏng/cọc, loại charge/adjustment, số tiền và bằng chứng chuyển khoản/refund |
| Tích hợp ledger tương lai | Phải đối chiếu các reading đúng Contract, toàn bộ phiên bản tenancy/deposit, hóa đơn/nghĩa vụ và transfer đã verified; đọc/khóa nhất quán cùng transaction, trả reference/version ≤200 ký tự | Kết quả thay đổi sau approval chặn completion; Owner có thể review lại, lịch sử cũ được giữ |
| Asset / move-in handover chưa có | Inspection giữ notes/ảnh và confirmed final readings; không sửa Resident identity hoặc baseline reading | Chưa so sánh tự động tài sản với biên bản ban đầu hoặc cập nhật Asset entity |
| JOB-02 và persistent in-app notification chưa có handler nghiệp vụ tương ứng | Có API Owner khởi tạo expiry move-out; không đánh dấu đã gửi notification | Chưa có daily expiry reminder hoặc notification E2E |
| Addendum không kéo dài kỳ thuê | Hiện hỗ trợ renewal phiên bản mới; chưa có policy cho các loại addendum khác | Không tự cho sửa PDF/các điều khoản đã ký |
| UI | Chỉ backend và integration tests | Chưa có màn hình Contract lifecycle; client cần hỗ trợ mục đích meter Final mới |

Contract cũ giữ nguyên end date/terms; renewal bắt đầu ngày kế tiếp và chỉ kích hoạt trong kỳ
hiệu lực. Main Contract chưa hết nghĩa vụ tiếp tục giữ Room Occupied ngay cả khi đã qua expiry.
Move-out completion hiện yêu cầu actualEndDate bằng ngày inspection, không trong tương lai;
chưa có quy trình sửa/backdate biên bản. Đây là giới hạn API hiện tại cần kiểm tra khi tích hợp UI.

Không truy cập hoặc thay đổi DB dữ liệu thật. Schema PostgreSQL đã kiểm chứng là DB test cô lập.
Không tuyên bố tương thích schema triển khai hiện có nếu chưa kiểm tra.

## 6. Migration và triển khai

Migration duy nhất mới: `20261029170352_ContractActivationLifecycle`.
Up thêm các bảng Contract, Room.Status và OperationalTask.ContractId, constraints/index/trigger;
giữ các bảng/dữ liệu cũ. Đã áp dụng trên PostgreSQL 16 test và chạy regression migration hiện có.

Sau khi review, cấu hình connection bằng cơ chế secret hiện có rồi dùng quy trình triển khai
EF của dự án, ví dụ:

```powershell
dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure
```

Lệnh này **chưa chạy trên DB của người dùng**. Kiểm tra clone/backup/schema trước rollout.
Nếu trước đó đã chạy SQL standalone signing trên cùng DB và có bảng `SigningCertificates`,
cần kế hoạch baseline/adopt schema được review; không chạy mù migration tạo lại bảng, không
xóa bảng hay dữ liệu sandbox để né lỗi. Down chỉ phục vụ rollback môi trường chưa có dữ liệu
nghiệp vụ; không downgrade DB đã nhận Contract/evidence nếu chưa có kế hoạch bảo toàn dữ liệu.

## 7. Verification

Kết quả cuối đã được xác nhận sau thay đổi cuối. Test dùng dữ liệu tổng hợp,
PostgreSQL 16 và MinIO qua Testcontainers; không reset DB người dùng.

| Lệnh | Kết quả |
| --- | --- |
| `dotnet build src/backend/BHome.sln` | PASS, 0 warnings / 0 errors |
| `dotnet test src/backend/BHome.sln --no-build` | PASS: Domain UT 38, Application UT 88, IT 183; tổng 309, fail 0, skip 0 |
| `dotnet build src/digital-signing/BHome.DigitalSigning.sln` | PASS, 0 warnings / 0 errors |
| `dotnet test src/digital-signing/BHome.DigitalSigning.sln --no-build` | PASS: 41, fail 0, skip 0 |
| `dotnet format whitespace src/backend/BHome.sln --no-restore --include <các file Contract mới>` | PASS |
| `dotnet ef migrations has-pending-model-changes --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure` | PASS; không có model change thiếu migration |
| `git diff --check` | PASS |
| `dotnet list src/backend/BHome.Api/BHome.Api.csproj package --include-transitive` | Không có iText/BouncyCastle |

Đã có 21 unit case Contract và 15 integration case Contract, bao phủ T01–T16 với giới hạn:
ký/PDF và financial/holding boundaries thành công dùng adapter test; persistence, HTTP,
authorization, transaction, concurrency, private storage và orphan cleanup dùng hạ tầng thật.
Test CA/PAdES thật trong signing test xác minh hai signature cryptographic độc lập trên cùng
PDF, nhưng CA là tổng hợp. Actual MySign adapter được kiểm tra nhánh sai chủ thể và provider
chưa cấu hình. Không coi đây là chữ ký MySign thật hay settlement thật.

Các lỗi ở lượt trung gian đã được sửa: validation metadata đặt nhầm trên property của record
gây HTTP 500; host test phụ dùng signing key JWT khác gây 401. Sau sửa đã chạy lại các test
liên quan; lượt cuối chạy lại toàn bộ backend đạt 126 UT + 183 IT. Signing suite đạt 41/41.

NOT RUN: MySign thật, ký PDF bằng chứng thư thật, đối soát ngân hàng thật, final invoice/refund
thật, UI E2E, load/performance/coverage measurement và rollout trên DB đang dùng. Không có
bằng chứng đạt production-ready hoặc toàn bộ BF-03/BF-04.

Artifacts TRX cục bộ nằm tại `.tools/contract-test-results/` (đã được gitignore), không chứa
tài khoản thật và không được commit.
