# D011/D012 — Ổn định và kiểm chứng tích hợp

> Cập nhật kết nối iPhone/TLS và nâng cấp DB legacy: [IPHONE_CONNECTIVITY.md](IPHONE_CONNECTIVITY.md).
> Runner browser hiện xác minh TLS đầy đủ và cần chạy tương tác với
> `--allow-temporary-test-root`; phải xác nhận thêm/gỡ CA test trong Windows.
> Các kết quả bên dưới là bằng chứng lịch sử trước thay đổi này.

Ngày: 30/10/2026. Nhánh `member/QHuy`; baseline `27f3702`. Không commit/push/merge.
Working tree sạch trước khi bắt đầu. Bàn giao này bổ sung, không thay bằng chứng lịch sử ở
`CONTRACT_LIFECYCLE_DELIVERY.md` và `CONTRACT_LIFECYCLE_UI.md`.

Nguồn đã đối chiếu: AGENTS.md, API_CONVENTIONS.md, hai bàn giao Contract;
`BHome_Report-3_Software Requirement Specification (2).docx` (UC-15/16/19, GBR-01/02/04/18,
DBR-02/03, OQ-01/02/05); `Report-4_Software Design Specification (5).docx`
(Controller/Service/persistence, PostgreSQL, private storage, provider ký ngoài).

## Truy vết và kế hoạch theo thứ tự

| Yêu cầu                                | Phạm vi mã / dữ liệu                                                   | Tiêu chí kiểm chứng                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| BF-01/UC-04..07, GBR-01/02/08, NFR API | ApiExceptionHandler, PropertyService, repository, Property/Chain IT    | Không đổi quyền/validation/transaction; 400/403/404/409 đúng với service error, lỗi ngoài dự kiến vẫn 500; response/log không lộ PII/stack |
| BF-03B/BF-04A, UC-15/16/19, DBR-02/03  | DbContext/migrations/snapshot; Contract FK/index/triggers              | Dựng model snapshot và so với model runtime; migrate DB test trống và legacy test; không đổi production                                    |
| FE-03, GBR-04/18                       | ContractService, signing, deposits, renewal/move-out, private evidence | Hồi quy hai bên ký, key replay, concurrent activation, rollback, phân quyền và bảo toàn phiên bản/lịch sử                                  |
| UC-15/16/19 và NFR client              | Owner Web, Mobile transports và API chạy thật                          | Dữ liệu tổng hợp trong DB test; HTTP thật, không thay provider/ledger thành adapter thành công để kết luận E2E; ghi rõ bước bị chặn        |
| GBR-04; OQ-01/02/05                    | MySign/PDF, Holding/Settlement boundaries                              | Không tự chọn license/template, khấu trừ/hoàn tiền hoặc tạo chứng thư; thiếu quyết định/capability phải fail closed                        |

1. Tái hiện lỗi, sửa ánh xạ exception, chạy lại toàn bộ Property/Chain và error-contract regression.
2. Kiểm chứng snapshot/migrations hiện tại (baseline đã có merge sửa EF); chỉ sửa sai lệch còn tồn tại.
3. Chạy toàn bộ backend UT/IT, không skip/delete test; kết quả mới tách với lịch sử bàn giao.
4. Chạy API thật trên hạ tầng test và kết nối client thật ở các bước khả dụng; xác định giới hạn E2E.
5. Rà soát quyền, retry/idempotency, transactions và các integration boundary; thêm regression cần thiết.
6. Cập nhật kết quả thực chạy, file thay đổi và đánh giá DoD.

## Baseline

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~PropertyApiTests|FullyQualifiedName~SingleChainTests'`:
29 total, 14 PASS, 15 FAIL, 0 skip. Gốc lỗi: PropertyException được service/repository ném đúng
nhưng handler không có case status/code, rơi vào HTTP 500. Chưa sửa test kỳ vọng để né lỗi.

Các kết quả bên dưới là lệnh thực chạy trong lượt này; không kế thừa số PASS cũ.

Rà soát sau bước 1: Property/Chain + API error contract đạt 44/44. Snapshot/migration hiện tại
đã được sửa tại commit `f0682fb` trước lượt này; EF báo không có model pending, schema regression
6/6 trên DB disposable. Không sửa lại snapshot đã đúng hoặc tạo migration rỗng.

Lượt toàn backend đầu: Domain 56 PASS, Application 161 PASS; IT 257 PASS / 1 FAIL.
Lỗi mới phát hiện là race phân công Location, không phải Contract regression. Đã tăng test
race từ một cặp lên 10 cặp với các khoảng ngày độc lập và diagnostic filter chỉ đọc loại lỗi/SQLSTATE,
không sửa response. Tái hiện: `201,500`, exception chain `InvalidOperationException →
DbUpdateException → 40P01`. Nguyên nhân là PostgreSQL GiST exclusion-check deadlock khi hai
assignment cùng Location được insert đồng thời. Sửa bằng transaction và advisory lock cùng key/
thứ tự với Property repository, kiểm tra lại eligibility/overlap dưới lock; giữ nguyên exclusion
constraint và nguyên tắc một Staff/Location/ngày đã phê duyệt tại STAFF_LOCATION_ASSIGNMENTS.md.

## Lỗi phát hiện thêm từ API thật

Owner/Mobile gửi `Accept: application/pdf` khi tải hợp đồng. Khi chưa có chữ ký, service ném
`signed_document_not_available` (409), nhưng `IProblemDetailsService.WriteAsync` không tìm được
writer cho media type đó và ném exception khác, dẫn đến 500. Đây là lỗi thực tế; test HTTP cũ
gửi Accept mặc định nên không phát hiện.

Handler hiện dùng `TryWriteAsync`; nếu không có writer phù hợp, ghi ProblemDetails JSON an toàn
với status/code/correlation đã xác định, không trả stack/message của exception. Bổ sung 5 case
với PDF/octet-stream/image, gồm lỗi dự kiến 400/403/404/409 và lỗi ngoài dự kiến vẫn 500.
Không biến lỗi thành success hoặc nới validation/quyền.

## Kiểm chứng cuối

`dotnet build src/backend/BHome.sln --no-restore -m:1`: PASS, 0 warning/error.

| Lệnh / phạm vi                                                                                                                                                         | Kết quả thực tế                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `dotnet test src/backend/BHome.sln --no-restore --logger trx --results-directory .tools/contract-stabilization/backend-release-check`                                  | PASS 480/480: Domain 56, Application 161, IT 263; fail 0, skip 0                                              |
| Contract Lifecycle trong IT                                                                                                                                            | PASS 17/17, không đổi kỳ vọng hoặc bỏ test                                                                    |
| PropertyApiTests + SingleChainTests + LocationAssignmentApiTests                                                                                                       | PASS 34/34; 15 lỗi ban đầu đã hết; race chạy 10 cặp độc lập                                                   |
| `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~PostgresFoundationTests\|FullyQualifiedName~MigrationPreservesLegacyRoom'` | PASS 6/6: snapshot/runtime, FK/index PostgreSQL và nâng/hạ/lặp migration giữ Room status                      |
| `dotnet ef migrations has-pending-model-changes --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure --no-build`              | PASS, không có model change; dùng connection giả tới cổng 1, không kết nối DB thật                            |
| `dotnet test src/digital-signing/BHome.DigitalSigning.sln --no-restore --logger trx --results-directory .tools/contract-stabilization/signing`                         | PASS 41/41; CA/provider tổng hợp trong suite, không MySign thật                                               |
| `npm run test --workspace src/owner-web`                                                                                                                               | PASS 53/53; unit/component suite, không gọi đây là E2E thật                                                   |
| `npm run test --workspace src/mobile`                                                                                                                                  | PASS 102/102; unit/client suite                                                                               |
| `dotnet build tools/BHome.ContractVerification/BHome.ContractVerification.csproj --no-restore -m:1`                                                                    | PASS, 0 warning/error; build API và dependencies của runner                                                   |
| `dotnet run --project tools/BHome.ContractVerification --no-build`                                                                                                     | PASS 16 nhóm kiểm tra client qua API HTTPS thật + DB postconditions; **0 full flow hoàn tất**, 3 flow bị chặn |
| ESLint/Prettier script và docs, C# whitespace các file sửa, `git diff --check`                                                                                         | PASS                                                                                                          |

Lượt build runner đầu có cảnh báo cache MSBuild đang được dùng; build tuần tự `-m:1` sau đó
đạt 0 warning/error. Lượt harness đầu thiếu content root khi dùng fixture từ console; đã chỉ định
content root bằng cơ chế WebApplicationFactory, không thay API. Kiểm tra cookie ban đầu dùng URL
`/` nên không thấy cookie có path `/api/v1/auth`; đã sửa URL kiểm tra đúng path. Lượt live tiếp theo
phát hiện lỗi negotiation 409→500 như trên; giữ nguyên kỳ vọng 409 và sửa handler.

## Tích hợp thật: đã chạy những gì

Runner tạo PostgreSQL 16/MinIO disposable bằng `CaptureFixture` (không dùng `ContractFixture`
thay signing/ledger), sau đó chạy **API DLL thật bằng Kestrel HTTPS**. Chỉ dùng DI production,
xác nhận adapter MySign/Holding/Settlement đúng kiểu thật hiện có; không ghi đè thành adapter
trả thành công. Tài khoản được tạo tổng hợp trong DB container; Location/Room, assignment,
Resident và xác nhận identity tổng hợp đi qua HTTP. Không seed Contract Active/Signed để vượt
qua blocker. CA/PFX chỉ phục vụ **TLS localhost thử nghiệm**, không phải chứng thư ký hợp đồng.

Node dùng CA công khai trong `NODE_EXTRA_CA_CERTS`, không tắt kiểm chứng TLS toàn cục. Edge dùng
certificate thử nghiệm, Owner web được phục vụ HTTPS để kiểm tra đúng cookie Secure/HttpOnly/
SameSite=Strict. Vite dùng envDir tạm và API URL do runner cấp; không đọc/sửa `.env` người dùng.
Process API chỉ nhận cấu hình DB/object storage/identity tổng hợp và các biến OS cần thiết;
không kế thừa credential MySign/production. PFX/password chỉ truyền qua file tạm/env/stdin của
process thử nghiệm, không ghi vào report; file tạm/process/container được dọn sau chạy.

16 nhóm kiểm tra gồm:

- Đăng nhập thực và chuẩn bị Location/Room/assignment/Resident; kiểm tra API chạy thật không có
  route test-probes của TestServer.
- Owner web đăng nhập, kiểm tra thuộc tính cookie, chọn Room/Resident/đại diện và tạo Main draft.
- Owner ghi nhận xác minh cọc thủ công bằng reference tổng hợp qua UI. Đây là kiểm tra API/manual
  fallback; **không phải giao dịch ngân hàng thật đã đối soát**.
- Readiness từ server vẫn chặn activation khi thiếu signature evidence; lỗi khai báo chứng thư
  trả 503, không tạo certificate/signature giả. PDF chưa ký trả 409, ngoài Tenant scope trả 404,
  Staff không được tải PDF (403).
- Staff dùng **MobileApi và contractClient thật** tạo draft, replay cùng key/payload cùng ID;
  payload khác cùng key trả 409, thiếu key trả 400.
- Tenant chỉ đọc/list tenancy của mình; Tenant khác/Staff chưa phân công thấy trang rỗng/404;
  anonymous 401. Staff không ký, xác minh cọc, kích hoạt, xem readiness/tài chính, quyết toán hoặc đóng.
- Replay xác minh cọc/reference không double-credit; từ chối activation/renewal/termination/inspection/
  settlement/closure khi không đủ precondition; Holding adapter 503 rollback draft mới.
- Offline/recovery trên Owner web và AbortError/refresh token thật trên Mobile transport; đọc lại
  trạng thái từ server. Không mock response và không tự retry mutation mơ hồ.

DB postconditions kiểm tra còn đúng hai Main draft/pending-signing, không renewal/move-out,
không certificate/signature/Active/Occupied; chỉ một DepositVerification 3.000.000 VND và một audit
ContractDepositVerified. Không đóng hợp đồng hoặc giải phóng một phòng đang thuê trong kịch bản này.

**Mobile UI/native không được chạy trên iPhone/Android**: phần live Mobile là transport/service
thật trên Node gọi backend HTTPS, không giả nhận đã kiểm tra camera, Keychain hoặc hộp chia sẻ
native. MinIO container chạy thật nhưng upload/download evidence của lifecycle đầy đủ chưa tới được
vì signing/activation đang bị chặn.

## Rà soát provider/policy và blocker

| Thành phần / luồng                                                              | Hiện trạng xác minh                                                                                                            | Phần còn thiếu / quyết định cần có                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main draft → signing → evidence → deposit → activation                          | Draft/deposit/readiness và nhánh lỗi chạy HTTP thật; MySign declare 503; invalid certificate không sinh evidence               | Template hợp đồng được duyệt; lựa chọn/license PDF signer/verifier được duyệt; cấu hình và chứng thư MySign test hợp lệ, xác minh hai bên ký thật. Chưa xác minh account↔subscriber binding/evidence với MySign thật |
| Renewal → version → signing → activation                                        | IT positive có PostgreSQL thật nhưng provider test; live API từ chối renewal trên parent chưa Active                           | Cần Main Active hợp lệ từ signing thật và chu kỳ hiệu lực; không seed giả parent Active để tuyên bố E2E                                                                                                              |
| Termination → inspection → final readings → settlement → closure → room release | State machine, rollback, scope, final readings và ledger-version revalidation có IT; live các nhánh thiếu precondition bị chặn | Parent Active hợp lệ; tích hợp final invoice/payment/refund/deposit ledger thực; OQ-01/02/05 (khấu trừ, loại charge/adjustment, căn cứ/luồng xử lý nghĩa vụ) chưa được chốt                                          |
| Holding Deposit → Main                                                          | Production `UnconfiguredContractHoldingLedger` trả 503; live xác minh rollback                                                 | Module Holding/verified funds/allocation chưa có; cần triển khai theo BF-03A, phân bổ cùng transaction, không tự credit                                                                                              |
| PDF signer / license                                                            | Backend vẫn dùng `UnconfiguredContractPdfSigner` và renderer unavailable                                                       | README signing module có nhắc iText; đây không phải bằng chứng dự án đã phê duyệt license/template. Không tự gắn iText hoặc thay provider bằng OTP/ký vẽ                                                             |
| Settlement Ledger                                                               | Production `PendingContractSettlementLedger` trả null, service giữ PendingSettlement                                           | Chưa có invoice/payment/refund ledger thực để xác nhận nghĩa vụ/cọc/transfers và DecisionReference. Không suy ra đã settled chỉ từ quyết định Owner                                                                  |

Không thay chính sách cọc, phí, deadline, quyền hoặc signing provider. Không mở rộng addendum
ngoài renewal. Account onboarding/notification, baseline bàn giao và tích hợp giá/phí tự động
giữ các giới hạn đã ghi trong bàn giao; module Property/rates hiện đã có nhưng không được coi
là bằng chứng Contract đã tích hợp hết các rate/fee policies.

## File thay đổi và lý do

| File                                                                        | Lý do                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/backend/BHome.Api/Middleware/ApiExceptionHandler.cs`                   | Map PropertyException status/code; fallback ProblemDetails cho binary Accept; giữ error sanitization     |
| `src/backend/BHome.Infrastructure/Locations/PostgresLocationAssignments.cs` | Transaction/Location advisory lock trước validation/overlap/save, tránh deadlock race                    |
| `tests/backend/BHome.IntegrationTests/ApiFoundationTests.cs`                | 4 case status/code/correlation và 5 case binary Accept                                                   |
| `tests/backend/BHome.IntegrationTests/TestProbeController.cs`               | Route chỉ có trong test host để phát PropertyException; không thêm route production                      |
| `tests/backend/BHome.IntegrationTests/LocationAssignmentApiTests.cs`        | 10 cặp race, diagnostic chỉ loại lỗi/SQLSTATE; giữ đúng một 201/một 409                                  |
| `tests/backend/BHome.IntegrationTests/PostgresFoundationTests.cs`           | Regression mapping snapshot/runtime, required/restrict FK, composite PK, index và model parity           |
| `tools/BHome.ContractVerification/BHome.ContractVerification.csproj`        | Runner độc lập, tái dùng fixture PostgreSQL/MinIO của test, không thêm dependency vào API                |
| `tools/BHome.ContractVerification/ContractVerificationCli.cs`               | Hạ tầng disposable, tài khoản tổng hợp, Kestrel/TLS thật, isolated config, DB assertions và cleanup      |
| `scripts/Verify-ContractClients.cjs`                                        | Owner browser + Mobile transports dùng network thật, không route.fulfill, ghi evidence/checks và blocker |
| `docs/api/API_CONVENTIONS.md`                                               | Bổ sung error contract Property và media-type fallback                                                   |
| `docs/development/STAFF_LOCATION_ASSIGNMENTS.md`                            | Ghi concurrency/transaction behavior theo cùng quy tắc assignment đã duyệt                               |
| `docs/development/CONTRACT_LIFECYCLE_DELIVERY.md`                           | Liên kết bản kiểm chứng mới, giữ kết quả lịch sử                                                         |
| `docs/development/CONTRACT_LIFECYCLE_UI.md`                                 | Phân biệt blocker/số test lịch sử với trạng thái mới                                                     |
| `docs/development/CONTRACT_STABILIZATION.md`                                | Truy vết, nguyên nhân, kết quả thực chạy, giới hạn và DoD                                                |

Không sửa snapshot/migration vì baseline đã đúng; không tạo migration mới. Không sửa `.env`,
secret, database thật hoặc framework version. Không commit, push, merge hay publish.

## Chạy lại live verification

Yêu cầu: .NET 8, Docker, Node 22, dependencies npm của repo, image MinIO test đang dùng trong
CaptureFixture, Microsoft Edge và Playwright local. Playwright là tool kiểm thử cục bộ; nếu chưa
có, cài bằng `npm install --prefix .tools/contract-browser --no-package-lock --no-save playwright`.
Runner không đưa browser dependency vào backend CI suite và không thay lệnh toàn bộ backend test.

```powershell
dotnet build tools/BHome.ContractVerification/BHome.ContractVerification.csproj -m:1
dotnet run --project tools/BHome.ContractVerification --no-build
```

Chạy tại root repo, không truyền connection string/provider secret. Runner chỉ sử dụng container
do chính nó tạo. Kết quả local gitignored: `.tools/contract-stabilization/backend-release-check/`,
`schema.trx`, `binary-errors-contracts.trx`, `signing/`, `live/results.json` và
`live/owner-real-api-blocked.png`. Screenshot chỉ chứa dữ liệu tổng hợp; không lưu trace có password/token.

## Đánh giá Definition of Done

**D011/D012 chưa đạt DoD đầy đủ theo các luồng thật yêu cầu.** Các lỗi handler, concurrency và
kiểm chứng snapshot/schema đã hoàn tất; toàn backend và regression client đạt, Contract tests
không regression. Tuy nhiên **0/3 luồng đầy đủ đã hoàn tất với provider/ledger thật**. Các positive
lifecycle test có adapter test chỉ là bằng chứng logic/tích hợp nội bộ; không được dùng để thay
cho signing/settlement E2E thật. Chưa xác minh native Mobile UI, performance/coverage hoặc rollout.

Để đóng DoD cần quyết định và integration còn thiếu ở bảng blocker, chạy lại cả ba luồng bằng
tài khoản/chứng thư và giao dịch test được phép, kiểm chứng evidence/ledger/room release trên
hạ tầng test, cùng review/CI theo quy trình repo. Không tự suy diễn approval để làm xanh E2E.
