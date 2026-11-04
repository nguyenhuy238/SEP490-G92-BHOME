# Postman kiểm thử các phần Nguyễn Quốc Huy đã triển khai

Đối chiếu ngày **02/11/2026** với source backend và
`docs/reports/BHOME_PROGRESS_REPORT_NGUYEN_QUOC_HUY_2026-11-02.md`.
Collection chứa **245 request trong 15 nhóm**, dùng format Postman Collection v2.1 để import trực tiếp.
Đây là bộ request/assertion kiểm thử, không phải kết quả nghiệm thu của 245 API.

## 1. Import và chạy nhanh

Import **cả hai file** vào Postman:

1. [BHome.NguyenQuocHuy.Implemented.postman_collection.json](BHome.NguyenQuocHuy.Implemented.postman_collection.json)
2. [BHome.NguyenQuocHuy.Implemented.Local.postman_environment.json](BHome.NguyenQuocHuy.Implemented.Local.postman_environment.json)

Chọn Environment **BHOME - Nguyễn Quốc Huy - Local**. `baseUrl` mặc định
`https://localhost:7240/`. URL request có dạng `{{baseUrl}}api/v1/...`; script cũng hỗ trợ
giá trị baseUrl không có `/` cuối. Chạy folder **00 - Smoke không cần tài khoản** trước.
Live/Ready phải 200; các API nghiệp vụ thiếu Bearer phải 401; payload login thiếu password phải 400.

Tiếp theo điền `ownerEmail`, `ownerPassword`, `staffEmail`, `staffPassword`,
`tenantEmail`, `tenantPassword` bằng **tài khoản test đã có**, rồi Send login tương ứng ở folder 01.
Login không tạo tài khoản và không tự mở khóa account. Test chỉ lưu session khi response 200 đúng role.
Sau đó GET `Me` kiểm tra user/role của từng session. Token hết hạn thì login lại hoặc dùng refresh
ở folder 14; không gửi lại refresh credential đã bị rotate.

Mật khẩu/token trong file chia sẻ đều để trống. Điền giá trị local của Environment trong Postman;
không export Environment đã chứa credential/token để commit hoặc gửi cho người khác.
Secret type chỉ che UI, **không mã hóa file export**. Scripts không log password/token/body response.
Collection dùng JSON refresh transport, tắt cookie cho mọi request, không giả lập cookie trình duyệt.

**Bản tạo lại:** mỗi request nhận JSON có body đầy đủ trong **Body → raw → JSON**, thay cho
biến body tổng `{{huyRequestBody}}`. Các request upload dùng **Body → binary**; GET và những
POST không nhận DTO không thêm body giả. Environment có **184 biến** cho địa chỉ API,
tài khoản từng role, token, ID/version, dữ liệu dùng lại và các tùy chọn chạy.

Ví dụ body login Owner:

```json
{
  "email": "{{ownerEmail}}",
  "password": "{{ownerPassword}}",
  "device": "{{deviceName}}"
}
```

Một số nhóm biến cần điền/chọn khi chạy nghiệp vụ:

| Nhóm                  | Biến Environment                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| API và tài khoản      | `baseUrl`, `ownerEmail/Password`, `staffEmail/Password`, `tenantEmail/Password`                                 |
| Phạm vi dữ liệu       | `locationId`, `roomTypeId`, `roomId`, `residentId`, `contractId`, `invoiceId`                                   |
| Tạo phòng             | `locationName`, `locationAddress`, `roomTypeName`, `roomNumber`, `roomCapacity`, `roomAreaM2`, `roomFloor`      |
| Hợp đồng              | `contractStart`, `contractEnd`, `monthlyRent`, `requiredDeposit`, `contractTerms`                               |
| Chỉ số và giá         | `meterId`, `readingDate`, `meterConfirmedValue`, `billingPeriod`, `chargeCode`, `chargeRate`, `rateEffectiveOn` |
| Thanh toán/điều chỉnh | `paymentAmount`, `bankReference`, `paymentOccurredAt`, `transferReference`, `proposedAmount`, `correctedAmount` |

Token và các ID/version có request tạo/detail tương ứng sẽ được lưu tự động vào Environment.
ID không được tự chọn từ record đầu tiên của danh sách. Ngày hợp đồng, kỳ tính tiền và các rule
chưa được chọn giữ trống để điền theo fixture thực tế; thiếu biến thì request báo SKIP trong Console.

## 2. Nhóm chức năng và truy vết

| Folder              | Requests | Nội dung / nguồn nghiệp vụ                                                                                   |
| ------------------- | -------: | ------------------------------------------------------------------------------------------------------------ |
| 00 Smoke            |        9 | Health/readiness; anonymous auth, validation; UC-01 / GBR-01                                                 |
| 01 Auth/session     |       11 | Owner, Staff, Tenant, CoTenant, outsider login/me; UC-01/02                                                  |
| 02 Dữ liệu nền      |       17 | Chain, Location, assignment, RoomType/Room/Asset, biểu giá; BF-01 / UC-04..07                                |
| 03 Capture/OCR      |       20 | Resident, OCR proposal, meters/tasks, binary evidence, human confirmation; UC-13/20 / GBR-07                 |
| 04 Main Contract    |       25 | Preparation/account link, draft, preview/document, signing, deposit/readiness/activation; UC-14..16 / GBR-04 |
| 05 Handover         |        9 | Baseline/assets/evidence/version, Tenant/Staff confirmation, dispute; UC-17                                  |
| 06 Invoice          |       13 | Owner calendar, Draft, refresh/Final, viewer, missing inputs, immutable Final; UC-21 / DBR-06/07             |
| 07 Payment/debt     |       19 | Receiving account, QR instructions, statement, allocation/replay, debt/history; UC-22/23/25 / GBR-10/18      |
| 08 Adjustment       |       13 | Tenant request/evidence, Owner approve/replay/reject, effective balance và privacy; UC-24                    |
| 09 Renewal/move-out |       23 | Renewal chain/cancel, termination, assignment/inspection/review/settlement/complete; UC-19 / JOB-02          |
| 10 Automation       |       17 | Versioned plan, representative, JOB-09/10 Run Now, queue/attempts, replay; JOB-09/10 / GBR-18                |
| 11 Notifications    |       23 | Publish nguồn đã commit, own inbox/count/read/target, delivery status; UC-35/36 / JOB-02/04                  |
| 12 Operational Task |       16 | Create/assign/execute/evidence/submit/verify/history; BF-02 / UC-10..12                                      |
| 13 Negative         |       27 | 401/403/404, cross-Tenant, Staff scope, validation, Idempotency-Key                                          |
| 14 Auth cuối lượt   |        3 | Refresh rotation, logout session, JWT bị thu hồi                                                             |

Mỗi request ghi controller/DTO nguồn trong Description. Method/path của cả 245 request đã được
kiểm tra lại với route attributes trong `src/backend/BHome.Api/Controllers`; health đối chiếu Program.cs.
Không thêm endpoint suy đoán từ SRS hoặc từ các màn UI demo.

Mô hình invoice thực tế áp dụng quyết định Owner đã ghi nhận: **một hóa đơn chung Room + kỳ**,
không lập lại phí cho từng Contract. Xem `BH21_TRACEABILITY.md`, `BH25_TRACEABILITY.md`,
`BH40_TRACEABILITY.md`, `BH41_TRACEABILITY.md`, `JOBS_TRACEABILITY.md` trong `docs/development`.

Bộ `BHome.Simple.postman_collection.json` cũ vẫn giữ nguyên để dùng các ca Auth sâu/Property update
và Task rework riêng. Collection mới tập trung vào các workflow tích hợp đã nêu trong báo cáo Huy.
Luồng Main Tenancy DOCX/PDF mới của Long (`MainDraftsController`) không được gộp thành phần Huy
trực tiếp triển khai; có thể kiểm thử riêng theo guide Main Draft của nhóm.

## 3. Tài khoản và ID phải chọn đúng

| Biến                                                                                           | Cách lấy / ý nghĩa                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ownerAccessToken`, `ownerUserId`                                                              | Login Owner tự lưu                                                                                     |
| `staffAccessToken`, `staffUserId`                                                              | Login Staff tự lưu; Staff cần assignment hiện hành                                                     |
| `tenantAccessToken`, `tenantUserId`                                                            | Tenant requester / signer chính; login tự lưu                                                          |
| `coTenantEmail/Password` → token/id                                                            | Tenant B cùng invoice, **khác requester A**; ca viewer được xem balance nhưng không private adjustment |
| `outsiderEmail/Password` → token/id                                                            | Tenant ngoài invoice/contract; **khác A/B**, không có entitlement cho object đang test                 |
| `otherStaffAccessToken`                                                                        | Token Staff khác không được giao Location; nhập local cho ca cross-Location                            |
| `locationId`, `roomId`                                                                         | Copy đúng ID từ GET danh sách hoặc request tạo mới tự lưu; không tự lấy record đầu tiên                |
| `residentId`                                                                                   | GET Residents/preparation hoặc tạo Resident test; phải Verified và link đúng Tenant để tạo Contract    |
| `contractId`                                                                                   | ID Main Contract đang kiểm tra; create/detail tự lưu                                                   |
| `invoiceId`, `invoiceVersion`                                                                  | Generate/detail/refresh tự lưu; phải là invoice của Room/kỳ đã chọn                                    |
| `lifecycleContractId`                                                                          | Chọn riêng cho move-out; không tự thay `contractId` hoặc đóng nhầm fixture đang test invoice           |
| `ownerNotificationId`, `staffNotificationId`, `tenantNotificationId`, `coTenantNotificationId` | Chọn từ inbox của đúng recipient; không tự chọn notification đầu tiên                                  |

Environment có đủ các biến cho mọi nhánh, phần lớn là ID/version/config runtime. Không cần điền
toàn bộ để chạy smoke hoặc đọc danh sách. Request thiếu biến cần thiết sẽ **SKIP**, không gửi HTTP.
Xem Console để biết tên biến còn thiếu; SKIP không được tính là PASS của nghiệp vụ đó.

Đổi môi trường/Room/Invoice cần chọn lại ID và version tương ứng. Nên duplicate Environment sạch
cho mỗi fixture thay vì mang ID, snapshot hoặc command key từ fixture cũ sang.

## 4. Các cờ chạy ghi dữ liệu

Mặc định tất cả `enable*` là `false`. Các mutation hợp lệ có nhãn **[GHI]** và chỉ gửi khi đủ cờ
và biến. Các ca sai quyền/human confirmation có thể gọi POST để chứng minh server từ chối;
chúng vẫn chỉ nên chạy trên môi trường test được phép.

| Flag                              | Khi nào bật                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `enableWrites=true`               | Tạo/cập nhật dữ liệu synthetic, upload ảnh, mark read; cờ chung cho [GHI]                |
| `enableIdentityConfirmation=true` | Chỉ để lưu trường định danh **synthetic**, không dùng CCCD thật                          |
| `enableFinancialWrites=true`      | Final, manual statement/allocation, Owner approve adjustment, settlement review          |
| `enableLifecycleActions=true`     | Activate/termination/inspection/complete; chọn đúng lifecycle fixture                    |
| `enableExternalSigning=true`      | Request/sync signing; kiểm tra configuration trước, phân biệt Simulated và provider thật |
| `enableDevActions=true`           | Run Now/publish events ở Development/Testing; backend vẫn kiểm tra runtime/quyền/ngày    |
| `enableOptionalBranches=true`     | Dispute, reject/cancel riêng, future run, negative state với fixture riêng               |
| `enableAuthCleanup=true`          | Refresh/logout ở folder 14, chạy cuối lượt                                               |
| `allowRemoteRequests=true`        | Chỉ khi chọn staging test ngoài loopback đã được phép; bắt buộc HTTPS                    |

Không Run toàn bộ collection với tất cả flags bật. Approve/Reject, Renewal/termination và
handover/dispute là các nhánh có precondition khác nhau. Chọn request hoặc folder phù hợp với
fixture. Các flags chỉ điều khiển client test; không cấp role và không bỏ qua kiểm tra backend.

## 5. Trình tự thao tác gợi ý

### 5.1 Chỉ kiểm tra API đang chạy

Chạy 00 → login các role ở 01 → GET danh sách trong 02/04/06/07/11 → các ca 403 trong 13.
Nếu database chưa có Location/Room/Contract/Invoice thì danh sách rỗng hợp lệ; các ca detail/state
chưa chạy được. Không báo cáo luồng tài chính đã pass từ việc GET danh sách 200.

### 5.2 Tạo scope và Main Contract tổng hợp

1. Bật `enableWrites`; tạo Location → Staff assignment → RoomType → Room → Asset ở 02.
   `assignmentStart/End` phải bao phủ ngày nghiệp vụ ở Việt Nam; Tenant account phải có sẵn.
2. Tạo Resident ở 03. Nếu kiểm tra OCR, dùng ảnh tổng hợp; OCR trả proposal/fallback, không xác nhận.
   Muốn confirm identity, dùng 12 chữ số synthetic duy nhất ở `syntheticCitizenNumber`, bật cờ identity.
   Hoặc chọn Resident test đã được xác minh từ môi trường demo riêng.
3. Folder 04: preparation → Owner link Resident/Tenant → Create Main với `contractStart/End`,
   `monthlyRent`, `requiredDeposit` của fixture. Tiền thuê 3.000.000 và cọc 0 trong template chỉ là
   ví dụ test, không phải cấu hình mặc định hệ thống.
4. GET configuration; generate preview và tải PDF. Chọn certificate được phép rồi bật signing flag.
   Với **Simulated Development** có thể điền certificate Guid.Empty theo configuration hiện có;
   production cần certificate/provider thực đã cấu hình. Request/sync không đồng nghĩa ký xong.
5. Nếu có cọc, xác minh statement tổng hợp theo luồng đã có; xem activation-readiness.
   Chỉ activate khi backend `ready=true`; Staff bị 403 nếu tự activate.

Không có API tạo/xóa Chain trong workflow. Không đổi trạng thái Room thủ công để giả thanh toán
hoặc giả activate. Collection không tạo tài khoản Tenant và không thay ledger Holding chưa có.

### 5.3 Ghi số điện/nước và hóa đơn

Tạo meter điện/nước từ 03, chọn `meterId` tương ứng. Với mỗi loại:

- Initial: `readingPurpose=0`, `taskBillingPeriodJson=null`, `taskContractIdJson=null`,
  `readingDate` cho baseline hợp lệ; upload PNG → confirm value ban đầu → lưu `readingId`.
- Periodic: `readingPurpose=1`, `taskBillingPeriodJson="2026-11-01"` (giá trị JSON có dấu nháy),
  `taskContractIdJson=null`; chọn kỳ/ngày **thực tế của fixture**, không mặc định tháng ví dụ.
  Ngày periodic sau baseline; upload → OCR nếu cần → kiểm tra/sửa → human confirm.
- Final: `readingPurpose=2`, `taskBillingPeriodJson=null`, `taskContractIdJson="<contract GUID>"`;
  chỉ dùng cho đúng lịch/contract trả phòng. Không tạo consumption ước tính.

`meterConfirmedValue` là giá trị người kiểm tra xác nhận. `electricityReadingId/waterReadingId`
dùng cho handover; `finalElectricityReadingId/finalWaterReadingId` dùng cho inspection. Sau mỗi
utility cần copy đúng `readingId` sang biến tương ứng, không dùng cùng ID cho hai loại.

GET/lưu calendar ở 06, chọn các giá trị Owner đã quyết định:

| Biến                                                     | Enum/quy tắc thật                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `rateDateRule`                                           | 0 PeriodStart, 1 PeriodEnd                                                 |
| `rentSourceRule`                                         | 0 RoomPolicy, 1 RepresentativeContract                                     |
| `partialMonthRule`                                       | 0 FullMonth, 1 OccupiedCalendarDays                                        |
| `roundingRule`                                           | 0 AwayFromZero, 1 ToEven                                                   |
| `draftDay`, `finalDay`, `dueDay`                         | 1–31, backend co về cuối tháng ngắn                                        |
| `draftMonthOffset`, `finalMonthOffset`, `dueMonthOffset` | 0–2; backend kiểm tra Draft ≤ Final ≤ Due                                  |
| `billingPeriod`                                          | yyyy-MM-01                                                                 |
| `rateEffectiveOn`                                        | Ngày giá có hiệu lực thật trong fixture; không sửa giá đã dùng cho lịch sử |

Các biến lựa chọn lịch/rule được để trống để Owner chọn. GET calendar chưa có trả 204 sẽ lưu version 0;
có calendar sẽ lấy version backend. Tương tự receiving account và representative.
Khi tạo biểu giá ở 02, chạy riêng với RENT(category 0, method 0), ELECTRICITY(1,1), WATER(2,1)
và giá phù hợp; không nhân phí theo số hợp đồng/người ở.

Generate Draft → kiểm tra `missingInputs` → refresh khi đã sửa dữ liệu → Final khi đủ dữ liệu và
đến lịch. Bật financial flag cho Final. `Lưu snapshot Final đang test` dùng để so sánh sau payment/
adjustment. Negative missing-input dùng **invoice riêng** đã đến ngày Final nhưng thiếu input.

### 5.4 Payment và Adjustment

Folder 07: xem/lưu receiving account synthetic ở Development → lấy transfer instructions và
payment state → `paymentAmount`/`transferReference` lấy từ backend → register statement → allocate.
`bankReference`, `paymentOccurredAt`, verification là dữ liệu test có chủ đích; không chuyển tiền thật
đến tài khoản 000… trong fixture. Chỉ exact verified match mới được assert Allocated/Paid ở nhánh này.

`paymentRegisterKey`, `paymentAllocateKey` sinh một lần và giữ nguyên cho retry. Không đổi amount,
reference, invoice hoặc payer rồi dùng key cũ. Khi tạo giao dịch test mới, dùng Environment/command
keys mới. `Replay allocate` phải dùng nguyên body và key; xem history và payment sau đó.
Partial/excess/sai reference hiện giữ review, không tự Paid/refund/credit; nhánh exact không được
dùng để tuyên bố những policy đó đã hoàn tất.

Folder 08: Tenant submit → Owner GET detail để lấy `adjustmentVersion`,
`adjustmentInvoiceVersion`, `adjustmentFinancialVersion` → quyết định approve hoặc reject phù hợp.
`evidenceIdsJson` là JSON array ID ảnh đã upload; mặc định `[]` nếu không gửi ảnh, hoặc copy
`["<adjustmentEvidenceId>"]`. Replay approve chạy ngay sau approve, không GET ghi đè expected
versions giữa hai lần. Request Reject phải có `rejectAdjustmentId` riêng còn Pending.

`proposedAmount/correctedAmount` là số tiền sau sửa của khoản/toàn hóa đơn, không phải delta.
Sau correction Draft kiểm tra Draft được cập nhật theo backend; assertion **Final bất biến** chỉ
dùng với invoice đã Final và đã có `originalFinalSnapshot`. Sau khi giảm Final đã trả đủ, số tiền
thừa cần review vẫn là review, không coi đó là hoàn tiền thành công.

Ca privacy: Tenant B cùng invoice phải xem được balance/effects, nhưng GET private request hoặc
evidence của Tenant A trả 404. Outsider không có viewer entitlement phải 404 khi mở invoice/contract.

### 5.5 Renewal/move-out

Dùng `lifecycleContractId` riêng. Renewal tạo `renewalContractId`; để ký/kích hoạt nó cần chọn ID đó
cho folder 04 và chạy workflow bình thường. Không Run cả cancel renewal và activate trên một nhánh.

Move-out: Tenant request → Owner approve → schedule/Staff assignment → baseline handover + final
readings → evidence/inspection → Owner review → settlement-summary → settlement review.
`moveOutVersion` lấy từ response mới nhất; `inspectionVersion` chọn từ GET inspections.
`handoverAssetsJson` và `inspectionAssetsJson` phải liệt kê đầy đủ Asset IDs và condition đã
đối chiếu, không để `[]` khi phòng có assets bắt buộc. Handover `expectedHandoverVersion=0` chỉ cho lần đầu.

Complete chỉ khi backend summary Resolved, review/reference khớp và actualEndDate hợp lệ.
Nhánh còn nợ/cọc/usage/dispute/excess dùng `blockedLifecycleContractId` riêng để kiểm tra 409.
Không nhập số 0 giả cho refund/deduction để đóng. Khi còn Tenant Active khác, kiểm tra Room vẫn Occupied.
Folder này không chứng minh mọi nhánh settlement đã được duyệt chính sách.

### 5.6 JOB-09/10 và Inbox

GET calendar → GET history latest version → Save plan với `automationEffectiveFrom=yyyy-MM-01`.
`automationEnabled` và `authorizeAutomaticFinalization` mặc định false; Owner phải tự chọn.
`automationVersion` lấy từ bản ghi đầu của history (version cao nhất), không lấy version kỳ cũ
đang xem. Có nhiều Contract eligible thì chọn representative trước khi có invoice Room/kỳ.

GET preview kiểm tra `developerActionsEnabled`, `workerEnabled`, `businessDate`, phase dates.
Run Now không bypass ngày; muốn kỳ chưa tới lịch trả 204 phải có plan enabled cho
`futureConfiguredPeriod`. GET queue/attempts cho thấy state và retry thực; **HTTP 200 Run Now có thể
là PendingInputs**, không có nghĩa task/invoice đã hoàn tất. Không gọi endpoint giả chạy JOB-02/JOB-04.

Folder 11 publish nguồn event **đã commit** rồi GET inbox đúng role. Request trả `createdCount`
thực tế, có thể bằng 0 khi replay. Chọn notification ID đúng người → target reauthorize → read.
CoTenant chỉ nhận thông tin balance chung, không private marker `POSTMAN_PRIVATE_`.
Delivery monitor `configured=false`/Unconfigured là phản ánh provider chưa có, không được đổi
thành success. Không có collection request tự gọi provider hoặc giả bank webhook/VNeID.

Hai phép so sánh IDs trước/sau replay chỉ kiểm tra trang snapshot, cần môi trường không phát sinh
event mới trong khoảng đó. Chúng không thay thế integration PostgreSQL constraint/concurrency test.

## 6. Upload file và payload

Ảnh đi kèm: [fixtures/synthetic-meter.png](fixtures/synthetic-meter.png), PNG 320×120 có block digits
tổng hợp và metadata chỉ rõ synthetic. Không phải ảnh đồng hồ hoặc CCCD thật.
Đặt **Postman Settings → Working directory** thành `docs/testing/postman` hoặc chọn file bằng
Body → binary cho từng request upload. Đúng `Content-Type: image/png`; không dùng multipart.
Trong Newman thêm `--working-dir docs/testing/postman` khi chạy các request có file.

Tab **Body** hiển thị JSON template đầy đủ; có thể sửa trực tiếp từng trường. Pre-request đọc chính
body đang hiển thị, resolve biến Environment và escape chuỗi qua `JSON.stringify`, nên password/reason
có dấu nháy/backslash vẫn gửi đúng. Body chỉnh tay không bị ghi đè bằng payload ẩn trong spec.

- Chuỗi có dấu nháy: `"roomId": "{{roomId}}"`, `"monthlyRent": "{{monthlyRent}}"`.
- Số/boolean/JSON không có dấu nháy quanh placeholder: `"capacity": {{roomCapacity}}`,
  `"enabled": {{automationEnabled}}`, `"assets": {{handoverAssetsJson}}`.
- Biến `*Json` chứa JSON hợp lệ như `[]`, `null` hoặc `"2026-11-01"`; số dùng dấu chấm thập phân,
  không dùng dấu phân cách hàng nghìn. Các dấu nháy trong giá trị `*Json` là một phần của JSON.

Kiểu tiền chuỗi/số giữ theo DTO backend. Những literal phục vụ ca lỗi như `humanConfirmed: false`
được giữ ngay trong body để thể hiện rõ điều kiện kiểm thử. Không tự tính total hoặc xác nhận
payment thành công từ client. Muốn lưu thay đổi lâu dài qua lần regenerate, sửa generator;
giữ nguyên tên request vì dispatcher assertion dùng tên duy nhất.

## 7. Kiểm tra đã thực hiện và giới hạn

| Phần                                                         | Trạng thái ngày 02/11/2026                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Official Postman v2.1 schema                                 | PASS                                                                                                                 |
| 245 method/path so với C# controllers                        | PASS static                                                                                                          |
| Shared scripts + 245 request specs/JSON escaping             | PASS static/offline; kiểm tra trực tiếp body hiển thị và mọi biến tham chiếu                                         |
| 20 nhóm kiểm tra script                                      | PASS; có thêm sửa Body trực tiếp, giữ kiểu JSON, escape chuỗi và baseUrl có/không có `/` cuối                        |
| Smoke live trên `https://localhost:7240/`                    | **9 requests, 16 assertions, 0 failure**, chạy lại sau khi tạo lại body/environment; Newman exit 0; TLS system trust |
| Run toàn bộ với Environment trống/flags false                | Chỉ 9 smoke requests gửi HTTP; 236 request còn lại SKIP, không tính pass nghiệp vụ                                   |
| Contract/Invoice/Payment/Adjustment/lifecycle mutations live | **NOT RUN trong lượt tạo Postman này**                                                                               |
| PostgreSQL/MinIO demo replay                                 | **BLOCKED trong lượt này: Docker daemon không chạy**, không reset DB hoặc tự khởi tạo dữ liệu khác                   |
| MySign/bank/push/email thật                                  | Không xác nhận; phụ thuộc provider/policy/môi trường                                                                 |

Logs local ignored: `.tools/postman-validation/live-smoke.json`, `live-smoke.log`,
`default-run.json`, `offline-validation.log`. Các kết quả demo/test trong guide cũ thuộc lượt
triển khai trước, không được cộng vào bằng chứng chạy collection mới này. Chưa phải formal ST/AT.

## 8. Duy trì và chạy CLI

Không thêm dependency production. Generator chỉ dùng Node built-ins:

```powershell
node scripts/postman/Generate-HuyImplementedCollection.cjs
```

Validation đã dùng công cụ cài trong `.tools/postman-validation` (ignored):

```powershell
npm.cmd install --prefix .tools/postman-validation --no-audit --no-fund newman ajv ajv-formats
Invoke-WebRequest -UseBasicParsing `
  -Uri https://schema.postman.com/collection/json/v2.1.0/draft-07/collection.json `
  -OutFile .tools/postman-validation/collection-v2.1.schema.json
node scripts/postman/Validate-HuyImplementedCollection.cjs
```

Chạy smoke với CA được tin cậy. Node hỗ trợ system CA có thể dùng cấu hình sau; nếu Node/OS chưa
hỗ trợ hoặc chứng chỉ chưa tin cậy, cấu hình CA đúng môi trường, không tắt TLS verification:

```powershell
$env:NODE_USE_SYSTEM_CA='1'
node .tools/postman-validation/node_modules/newman/bin/newman.js run `
  docs/testing/postman/BHome.NguyenQuocHuy.Implemented.postman_collection.json `
  -e docs/testing/postman/BHome.NguyenQuocHuy.Implemented.Local.postman_environment.json `
  --folder '00 - Smoke không cần tài khoản'
```

Tài liệu định dạng và skip behavior đã đối chiếu nguồn chính thức:
[Collection v2.1 schema](https://schema.postman.com/collection/json/v2.1.0/draft-07/collection.json),
[pm.execution.skipRequest](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution/).
Lượt này dùng skills API Engineer/API Testing của Postman để tổ chức local artifacts; không tạo
workspace, upload collection, gửi thông tin tài khoản hoặc publish lên dịch vụ bên ngoài.
