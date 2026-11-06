# Triển khai và kiểm chứng các nhiệm vụ Nguyễn Quốc Huy

## Tiếp tục sau merge af97676 ngày 05/11/2026

Working tree đầu lượt tiếp tục sạch trên member/QHuy. Đã xác minh các commit triển khai trước; merge mới chứa thay đổi Location của nhóm, không khôi phục phiên bản trước merge. Truy vết slice đầu: UC-15 / GBR-04 / DBR-03 yêu cầu tài liệu ký và evidence đúng phiên bản, private download có quyền và kiểm tra integrity → ContractService.CopyDocumentAsync + storage → kiểm thử Owner/Tenant đọc đúng, Staff/cross-Tenant bị chặn, bytes bị sửa trả 409 và không sửa trạng thái ký. Không đổi route/DTO/schema.

TASK BE-15 / BE-X06 — SLICE integrity tài liệu đã ký: đã kiểm tra snapshot/hash và đọc vào buffer trước khi trả nội dung; chỉ chấp nhận Signed/Simulated đúng chế độ hợp đồng. Backend thay ContractService.CopyDocumentAsync; không sửa UI/Mobile vì giữ nguyên endpoint/error contract. `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~SignedDocumentDownloadRejects|FullyQualifiedName~SignedDocumentIntegrity' --verbosity minimal`: **2/2 đạt**, legacy+MinIO và Compact24. Fixture signing là test boundary được gắn nhãn, không phải MySign staging. STATUS DONE cho slice; BE-15/BE-X06 vẫn PARTIAL. Handoff Vũ Xuân Trường/Bùi Bảo Long, lỗi 409 được client hiện hữu xử lý. Commit `133863548bb42dfd514bb070ee7cc07bd78e9208`.

### Slice BE-15 / BE-X06 — phát hành Main Draft đã xem xét

Truy vết: UC-15 / GBR-01/02/04 / DBR-02/03 → MainDraftService, MainDraftRenderer, ContractSigningDocumentSource, hai signing adapters, MainDraftReleasePanel/shared client → test stale version/configuration/file, integrity, Owner-only, cross-Tenant, replay/parallel release và chuỗi review → signing simulation → verified deposit → activation.

Khoảng trống đã sửa: Main Draft trước đây không có bước chuyển sang lifecycle ký; snapshot bản nháp khác seal của Contract. Owner Web nay tải đúng PDF của phiên bản đã lưu, chọn Tenant đại diện, xác nhận xem xét rồi release. Backend kiểm lại mọi điều kiện, giữ encrypted metadata, ghi canonical Preview nguyên bytes/hash và liên kết Tenant trong transaction. Adapter dùng đúng nguồn đã xem xét; không dựng lại mẫu khác. Chế độ signing ghi ngay khi tạo Draft và không đổi sau đó. Không thêm bảng/cột nghiệp vụ.

Mẫu DOCX hiện tại chưa được duyệt production: review PDF mang nhãn thử nghiệm và chỉ Development/Testing; Production trả 503. MySign staging vẫn BLOCKED. Integration simulation không phải chữ ký số hợp pháp. MinIO thực trong Docker và LibreOffice thực được dùng ở regression legacy; Compact24 dùng storage boundary test. Không truy cập database làm việc `bhome`.

Owner Web: 16/16 component tests (MainDraftReleasePanel, MainDraftSettingsPanel, Contracts) đạt; build và lint đạt. Kiểm tra chọn file/version, human confirmation, chống double submit, retry giữ idempotency key, unsaved changes, lỗi template không báo thành công. Mobile chưa sửa; released Contract đi qua preview/signing hiện hữu, cần kiểm thử bổ sung và browser acceptance sau commit. Handoff Vũ Xuân Trường/Bùi Bảo Long: INITIAL_API_UI_READY, cần review UI. BE-15/BE-X06 vẫn PARTIAL.

Backend: `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24MainDraftRegressionTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~ReviewedMainDraftReleasesOnce|FullyQualifiedName~ReleaseRejectsStaleReview|FullyQualifiedName~ContractPdfRendererTests' --verbosity minimal`: **57/57 đạt, 0 skip**. Đã sửa lỗi storage key trùng và giữ signing mode bất biến được phát hiện qua legacy regression; không nới ràng buộc DB. Backend build 0 warning/error. PostgreSQL riêng port 55440, dữ liệu tổng hợp; các fixture tự xóa database riêng.

Commit slice release: `0e0c3aeed0b8c3c91e3c739df29ac9d6f18f9948` — `feat(contract): [BE-15] release reviewed Main Draft into signing`.

### Slice BE-15 — kiểm chứng client thực ngày 06/11/2026

Đã sửa nhánh Owner Web mở Main Draft từ danh sách: sau release chuyển sang ContractDetailPanel thay vì tiếp tục hiển thị editor. Truy vết UC-15/GBR-04/18; không đổi API/DB. Mở rộng harness hiện hữu bằng `--finance --main-draft`, sử dụng bản build thật của Owner Web, API thật, PostgreSQL Compact24 tạm và MinIO Docker riêng. Không thêm ứng dụng UI khác, không intercept/mock API, không đổi CA trust của Windows. Browser chỉ bỏ kiểm CA trong context localhost tổng hợp; không công bố đây là nghiệm thu TLS production.

`dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **8/8 nhóm đạt**, exit 0: 5 nhóm Finance/settings cũ và 3 nhóm Main Draft mới. Staff dùng MobileApi + shared mainDraftClient thật để tạo/xác nhận Resident tổng hợp, lưu/đọc lại Draft sử dụng cấu hình Owner. Owner dùng browser tải PDF từ LibreOffice/MinIO, human confirmation, chọn Tenant, release từ danh sách. Tenant dùng MobileApi thật tải đúng bytes/hash canonical PDF; Tenant khác 404, Staff 403. Owner/Tenant ký **simulation được gắn nhãn**, xác nhận sao kê tổng hợp, Owner kích hoạt; Tenant thấy Active/2 Simulated signatures/1 deposit và Room Occupied. Kích hoạt thiếu điều kiện bị 409. Không có MySign thật hoặc giao dịch ngân hàng thật; nghiệm thu provider vẫn BLOCKED.

`npm.cmd run test --workspace src/mobile -- signing-ui.test.tsx contracts.test.ts --maxWorkers=1` với Node 22: **27/27 đạt**. Test bổ sung Tenant consent, pending response, chống double submit, chỉ callback success sau backend; đây là component test, không phải native device E2E. Không thấy adb trong PATH, native acceptance NOT RUN. Không sửa production Mobile vì màn ký và private download đã có.

`npm.cmd run test --workspace src/owner-web -- src/app/router.test.tsx --maxWorkers=1`: **37/37 đạt**. Timeout lịch sử không tái hiện khi chạy riêng; không tăng timeout, không giảm assertion, chưa kết luận đã sửa một lỗi router sản phẩm. Lần browser dev-server đầu timeout navigation; harness chuyển sang bản build production trong TEMP và đã đạt. Một lỗi locator test chọn cả Drawer và action dialog đã sửa bằng accessible dialog name, không thay logic sản phẩm.

Changed files: ContractsPage, FinanceVerificationCli/ContractVerificationCli, Verify-FinanceClients/Verify-MainDraftClients, mobile signing-ui test, báo cáo/API notes. Handoff Owner Web Vũ Xuân Trường và Mobile Bùi Bảo Long; task tổng BE-15/BE-X06 vẫn PARTIAL do provider/mẫu production và native acceptance.

Validation slice: harness .NET build **0 warning/error**; Owner Web build/lint đạt; Mobile typecheck/lint đạt với Node 22. Các lệnh/kết quả chỉ áp dụng các thay đổi đã nêu, chưa thay cho full regression cuối đợt.

Commit kiểm chứng client: `51c0d3f7065c6b46fda4c82258335fb21f543fd0` — `fix(contract): [BE-15] leave draft editor after release and verify real clients`.

### Slice BE-17 — xác nhận đúng phiên bản bàn giao, 06/11/2026

UC-17 / GBR-01/02/18 → shared useContractHandover, Mobile ContractHandoverPanel, API hiện hữu → test đổi Contract, phiên bản server thay đổi, quyền Staff/Tenant và bàn giao với evidence thật. Lỗi tìm được: Mobile giữ checkbox từ phiên bản trước khi server trả phiên bản mới; shared hook cũng giữ record cũ khi đổi context/tải lại lỗi. Đã gắn dữ liệu với client/Contract/role/revision và xác nhận với Contract/version. UI phải hiển thị đúng record trước khi cho xác nhận; backend vẫn kiểm version và quyền như cũ. Không đổi schema, API hay quy tắc xác nhận.

`npm.cmd run test --workspace src/mobile -- handover-ui.test.tsx signing-ui.test.tsx --maxWorkers=1`: **8/8 đạt**. Test mới kiểm consent của phiên bản mới, ẩn nội dung cũ khi đổi Contract/read bị từ chối, Staff bị khóa trước Tenant confirmation và lỗi server không báo thành công. Mobile typecheck/lint đạt. `npm.cmd run test --workspace src/owner-web -- src/features/contracts/Contracts.test.tsx src/features/contracts/ContractLifecyclePanel.test.tsx --maxWorkers=1`: **13/13 đạt**.

Harness hiện hữu `--finance --main-draft` mở rộng `Verify-HandoverClients.cjs`: **9/9 nhóm đạt**. Hai Initial tasks/ảnh PNG tổng hợp thật được upload MinIO và Staff human-confirm qua MobileApi; test thiếu human confirmation, sai utility, duplicate reading replay. Tạo Asset qua API, upload ảnh bàn giao riêng tư, Staff save/replay, Tenant dispute, Staff sửa, stale confirmation 409, Tenant xác nhận v2 rồi Staff hoàn tất. Owner browser đọc đúng inventory/confirmed v2 và tải ảnh private; Tenant tải đúng ảnh bàn giao/điện, cross-Tenant 404. History có đủ 5 event, không cho sửa bản Confirmed. Không seed reading/Active trực tiếp vào DB. Đây là Mobile transport + component evidence; native camera/device E2E vẫn NOT RUN.

Changed files: useContractHandover, ContractHandoverPanel, handover-ui test, Verify-HandoverClients/Verify-MainDraftClients và tài liệu. Handoff Vũ Xuân Trường/Bùi Bảo Long; BE-17 chưa đóng native acceptance.

Commit bàn giao: `1481972ae408da539b0918e34b642ac5baa991fe` — `fix(handover): [BE-17] bind consent to the displayed contract version`. Owner Web build/lint và Mobile typecheck/lint đạt.

### Slice BE-31 — chứng từ khoản chi private, 06/11/2026

UC-31 / GBR-01/02/18, SDS private storage → ExpenseEvidenceService/Repository/Controller, shared finance client, ExpenseEvidencePanel → test upload/download, Owner-only, hash, version/source preservation, failure recovery và browser. Dùng cột evidence của expenses và SecurityAudit hiện hữu; không thêm bảng/cột/dependency. Không sửa Finance formulas hoặc số tiền.

Đã bổ sung GET list/POST ảnh/GET private download; JPEG/PNG thật tối đa 5 MB, giới hạn kỹ thuật 20 evidence. Intent PendingUpload được commit trước storage, chỉ Uploaded sau hash readback; cùng key/file replay không nhân bản, khác file 409. Lỗi sau external write giữ key liên kết expense để retry hoàn tất, không có row Uploaded trỏ object chưa kiểm. Owner Web mở lại có thể dùng lại Pending key bằng đúng ảnh. Server kiểm hash/length trước download, không gửi object key trong DTO. Raw metadata cũ được giữ nguyên; API mới chỉ hiển thị envelope mới. Evidence không đổi version mảng history dùng chỉnh sửa tiền; audit upload được lưu riêng.

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24ExpenseTests' --verbosity minimal`: **6/6 đạt**, 0 skip. Storage fault/tamper là test boundary được gắn nhãn; có parallel same-key upload, interruption sau external write, replay/audit một lần, malformed/oversize, Staff/Tenant/cross-expense denial và schema readiness. `npm.cmd run test --workspace src/owner-web -- src/features/expenses --maxWorkers=1`: **7/7 đạt**; Owner Web build/lint và harness build 0 warning/error đạt. Không thêm Node types/dependency khi test crypto cần import runtime.

`dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **10/10 nhóm đạt**; nhóm mới upload/reload/download chứng từ qua Owner Web build, API, Compact24 và MinIO Docker thật. So sánh length/hash của file người dùng tải xuống với PNG tổng hợp gốc; không coi response body rỗng trong browser network capture là nội dung file. Các nhóm hợp đồng/bàn giao/Finance trước vẫn đạt. Chưa phải staging/production hoặc native acceptance.

Browser dùng PNG tổng hợp >32 KB và <5 MB, xác nhận action upload trên Kestrel thật không bị giới hạn JSON 32 KB của controller. Ảnh đã lưu/download đúng hash. Không thay request-size policy chung.

Changed files: ExpenseEvidenceService/Repository, ExpensesController, DI, finance client, ExpenseEvidencePanel/test, ExpensesApiPage/test, Compact24ExpenseEvidenceTests, browser helper và docs. Handoff Vũ Xuân Trường, INITIAL_API_UI_READY. BE-31 vẫn PARTIAL vì chọn Asset/Work Order và reviewer còn lại. Holding giữ chặn OQ-03/Q-H1 (hạn hiệu lực/payment deadline/thời điểm chuyển và hoàn tác cọc chưa có quyết định); không tự chọn deadline. Refund/settlement giữ explicit Pending theo phạm vi đã ghi.

Commit chứng từ: `b7ac7fb034288fc481601678729bbdcee264c1c7` — `feat(finance): [BE-31] store private expense evidence with recoverable uploads`.

### Slice BE-31 — tham chiếu tài sản/công việc nguồn, 06/11/2026

UC-31 / FE-08 / GBR-01/02/18 và liên kết OperatingExpense với Work Order trong BF-07 → ExpenseService/Repository/Controller và ExpensesApiPage → acceptance nguồn cùng Location/Room/Asset, task type, immutable links, key replay và old fingerprint. Đã kiểm schema thực: expenses có asset_id/task_id/incident_report_id; operational_tasks phân biệt WORK_ORDER với các loại khác. Không thêm bảng/cột hoặc backend Work Order trùng module của nhóm.

Thêm Owner-only reference-choices và optional assetId/taskId. UI lấy Rooms/Assets/Work Orders thật theo scope, auto chọn Asset khi Work Order có nguồn cụ thể. Tạo expense khóa Location và kiểm lại scope; ghi incident link từ Work Order; chỉ OPERATING liên kết Work Order. Correction giữ nguyên source links. Null optional fields không thay hash của request cũ. Không tự hạch toán lại khoản chi hoặc tự approve plan/cost theo Work Order status.

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24ExpenseTests' --verbosity minimal`: **8/8 đạt**, 0 skip. Có wrong Room/Location Asset, General task, inconsistent Incident source, missing Asset cho Work Order, Owner/Staff quyền, source preservation/correction và tương thích fingerprint cũ. Work Order fixtures là dữ liệu nguồn tổng hợp có sẵn bằng SQL trên schema test, không phải chứng minh workflow BF-07 đã có. `npm.cmd run test --workspace src/owner-web -- src/features/expenses --maxWorkers=1`: **8/8 đạt**, có UI chọn đúng IDs; Owner Web build/lint và harness build 0 warning/error đạt.

Browser `--finance --main-draft`: **10/10 nhóm đạt** với fixture Asset thật tại Room. Owner chọn Room/Asset khi ghi chi, mở correction thấy đúng liên kết bất biến; upload chứng từ và các nhóm Finance/contract/handover vẫn đạt. Handover kiểm toàn inventory kể cả Asset có sẵn. Không có production Work Order API để chạy browser tạo Work Order; UI không điền mock. Handoff Vũ Xuân Trường: INITIAL_API_UI_READY; reviewer và nghiệm thu upstream Work Order còn lại.

Ngày bắt đầu: 05/11/2026. Nhánh `member/QHuy`; baseline `5357b39`. Working tree ban đầu sạch. Đây là báo cáo tiến độ thực thi; không phải xác nhận hoàn tất 22 nhiệm vụ. Không push/merge, không ghi vào database làm việc `bhome`.

## Nguồn và truy vết

Đã đọc AGENTS gốc và hai client, API_CONVENTIONS, thiết kế/DDL/báo cáo Compact24, source/DTO/DI/tests, nội dung SRS `(2)`, SDS `(5)` và Report 2 `(3)` trong `docs/reports`. SRS: BF-03/04, UC-14..19, GBR-01/02/04, DBR-02/03; BF-05/06, UC-20..25; FE-08, UC-31..34, GBR-15/16/18. Không tìm thấy workbook `BHOME_Checklist_Phan_Cong_Tich_Hop_Tien_Do.xlsx` hoặc Reports 5–7; chưa có căn cứ để sửa checklist hay công bố ST/AT theo các mẫu đó.

Người dùng xác nhận OQ-01/02/05 đã đóng trong phiên này. Chưa nhận được nội dung quyết định; các tài liệu đang lưu vẫn ghi mở. Cần tìm/đưa quyết định cụ thể vào nguồn truy vết trước khi thay công thức khấu trừ/hoàn tiền. Không suy ra một chính sách từ việc câu hỏi đã đóng.

## Ma trận 22 nhiệm vụ sau kiểm tra nguồn ban đầu

| ID     | Đã có / dữ liệu / UI                                                                       | Khoảng trống và nghiệm thu còn lại                                                                                 | Trạng thái |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| BE-X04 | DI mặc định Compact24, worker/Identity/readiness; 24/386/83                                | Regression server riêng, SQL log không legacy đã đạt 1 test; cần toàn bộ regression                                | PARTIAL    |
| BE-14  | Contract Holding boundary và test transfer                                                 | `UnconfiguredContractHoldingLedger` vẫn đăng ký; chưa có Holding E2E thật                                          | BLOCKED    |
| BE-15  | Owner settings/Main Draft/documents/signing/deposit/activation; Web/Mobile; contracts JSON | Sửa trạng thái UI cấu hình; provider staging, tenant document review và browser E2E chưa nghiệm thu                | PARTIAL    |
| BE-16  | Renewal API/client, giữ phiên bản và chữ ký                                                | Test Compact24 đạt; provider thật và UI E2E chưa chạy                                                              | PARTIAL    |
| BE-17  | Handover API/client, baseline, evidence, hai xác nhận                                      | Test Compact24 đạt; native Staff/Tenant E2E chưa chạy                                                              | PARTIAL    |
| BE-19  | Move-out/inspection/settlement state machine                                               | Positive test dùng ledger test; policy cụ thể/refund và E2E thật chưa đủ                                           | PARTIAL    |
| BE-20  | Capture/OCR/confirmation, Web monitor/Mobile; meters/readings                              | Regression nguồn hiện có; chưa chạy lại detector/device acceptance trong lượt này                                  | NOT RUN    |
| BE-21  | Room/kỳ invoices/items/recipients, billing schedule/automation, Web/Mobile                 | Cần chạy regression Compact24 và E2E                                                                               | NOT RUN    |
| BE-22  | Verified transactions/allocation, receiving account; Web/Mobile                            | Cần regression thực và bank integration; không tự nới under/overpayment                                            | NOT RUN    |
| BE-23  | Debt/due date/reminders/inbox                                                              | Cần regression Compact24, UI                                                                                       | NOT RUN    |
| BE-24  | Request/evidence/Owner decision và lịch sử, Web/Mobile                                     | Cần regression Compact24, quyết định OQ cụ thể, UI                                                                 | NOT RUN    |
| BE-25  | Payment history và scope                                                                   | Cần regression và UI                                                                                               | NOT RUN    |
| BE-31  | Bảng `expenses`; UI Investments hiện demo                                                  | Chưa có service/repository/controller Finance trong DI; cần API và UI thật                                         | PARTIAL    |
| BE-32  | UI reports/demo                                                                            | Chưa có backend reports thực được đăng ký                                                                          | PARTIAL    |
| BE-33  | UI demo tính recovery                                                                      | Chưa có backend recovery từ ledger thực                                                                            | PARTIAL    |
| BE-34  | `financial_scenarios`; UI demo                                                             | Chưa có backend analyze/save/list/get và isolation tests                                                           | PARTIAL    |
| BE-X05 | CLI/preflight/mapping/reconciliation tests và artifacts                                    | Cần chạy lại populated synthetic migration, không dùng dữ liệu thật                                                | NOT RUN    |
| BE-X06 | MinIO adapter, PDF signer, MySign adapter native                                           | Không thấy bằng chứng provider staging; PDF conversion baseline lỗi; storage test substitute không phải MinIO thật | PARTIAL    |
| BE-X07 | Bank claim/exact reconciliation/deposit guards                                             | Chưa có nội dung chính sách đã đóng; Holding/refund chưa nghiệm thu                                                | PARTIAL    |
| BE-X08 | Invoice/payment unit và integration tests                                                  | Chưa có finance/report regression thực                                                                             | PARTIAL    |
| DOC-01 | Reports 2/3/4 originals, docs kỹ thuật                                                     | Báo cáo này bổ sung discrepancy; không sửa bản gốc để biến giới hạn thành yêu cầu                                  | PARTIAL    |
| DOC-03 | Báo cáo bằng chứng này                                                                     | Report 7 không có tại repository; chưa thể đóng final evidence                                                     | PARTIAL    |

## Slice BE-15 cấu hình hợp đồng trên Owner Web

Nguồn: UC-15, GBR-01/02/04; API hiện hữu GET/PUT `/api/v1/contracts/main-drafts/settings/{locationId}`. Thành phần: `MainDraftSettingsPanel`, shared `mainDraftClient`, `MainDraftService`/`MainDraftData`; settings trong cấu hình Location Compact24. Không đổi DTO, endpoint, schema hoặc quyền.

Thay đổi: xóa dữ liệu cũ khi đổi cơ sở/đóng dialog; chặn lưu khi đang tải; bỏ qua response đã abort; reset thông báo khi mở lại; dùng form validation và khóa các trường trong lúc lưu; chỉ báo thành công sau GET đọc lại persisted settings. Owner Web reviewer: Vũ Xuân Trường, trạng thái `INITIAL_API_UI_READY`. Không sửa Mobile trong slice này (cấu hình thuộc Owner Web).

Acceptance tự động: lưu đúng expectedVersion và đọc lại dữ liệu; đổi Location khi response cũ chưa về không ghi đè dữ liệu mới; lỗi tải/lưu không hiển thị thành công hoặc cho lưu dữ liệu cũ. 3/3 component tests đạt. Owner Web build và lint đạt. Chưa có browser E2E cho slice.

## Bằng chứng kiểm thử thực thi

- `dotnet test src/backend/BHome.sln --no-restore --verbosity minimal`: Domain 83 đạt; Application 225 đạt; Integration 456 đạt, 1 lỗi, 127 skip (thiếu biến Compact24 và optional model). Lỗi: `ActualLibreOfficeConversionPersistsPrivatePdfWithVietnameseAndIssueDate`, trả `contract_pdf_conversion_failed`.
- `npm.cmd run test --workspace src/owner-web`: baseline 99 đạt, 12 timeout, 111 tổng; chạy đồng thời gây tải cao. Sẽ chạy lại giới hạn worker, không tăng timeout để che lỗi.
- `npm.cmd run test --workspace src/mobile`: baseline 358 đạt, 14 lỗi, 372 tổng; 12 startup tests bị runtime Node ngoài dải hỗ trợ, 2 onboarding timeout. Cần xác minh lại với Node 22 đã có trong `.tools`.
- PostgreSQL 18 riêng trong thư mục TEMP, loopback port 55439, chỉ dữ liệu tổng hợp, query logging không parameter. Các fixture tự tạo/xóa database `bhome_compact24_<uuid>`.
- `dotnet test tests/backend/BHome.IntegrationTests --no-build --filter 'FullyQualifiedName~Compact24MainDraftRegressionTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~Compact24IndependenceTests' --logger 'trx;LogFileName=huy-contract-baseline.trx' --verbosity quiet` với biến kết nối server riêng: **24/24 đạt, 0 skip**. Có settings/effective dates/onboarding/docx, signing/activation/replay/race/authorization/renewal/handover/move-out và runtime independence. Signing/storage/settlement dùng boundary test được ghi trong fixture; không chứng minh MySign/MinIO thật.
- `npm.cmd run test --workspace src/owner-web -- src/features/contracts/MainDraftSettingsPanel.test.tsx --maxWorkers=2`: **3/3 đạt**.
- `npm.cmd run build --workspace src/owner-web`: đạt (TypeScript và Vite).
- `npm.cmd run lint --workspace src/owner-web`: đạt, không warning sau sửa.

## Nhật ký commit

Commit được ghi ngay sau mỗi slice đã kiểm tra. Chỉ stage đường dẫn cụ thể; không push.

- `5e2c68f` — `fix(contract): [BE-15] guard configuration loading and verify saved settings`: 3 file (panel, component test, báo cáo này); 3/3 tests, build/lint đạt; BE-15 vẫn PARTIAL; handoff Vũ Xuân Trường.
- `ff2f315` — `feat(finance): [BE-31] persist Owner expenses with real API interface`: 13 file liệt kê trong slice Expenses; 3/3 PostgreSQL + 3/3 UI, build/lint đạt; PARTIAL, handoff Vũ Xuân Trường.
- `8196b89` — `feat(finance): [BE-32][BE-33] report actual revenue costs and capital recovery`: 13 file liệt kê trong slice report; 5 formula tests, report/ledger PostgreSQL và 2 UI tests đạt; build/lint đạt, PARTIAL.
- `dd087f3` — `feat(finance): [BE-34] save and compare isolated financial scenarios`: 15 file trong slice What-if và compatibility DI; 25/25 Finance/ApiFoundation, 2 formula + 2 UI tests, build/lint đạt; PARTIAL.
- `68761b4` — `feat(payment): [BE-22][BE-X07] retain partial debt and isolate excess receipts`: 13 file trong slice payment; 8 domain/4 PostgreSQL/6 UI tests đạt, build/lint đạt; refund execution còn thiếu.
- `886acca` — `fix(finance): [BE-31] retain expense scope inside Location Workspace`: 3 file; 4 UI tests/build đạt.
- `4865902` — `test(finance): [BE-15][BE-34] verify real browser workflows on disposable Compact24`: thêm harness/browser script, tài liệu và fallback reason cho allocation import; build 0 warning/error, browser đạt, full integration 588/589 (1 optional skip).
- `72638db` — `fix(finance): [BE-31] render real expenses in Location investment route`: sửa Outlet/API boundary, thêm regression route/browser và cập nhật inventory; route test 1/1, browser 5/5, build/lint đạt.

## Slice BE-31 Expenses API và Owner Web

Đã thêm Controller → ExpenseService → IExpenseRepository → ExpenseRepository → Compact24 expenses, shared finance client và màn hình thật vào `Investments` khi API mode. Truy vết UC-31/FE-08: Owner nhập/sửa đúng dữ liệu, Location/Room hợp lệ, audit correction, chặn destructive delete và Staff/Tenant. Dùng source_key hiện hữu cho idempotency, history cho version/before/after/reason; không đổi 24 bảng/386 cột/83 FK. Không ghi database `bhome`.

3/3 PostgreSQL integration tests đạt: persist/reload/filter/correction/history/schema; parallel create/replay/key conflict/update race; 401/403/invalid amount/invalid Room/filter, không ghi tiền sai. 3/3 UI tests đạt: API list/create/one submit/readback; detail/version/reason; API failure/retry stable key/no fake data. Owner Web build/lint đạt. Backend test build đạt không warning/error. Chi tiết API/DTO/ví dụ và fixture: `docs/api/FINANCE.md`.

Changed files: `Application/Finance/ExpenseService.cs`, `Infrastructure/Finance/ExpenseRepository.cs`, `Api/Controllers/ExpensesController.cs`, DI, exception handler, `packages/client-core/src/finance.ts`, `ExpensesApiPage`/test/useFinanceApi, `property/FinancePages.tsx`, `Compact24ExpenseTests.cs`, tài liệu Finance và báo cáo này. Dữ liệu: expenses; đọc users/locations/rooms. Handoff Owner Web: Vũ Xuân Trường, `INITIAL_API_UI_READY`. Mobile không thay. Trạng thái task **PARTIAL**: chưa upload/download chứng từ riêng, chọn Asset/Work Order trong UI, browser E2E và reviewer.

## Cập nhật baseline sau sửa môi trường

- Chạy lại Mobile bằng Node 22 `.tools/node-v22.23.4-win-x64`, `--maxWorkers=2`: **372/372 đạt**. Không sửa test hoặc startup code để che lỗi Node ngoài engines.
- Owner Web Node 22 `--maxWorkers=2`: 112 đạt, 2 router timeout; đang kiểm tra serial.
- Dựng thành công image hiện hữu bằng `docker build -f deploy/docker/ContractConverter.Dockerfile -t bhome/contract-converter:local .`. Chạy lại `ActualLibreOfficeConversion...`: **1/1 đạt** (trong lượt 4 test: PDF đạt, 1 expense đạt, 2 expense lỗi serialization đã sửa rồi chạy lại expenses 3/3 đạt). Đây là PDF thật, không phải chữ ký MySign thật.
- Tìm cấu hình MySign trong các file cấu hình hiện hữu không thấy section được cấu hình; Development chỉ có MainDraft converter. Không xuất giá trị secret vào báo cáo/chat. Tài liệu `DIGITAL_SIGNING_COMPLETION.md` vẫn yêu cầu môi trường/tài khoản provider và quy trình liên kết chủ chứng thư. Chưa tìm thấy tài liệu quyết định OQ-01/02/05 cụ thể thay các ghi chú cũ.

## Slice BE-32/BE-33/BE-X08 báo cáo và hoàn vốn

Thêm FinancialReportsController → FinancialReportService → IFinancialReportRepository → FinancialReportRepository và shared client/Owner Web `/reports` API mode. Nguồn UC-32/33, FE-08, GBR-15/16; DTO/formula/giới hạn được ghi trong `docs/api/FINANCE.md`. Không ghi financial ledger; đọc invoices/adjustments/allocations/payments/expenses/locations/rooms/refunds dưới snapshot RepeatableRead. Không thêm schema/table. Không sửa Mobile.

5/5 application formula tests đạt: phát hành khác thực thu, điều chỉnh/OPEX/nợ/hoàn vốn, không vốn/không dòng tiền/lỗ/no-data/đã hoàn vốn, refund uncertainty. PostgreSQL `Compact24ExpenseTests` 4/4 đạt (bao gồm 3 expense tests trước); report thực đọc chi phí/vốn, scope/role/invalid. `Compact24FinanceLedgerTests` 1/1 đạt: chạy payment workflow thật trên Compact24 rồi kiểm report issued/verified collections/debt/occupancy; giao dịch chưa phân bổ không bị tính doanh thu. UI report 2/2 tests đạt (figures/null payback/API failure), build/lint đạt.

Changed files: `Application/Finance/FinancialReportService.cs`, `Infrastructure/Finance/FinancialReportRepository.cs`, `Api/Controllers/FinancialReportsController.cs`, DI, shared `finance.ts`, `FinancialReportsApiPage`/test và `ReportsPage`, `FinancialReportTests`, `Compact24ExpenseTests`, `Compact24FinanceLedgerTests`, docs. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường. Task **PARTIAL**: browser E2E/reviewer, historical occupancy, classified refunds/Staff cost integration và optional Room UI selector chưa đủ; không gọi đây là BE-32/33 hoàn tất toàn bộ.

Owner Web full serial với Node 22: 116 đạt, 1 router Location Workspace timeout; không thay timeout hoặc sửa assertion để lấy PASS. Slice tests riêng đạt như trên. Tiếp tục điều tra regression toàn bộ.

## Slice BE-34 What-if

Controller → FinancialScenarioService → repository → financial_scenarios; shared API client; Owner Web API mode `/what-if`. UC-34/GBR-15/16: analyze không ghi, save chỉ ghi scenario; giữ nguyên input/baseline/result/version; xem/compare không tính lại. Khai báo đầy đủ giả định thuê/lấp đầy/thu tiền/OPEX, số tháng, baseline và công thức quản trị trong FINANCE.md. Dedupe đồng thời bằng UUID/advisory lock, key đổi input bị 409, list/get Owner-scoped. Không thêm bảng, không sửa Mobile.

2/2 formula tests và 2/2 component tests đạt. PostgreSQL ledger/scenario regression đạt: phân tích/lưu đồng thời/replay/get/list/changed-key/validation/không thay report hoặc expenses, schema vẫn hợp lệ. Chạy nhóm Finance + ApiFoundation sau sửa DI **25/25 đạt**. Owner build/lint đạt. Trạng thái **PARTIAL**, handoff Vũ Xuân Trường `INITIAL_API_UI_READY`; browser E2E/review cuối chưa chạy.

Full regression ban đầu phát hiện legacy test fixture gỡ Compact24DbContext khiến DI validation của Finance thất bại. Đã sửa constructor repository dùng `BHomePersistenceContext` hiện hữu; production vẫn resolve Compact24, SQL vẫn bảng Compact24 và không có fallback legacy. ApiFoundation + Finance đã kiểm tra lại. Full run cũ đã dừng sau phát hiện lỗi; không coi là PASS.

Router test từng timeout đã chạy riêng với Node22 và giữ nguyên timeout: **1/1 đạt** (35 test khác không được chọn), xác nhận vấn đề tải máy; chưa coi full Owner suite PASS.

## Quyết định chính sách theo ủy quyền người dùng

05/11/2026: người dùng yêu cầu “nếu chưa có hãy triển khai theo hướng của bạn và báo cáo cho tôi”. Đây là ủy quyền chọn hướng triển khai trong phiên, thay việc phải chờ nội dung OQ cũ. Hướng thực hiện: thiếu tiền được ghi nhận từng phần sau Owner đối soát; tiền thừa chỉ phân bổ tối đa dư nợ, phần còn lại giữ chờ Owner, không tự doanh thu/refund/credit. Khấu trừ/hoàn cọc cần quyết định và bằng chứng Owner, không tự phí phạt/hạn hoàn. Mỗi phần phải có validation, snapshot, concurrency/idempotency và test trước khi đánh dấu triển khai; ghi chú này chưa phải bằng chứng tất cả các nhánh đã được viết.

## Slice BE-22/BE-X07 thanh toán thiếu và tiền thừa

Đã triển khai chính sách min(receipt,dư nợ) trên service và Compact writer, giữ transaction/claim/dedupe/actor hiện hữu. Bổ sung số đã/chưa phân bổ, reason đúng khi replay/list/GET, PendingReview cho tiền thừa, giao diện giải thích trước Owner xác nhận và hiện số dư. Không tự refund, không ghi thừa vào invoice, không sửa chứng từ Final, không thay bảng. Backend tiếp tục trả Unpaid nếu còn nợ, Paid khi hết nợ; Mobile nhận paid/outstanding như hiện hữu, shared labels bổ sung tiếng Việt.

8/8 domain PaymentRules tests đạt; 4/4 PostgreSQL tests đạt gồm 2 Compact24 under/over mới và 2 legacy exact-policy regression. Compact test kiểm partial debt, paid/history sau transfer tiếp theo, cap dư nợ, tiền thừa chưa phân bổ và replay đúng reason. 6/6 Owner payment UI tests đạt, build/lint đạt. Full regression đang được chạy lại; lượt trước phát hiện Compact writer còn exact guard và legacy test schema exact, đã sửa writer và tách capability rõ ràng, không sửa historical migration để che lỗi. Full run cũ đã dừng; chưa báo PASS tổng.

Changed files: PaymentRecords/PaymentRulesTests, PaymentContracts/PaymentService, PaymentRepository, Compact24EventsAndLedger, Compact24WorkflowRegressionTests/PaymentLedgerTests, shared payments.ts, OwnerInvoicePaymentPanel/Payments.test.tsx, PAYMENTS.md và báo cáo. Handoff Vũ Xuân Trường `INITIAL_API_UI_READY`; Bùi Bảo Long kiểm tra màn hình số tiền đã trả/còn nợ trên thiết bị. BE-X07 vẫn PARTIAL vì giải ngân refund/credit và quyết toán cọc chưa có đầy đủ UI/ledger.

Mobile typecheck và lint hiện tại đều đạt với Node22; không thay Mobile source trong các slice này.

## Sửa phạm vi Expenses trong Location Workspace

Khi vào `/locations/:locationId/investment`, API page nay ưu tiên Location của route cho list/create và khóa selector phạm vi; không mở mặc định toàn chuỗi trong một workspace đã chọn. `/expenses` độc lập vẫn lọc mọi cơ sở Owner được phép. Regression UI 4/4 đạt (bao gồm scope mới); TypeScript/Vite build đạt. Không đổi API/backend/schema. Changed files: ExpensesApiPage.tsx và test; handoff Vũ Xuân Trường `INITIAL_API_UI_READY`.

## Browser E2E thật và hồi quy cuối

`dotnet build tools/BHome.ContractVerification --no-restore --verbosity quiet`: đạt 0 warning/error. `dotnet run --no-build --project tools/BHome.ContractVerification -- --finance` với server riêng: **exit 0, 4/4 nhóm browser acceptance đạt**. Source harness: `FinanceVerificationCli.cs`, `Verify-FinanceClients.cjs`, cờ `--finance` trong tool hiện hữu. Chi tiết môi trường/TLS/cleanup ở FINANCE.md. Không thêm dependency hoặc OS trust. Không dùng kết quả ký mô phỏng làm chữ ký thật.

Đã kiểm chứng trên trình duyệt Owner: nhập/lưu/reload/sửa khoản chi; báo cáo đọc đúng khoản vừa sửa; không tự có ước tính payback khi chưa có vốn; What-if tính từ input rồi lưu/reload snapshot; cấu hình hợp đồng Owner lưu/reload đúng tiền cọc và hồ sơ mã hóa. Các slice này được nâng lên `E2E_PASSED` cho đường đi đã test; final UI ownership/review vẫn Vũ Xuân Trường.

`dotnet test tests/backend/BHome.IntegrationTests --no-build --logger 'trx;LogFileName=huy-verified-integration.trx' --verbosity minimal` với BHOME_COMPACT24_TEST_ADMIN và BHOME_COMPACT24_QUERY_LOG: **588 đạt / 0 lỗi / 1 skip / 589 tổng**, 6m19s. Bao gồm native Compact24 contracts/invoice/payment/jobs/authorization/independence và populated synthetic migration/reconciliation/rollback. Skip duy nhất optional `RealModelsReadWaterThroughDiagnosticHttpAndResolveElectricLabelWithoutPersistence`; không tuyên bố đã chạy model HTTP acceptance đó.

Domain full hiện tại: **83/83**; Application full: **232/232**; DigitalSigning riêng: **41/41**. Mobile: **372/372** với Node22, typecheck/lint đạt. Owner Web full cuối đang chờ kết quả; timeout /schedules từng xuất hiện khi chạy cùng integration, không sửa assertion hoặc tăng timeout.

Các lần chạy lỗi trước được giữ trong nhật ký ở trên; không cộng double-count các nhóm test nằm trong full suite. Logs/TRX raw nằm trong `.tools`/TestResults bị ignore; báo cáo không chứa secrets, UUID Tenant thật hoặc bank credentials. Các database tổng hợp và artifacts TLS được cleanup bởi fixture/harness.

## Sửa route Vốn và Chi phí và kết quả kiểm tra bổ sung

Phát hiện `LocationWorkspace` liệt kê tab investment nhưng không render Outlet cho tab này; API mode còn bị chặn bởi prototype property provider. Đã cho child route Finance sử dụng nguồn API riêng và render Outlet đúng. Không thay các tab khác. Browser kiểm `/locations/<synthetic-id>/investment`, dữ liệu đúng cơ sở và selector khóa phạm vi: đạt. Browser toàn bộ cuối **5/5 nhóm đạt, exit 0** (4 nhóm trước cộng Location route). Test route mới đạt 1/1 (36 case khác không chọn); cold lazy import được chờ trong 10s ở test mới, không tăng timeout các test có sẵn. Build/lint Owner Web đạt.

Full Owner Web Node22/maxWorkers=1 sau khi backend nghỉ: **122 đạt / 1 timeout / 123 tổng**, case `keeps property functions inside the selected Location Workspace` vượt 15s ở mock room view. Lượt chạy đồng thời trước timeout `/schedules`; các case đã đạt khi chạy riêng. Chưa sửa production prototype Room view hoặc nới timeout để che vấn đề; **không tuyên bố full Owner suite PASS**. Test mới của investment chạy sau full suite, không cộng nó để công bố một full suite khác.

Audit routes được chạy lại với evidence output: **1/1 đạt**, 199 routes (194 protected/5 anonymous), 97 Owner GET probes, 0 HTTP5xx. Phân bố GET: 200=32, 204=2, 400=9, 403=3, 404=51. Đây là audit khả dụng/quyền và negative lookups; không chứng minh mọi happy path. `docs/api/API_IMPLEMENTATION_STATUS.md` được cập nhật số liệu và Finance.

## Trạng thái bàn giao cuối của lượt triển khai

Không đóng toàn bộ 22 nhiệm vụ. Các phần được triển khai/kiểm chứng và phần còn lại cụ thể:

| Task   | Kết quả hiện tại                                                                                                 | Việc còn lại                                                                                                               | Trạng thái              |
| ------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| BE-X04 | Fresh Compact24, DI/Identity/worker/readiness/SQL log independence và regression đạt                             | Không có legacy runtime dependency được phát hiện trong phạm vi đã test                                                    | DONE                    |
| BE-14  | Boundary và transfer guard được test                                                                             | Implement Holding ledger/API/UI bằng cơ chế signing chung; chưa có Holding workflow thật                                   | PARTIAL                 |
| BE-15  | Browser cấu hình Owner; Compact24 onboarding/draft/documents/signing/activation tests đạt                        | MySign test/staging và toàn tuyến Owner/Tenant từ onboarding tới activation                                                | PARTIAL                 |
| BE-16  | Renewal/history/state/scope regression đạt                                                                       | Provider staging + Owner/Tenant UI E2E với renewal đã ký                                                                   | PARTIAL                 |
| BE-17  | Handover scoped Staff/Tenant, baseline/evidence/version regression đạt                                           | Native device E2E sau contract activation trên môi trường được phép                                                        | PARTIAL                 |
| BE-19  | Inspection/final readings/pending settlement/room release guards đạt                                             | Deposit deductions/refund/settlement journal thực và UI đầy đủ; không fake Resolved                                        | PARTIAL                 |
| BE-20  | OCR/capture/confirmation regression hiện hữu đạt                                                                 | Một optional real-model HTTP test skip; detector accuracy/device acceptance theo báo cáo OCR còn giới hạn                  | PARTIAL                 |
| BE-21  | Invoice Room/kỳ, source snapshot/finalization/immutability/scope/automation regression đạt                       | Browser/Tenant native xuyên chu kỳ hóa đơn và reviewer                                                                     | PARTIAL                 |
| BE-22  | Verified manual allocation, partial/excess/debt/history/idempotency/race tests đạt; Owner UI cập nhật            | Browser payment workflow riêng, cấu hình bank provider nếu cần tự đối soát                                                 | PARTIAL                 |
| BE-23  | Debt/overdue/notification/current assignment regression đạt                                                      | Full UI/device reminder acceptance và cấu hình delivery thật                                                               | PARTIAL                 |
| BE-24  | Request/evidence/decision/immutable financial history regression đạt                                             | Browser/Tenant native full request-decision workflow và reviewer                                                           | PARTIAL                 |
| BE-25  | Payer privacy/verified allocations/history regression đạt                                                        | Browser/device E2E history với nhiều lần thanh toán                                                                        | PARTIAL                 |
| BE-31  | CRUD/filter/detail/versions/history/Owner permission, actual Compact24, browser tạo/sửa/reload và Location route | Upload/download chứng từ riêng và chọn Asset/Work Order khi ghi chi thủ công; UI reviewer                                  | PARTIAL                 |
| BE-32  | Actual scoped invoice/adjustment/collection/OPEX/debt/profit/current occupancy API+UI và browser đạt             | Historical occupancy, Staff cost tự động, classified refund chưa nằm trong slice; không có dashboard accounting hoàn chỉnh | PARTIAL                 |
| BE-33  | Recovery/payback formula, null/negative/zero/refund guard, API/UI/browser đạt                                    | Classified cash refunds và nguồn vốn ngoài expenses cần tích hợp để mở rộng phạm vi                                        | PARTIAL                 |
| BE-34  | Analyze/save/list/get/compare, immutable snapshots/isolation/role/idempotency; browser save/reload đạt           | Vũ Xuân Trường review UX; không thay actual ledger                                                                         | DONE (functional slice) |
| BE-X05 | Populated synthetic 70→24 mapping/reconciliation/rollback/privacy/evidence tests trong full suite đạt            | Không chạy migration trên working bhome; chưa có pilot với một dataset legacy ngoài fixtures được chủ dự án chỉ định       | PARTIAL                 |
| BE-X06 | DOCX/PDF converter thật và MinIO/authorization regressions; PDF signing 41 tests đạt                             | Không thấy cấu hình MySign staging; cần account/provider/ownership verification, không có chữ ký thật trong lượt này       | PARTIAL                 |
| BE-X07 | Đã chọn/ghi/triển khai under/over payment policy được ủy quyền                                                   | Refund/credit/deposit settlement execution và UI chưa triển khai đủ                                                        | PARTIAL                 |
| BE-X08 | 7 formula tests + finance actual-ledger regression, full payment/invoice tests đạt                               | Regression settlement/refund khi các chức năng đó được triển khai                                                          | PARTIAL                 |
| DOC-01 | API inventory/Finance/Payments/progress có source traceability và kết quả thật                                   | Bản gốc Reports 2/3/4 chưa sửa; supplement này ghi discrepancy, không thay approved baseline bằng claims                   | PARTIAL                 |
| DOC-03 | Bằng chứng/commands/commits/handoff và gaps trong báo cáo này                                                    | Report 7/checklist workbook không có trong repository; chưa thể hoàn tất hồ sơ final theo mẫu                              | PARTIAL                 |

Không coi việc người dùng ủy quyền chính sách là đã triển khai refund/settlement. Chưa tìm thấy MySign configuration trong files/process đã kiểm; không suy đoán secret trong nguồn ngoài repository. Không push/merge hoặc thay production data.

Đã kiểm tra thêm UserSecretsId thực tế `bhome-api-development`: file user-secrets có tồn tại nhưng không có key DigitalSigning/Viettel/MySign; chỉ xuất trạng thái có/không, không đọc/in giá trị bí mật ra log. Không sửa file cấu hình hoặc secrets. PostgreSQL test riêng port 55439 đã dừng sau khi các bài kiểm tra DB/browser kết thúc; không dừng instance PostgreSQL của dự án. Không còn API/browser helper của harness đang chạy sau cleanup.

## Danh sách file thay đổi qua các commit triển khai

- docs/api/API_IMPLEMENTATION_STATUS.md
- docs/api/FINANCE.md
- docs/api/PAYMENTS.md
- docs/development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md
- packages/client-core/src/finance.ts
- packages/client-core/src/payments.ts
- scripts/Verify-FinanceClients.cjs
- src/backend/BHome.Api/Controllers/ExpensesController.cs
- src/backend/BHome.Api/Controllers/FinancialReportsController.cs
- src/backend/BHome.Api/Controllers/FinancialScenariosController.cs
- src/backend/BHome.Api/Middleware/ApiExceptionHandler.cs
- src/backend/BHome.Application/Finance/ExpenseService.cs
- src/backend/BHome.Application/Finance/FinancialReportService.cs
- src/backend/BHome.Application/Finance/FinancialScenarioService.cs
- src/backend/BHome.Application/PaymentsDebt/PaymentContracts.cs
- src/backend/BHome.Application/PaymentsDebt/PaymentService.cs
- src/backend/BHome.Domain/PaymentsDebt/PaymentRecords.cs
- src/backend/BHome.Infrastructure/DependencyInjection.cs
- src/backend/BHome.Infrastructure/Finance/ExpenseRepository.cs
- src/backend/BHome.Infrastructure/Finance/FinancialReportRepository.cs
- src/backend/BHome.Infrastructure/Finance/FinancialScenarioRepository.cs
- src/backend/BHome.Infrastructure/PaymentsDebt/PaymentRepository.cs
- src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24EventsAndLedger.cs
- src/owner-web/src/app/router.test.tsx
- src/owner-web/src/features/contracts/MainDraftSettingsPanel.test.tsx
- src/owner-web/src/features/contracts/MainDraftSettingsPanel.tsx
- src/owner-web/src/features/expenses/ExpensesApiPage.test.tsx
- src/owner-web/src/features/expenses/ExpensesApiPage.tsx
- src/owner-web/src/features/expenses/useFinanceApi.ts
- src/owner-web/src/features/locations/pages/LocationWorkspace.tsx
- src/owner-web/src/features/payments/OwnerInvoicePaymentPanel.tsx
- src/owner-web/src/features/payments/Payments.test.tsx
- src/owner-web/src/features/property/FinancePages.tsx
- src/owner-web/src/features/reports/FinancialReportsApiPage.test.tsx
- src/owner-web/src/features/reports/FinancialReportsApiPage.tsx
- src/owner-web/src/features/reports/pages/ReportsPage.tsx
- src/owner-web/src/features/what-if/FinancialScenariosApiPage.test.tsx
- src/owner-web/src/features/what-if/FinancialScenariosApiPage.tsx
- src/owner-web/src/features/what-if/pages/WhatIfPage.tsx
- tests/backend/BHome.Application.UnitTests/Finance/FinancialReportTests.cs
- tests/backend/BHome.Application.UnitTests/Finance/FinancialScenarioTests.cs
- tests/backend/BHome.Domain.UnitTests/PaymentsDebt/PaymentRulesTests.cs
- tests/backend/BHome.IntegrationTests/Compact24/Compact24ExpenseTests.cs
- tests/backend/BHome.IntegrationTests/Compact24/Compact24FinanceLedgerTests.cs
- tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs
- tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentLedgerTests.cs
- tools/BHome.ContractVerification/ContractVerificationCli.cs
- tools/BHome.ContractVerification/FinanceVerificationCli.cs
