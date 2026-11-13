# Hoàn thiện luồng kiểm thử SePay Sandbox — 13/11/2026

## Phạm vi và truy vết

Yêu cầu triển khai đính kèm cùng chỉ dẫn sử dụng token hiện tại là quyết định trực tiếp của người dùng cho cấu hình Test Mode cục bộ. Token chỉ nằm trong `.env.sepay.local` được Git ignore; không đưa vào commit, tài liệu, frontend hoặc output kiểm thử.

| Hành vi yêu cầu                     | Nguồn / truy vết                                      | Thành phần                                                      | Acceptance                                                                            |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| API Sandbox và phục hồi giao dịch   | BF-06, FE-05, UC-22/25, GBR-10/18, JOB-03; `SEPAY.md` | SePayApiClient, SePayPollingJob, Test-SePayConnection.ps1       | HTTP 200 thật; 401/403/429/5xx; cursor và duplicate regression                        |
| Owner chuẩn bị mô phỏng             | Yêu cầu đính kèm §6.1; GBR-01/02                      | SePayController.testing-context, Owner payment workspace        | Owner-only; chỉ Enabled + Test + Development/Testing; không có secrets trong response |
| Tenant theo dõi trạng thái xác minh | UC-21/23/25, BF-05/06, GBR-10; yêu cầu §5.3           | useTenantInvoicePayment, TenantPaymentPanel                     | Không request trùng; dừng khi background/blur/Paid/hết 5 phút; cập nhật khi quay lại  |
| QR và kết quả đối soát              | UC-22, GBR-10/18; `PAYMENTS.md`                       | VietQrGenerator hiện có, PaymentInvoicePicker, SePayEventsPanel | Dùng số dư/mã BH từ server; chỉ link Dashboard; không sửa ledger từ UI                |

SRS và Report 4 gốc có trong `docs/reports/`; báo cáo SePay trước và contract API hiện hữu được tái sử dụng. Không thay đổi chính sách thiếu/thừa, xác định payer, ký hợp đồng, trạng thái hóa đơn hay schema. Status backend vẫn `NotIssued/Unpaid/Paid`; nhãn thanh toán một phần suy từ các số tiền backend đã trả.

## Kết nối ban đầu

Đã gọi API Sandbox thật bằng token server-side: GET `/v2/bank-accounts` và `/v2/transactions` trả HTTP 200, status success. Chỉ xuất số lượng và trạng thái; không lưu payload provider. Binding tài khoản cục bộ ban đầu không khớp tài khoản Sandbox. Webhook secret được giữ nguyên. Kết nối API không chứng minh webhook đã giao hoặc hóa đơn đã được phân bổ.

## Thành phần tái sử dụng và thay đổi

Tái sử dụng SePayWebhookSecurity, SePayService, SePayRepository, SePayApiClient,
SePayPollingJob/SePayScheduling/SePayAutomationWorker, PaymentCodeRegistry, PaymentService,
TransferInstructionsService, VietQrGenerator và ledger Compact24. Không thêm payment provider,
ledger, migration hoặc dependency. API client thật đã parse được 2 giao dịch Sandbox qua HTTP;
không chỉ gọi bằng PowerShell hoặc mock.

| Tệp nguồn được sửa/thêm                                             | Kết quả                                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/backend/BHome.Api/Controllers/PaymentsDebt/SePayController.cs` | Thêm GET testing-context, Owner-only, không secrets                                                                        |
| `src/backend/BHome.Application/PaymentsDebt/SePay/SePayOptions.cs`  | Điều kiện Enabled + Test + Development/Testing                                                                             |
| `scripts/Test-SePayConnection.ps1`                                  | Kiểm tra GET bank accounts/transactions, timeout, chặn redirect, chỉ xuất trạng thái/count/kết quả binding                 |
| `src/mobile/src/features/tenant/useTenantInvoicePayment.ts`         | Cache theo session, gộp request, refresh focus/foreground, polling 30 giây tối đa 5 phút và thông báo thay đổi đã xác minh |
| `src/mobile/src/screens/TenantPaymentPanel.tsx`                     | Tái sử dụng cache cho instructions, bỏ timer riêng, nhãn QR thử nghiệm; ẩn QR trong lúc lấy lại số dư                      |
| `src/owner-web/src/features/payments/SePayTestingPanel.tsx`         | Workspace chuẩn bị Invoice, copy/QR, link simulator, refresh và đối chiếu receipt                                          |
| `src/owner-web/src/features/payments/PaymentInvoicePicker.tsx`      | Tùy chọn chỉ chọn hóa đơn còn nợ, giữ bộ lọc Location/Room                                                                 |
| `src/owner-web/src/features/payments/PaymentManagementPage.tsx`     | Gắn workspace vào tab Webhook SePay                                                                                        |
| `src/owner-web/src/features/payments/SePayEventsPanel.tsx`          | Refresh khi quay lại, mở chi tiết receipt từ API hiện có, số đã/chưa phân bổ và khớp Invoice                               |
| `src/owner-web/src/features/payments/OwnerInvoicePaymentPanel.tsx`  | Phân biệt nguồn SePay Test/Live với Owner xác minh sao kê                                                                  |

Test sửa/thêm: `tests/backend/BHome.Application.UnitTests/PaymentsDebt/SePaySecurityTests.cs`,
`tests/backend/BHome.IntegrationTests/Compact24/SePayApiClientTests.cs`,
`tests/backend/BHome.IntegrationTests/Compact24/SePayIntegrationTests.cs`,
`src/mobile/src/__tests__/tenant-payment-refresh.test.tsx`,
`src/mobile/src/__tests__/tenant-invoice-flow.test.tsx`,
`src/owner-web/src/features/payments/SePayTestingPanel.test.tsx`,
`src/owner-web/src/features/payments/SePayEventsPanel.test.tsx`,
`src/owner-web/src/features/payments/Payments.test.tsx`.
Tài liệu: `docs/api/SEPAY.md`, biên bản này và context simulation hiện có.

## UI và hợp đồng dữ liệu

| Màn hình               | Nền tảng  | Tái sử dụng / mới                      | API                                                               | Trạng thái                                            |
| ---------------------- | --------- | -------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Invoice và Payment     | Mobile    | Tái sử dụng, sửa refresh               | invoices, payment, transfer-instructions                          | Unit/component test, typecheck và Expo web export đạt |
| Payment History / Debt | Mobile    | Tái sử dụng                            | payment-history, debts                                            | Regression payment-history đạt; không thiết kế lại    |
| Kiểm thử SePay         | Owner Web | Panel mới trong layout hiện hữu        | testing-context, payment-invoices, payment, transfer-instructions | Component test và production build đạt                |
| Webhook/polling events | Owner Web | Tái sử dụng và bổ sung receipt details | integrations/sepay/events, payment-transactions/{id}              | Component test đạt                                    |
| Manual review/history  | Owner Web | Tái sử dụng                            | payment-transactions, allocation/reconciliation-history hiện có   | Regression Payments đạt                               |

Không thêm trạng thái tài chính vào contract. Partial/Overdue là nhãn trình bày từ paidAmount,
outstandingAmount, overdueDays do backend trả. Tài khoản ngân hàng tiếp tục hiển thị BIN từ
DTO hiện hữu; không tự tạo bankName hoặc tra cứu tên ngân hàng qua dịch vụ ngoài. Chia sẻ/tải
QR native chưa được thêm; copy thông tin đã có và QR PNG nội bộ được giữ. Chưa chạy UI trên
trình duyệt/thiết bị thật trong phiên này vì browser access host không khả dụng.

## Cấu hình cục bộ và trạng thái thực tế

- Backend đã restart bằng `scripts/Start-Api.ps1 -EnvironmentFile .env.sepay.local`.
- Token server-to-server đã cấu hình; `Enabled=true`, `Mode=Test`,
  `ApiBaseUrl=https://userapi-sandbox.sepay.vn/v2`, `PaymentCodePrefix=BH`, `PollIntervalSeconds=60`.
- Giữ nguyên webhook secret. Binding BIN/gateway/account đã đồng bộ với đúng tài khoản Sandbox.
  Checker trả `MatchesActiveSandboxAccount=true`.
- Chỉ database loopback test riêng của profile này được seed. Helper cục bộ yêu cầu database
  `bhome_compact24_dev_<32 hex>` và ban đầu không có Users/Locations, không sử dụng `.env`/Neon.
  Schema đã sẵn sàng; không chạy migration hoặc sửa schema trong phiên này.
- Fixture `[TEST] BHOME SePay Sandbox`, phòng `SEPAY-101`: hóa đơn Final 2.500.000 VND,
  2 Tenant có quyền snapshot, receiving account demo, mã BH thật từ registry. Contract/occupancy
  là fixture tổng hợp, không phải chứng cứ ký số, thanh toán hay thuê phòng thật.
- Mật khẩu ngẫu nhiên và định danh fixture chỉ lưu tại `.tmp/sepay-completion/sandbox-fixture.json`;
  thông tin chuyển khoản thử nghiệm tại `.tmp/sepay-completion/payment-test-instructions.txt`.
  Helper setup/verify trong cùng thư mục bị Git ignore và không commit dữ liệu private.
- Chạy lại helper giữ nguyên tiền và mã BH; không reset hóa đơn. API xác nhận paidAmount=0,
  outstandingAmount=2500000, Unpaid, QR PNG có mã BH khớp payment response.
- Owner testing-context 200; Tenant/Staff 403. Cả hai Tenant đọc được Invoice chung; Staff đọc
  payment của Invoice bị 403. Anonymous testing-context đã kiểm tra 401 trong integration test.
- JOB-03 đã gọi Sandbox thật, nhận 2 giao dịch có sẵn và lưu 1 checkpoint có SynchronizedAt.
  Hai giao dịch ở ManualReview, không phân bổ vào hóa đơn thử nghiệm; đây không phải một
  giao dịch mới do tác vụ này tạo. API connectivity/polling không chứng minh webhook delivery.
- HTTPS local `/health/ready`: 200. Public `/health/live`: 200; public unsigned webhook: 401.
- Owner Web đã khởi chạy chế độ API tại `http://localhost:5173/`; chưa tự đăng nhập UI.

Webhook hiện tại:

```text
POST https://casually-rendition-bagful.ngrok-free.dev/api/v1/integrations/sepay/webhook
```

Đây là tunnel phiên hiện tại, không phải địa chỉ hosting bền vững. Mọi thay đổi hostname phải
khớp AllowedHosts và Dashboard. Không kiểm tra API Live/Production bằng token này.

## Kiểm chứng đã thực thi

| Lệnh / kiểm tra                                                                                                                                                   | Kết quả cuối                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `dotnet build src/backend/BHome.sln -c Release --no-restore --verbosity quiet`                                                                                    | PASS, 0 warning / 0 error                                                                        |
| `dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj -c Release --no-restore --filter FullyQualifiedName~SePaySecurityTests` | 19 passed / 0 failed / 0 skipped                                                                 |
| `Test-Compact24Isolated.ps1 -Configuration Release -Filter 'FullyQualifiedName~SePayIntegrationTests\|FullyQualifiedName~SePayApiClientTests'`                    | 22 passed / 0 failed / 0 skipped, PostgreSQL 16 disposable                                       |
| `postman simulation run postman/simulations/sepay/sepay.sim.yaml --port 4511 --output ndjson --no-history` và adapter smoke filter                                | 1 passed; đã thấy GET /v2/transactions thực từ adapter, HTTP 200 trên mock; process mock đã dừng |
| `npm run lint`                                                                                                                                                    | PASS, ESLint toàn repo, 0 warning                                                                |
| `npm run typecheck --workspace ./src/mobile`                                                                                                                      | PASS                                                                                             |
| `npm test --workspace ./src/owner-web -- SePayTestingPanel.test.tsx SePayEventsPanel.test.tsx Payments.test.tsx`                                                  | 22 passed / 0 failed                                                                             |
| `npm test --workspace ./src/mobile -- tenant-payment-refresh.test.tsx tenant-invoice-flow.test.tsx tenant-payment-history.test.ts`                                | 34 passed / 0 failed                                                                             |
| `npm run build --workspace ./src/owner-web`                                                                                                                       | PASS; còn cảnh báo Vite chunk >500 kB                                                            |
| Expo export `--platform web --max-workers 2 --output-dir ../../.tmp/sepay-completion/mobile-web` với EXPO_NO_DOTENV=1, API URL tổng hợp                           | PASS                                                                                             |
| `dotnet format ... --verify-no-changes --no-restore --include <5 tệp C# sửa>`                                                                                     | PASS                                                                                             |
| Prettier check các tệp TS/TSX sửa; `git diff --check`; staged secret scan                                                                                         | PASS                                                                                             |
| Test-SePayConnection, API adapter thật, fixture/API probes và public probes                                                                                       | PASS trong phạm vi ghi ở trên                                                                    |

Không cộng các lượt chạy lại cùng bộ test. Smoke qua Postman cũng nằm trong bộ HTTP integration,
nên không cộng thêm vào tổng backend. Tổng bộ focused không trùng: backend 41, Owner Web 22,
Mobile 34 test đạt. Không chạy toàn solution test, full frontend suite, remote CI, đo coverage,
load/performance hoặc iOS/Android native acceptance.

Lỗi được phát hiện và sửa: callback payment thay đổi khi bật query gây focus refresh lặp;
hai consumer cùng timer gây request thừa sau khi request đầu hoàn tất; test/mock AppState và
typing fetch cần cập nhật theo cache mới; hai cảnh báo hook dependencies; import/MUI prop sai
trong panel mới. Các test, typecheck, lint và build liên quan sau sửa đã đạt. Không nới timeout,
không bỏ test hoặc sửa expected balance để che lỗi.

Một lần lệnh smoke sai quoting đã chạy fallback loopback, không được tính là bằng chứng Postman;
lần chạy lại có biến process đúng và log GET thực mới được ghi nhận. Helper cục bộ lúc đầu parse
health text như JSON và có lỗi quote SQL khi bổ sung checkpoint; đã sửa và chạy lại đạt. Một lệnh
Start-Process cho Vite bị automatic review chặn không nêu lý do; chạy Vite bằng exec foreground
đã thành công, không thay đổi quyền hoặc bảo mật.

## Commit theo giai đoạn

| Hash                     | Subject                                                        | English description                                                     |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `93a9b2e`                | feat(sepay): validate sandbox access and guard testing context | Redacted connectivity check and server-side workspace isolation.        |
| `40500b5`                | feat(payment): bound tenant payment polling and share requests | Session cache, bounded focus polling and verified change notification.  |
| `3e1802d`                | feat(reconciliation): expose SePay receipt allocation details  | Receipt details and correct provider verification labels.               |
| `ce6bf7a`                | feat(payment): add Owner SePay sandbox testing workspace       | Registered invoice instructions and official simulator handoff.         |
| `ce5fe8b`                | fix(payment): hide cached QR during balance verification       | Suppress stale QR until server balance verification completes.          |
| Commit chứa biên bản này | docs(sepay): record sandbox validation and acceptance handoff  | Document actual API/polling evidence and remaining external acceptance. |

Không push/merge. Hash commit tài liệu cuối có thể lấy bằng `git log -1 --oneline` để không tự
ghi hash chưa tồn tại vào chính commit. Runtime API route inventory cũ chưa regenerate; bổ sung
route testing-context được mô tả riêng trong SEPAY.md, không suy diễn lại tổng endpoint.

## Acceptance bên ngoài — NOT RUN

Luồng đã nối: Tenant Invoice → instructions/VietQR nội bộ → link SePay Dashboard → HMAC
webhook/inbox → matcher/ledger allocation → payment projection → refresh Owner/Tenant.
Chỉ bước tạo giao dịch Dashboard và delivery/settlement cho đúng hóa đơn còn chưa được thực thi.

1. Mở `http://localhost:5173/`, đăng nhập Owner fixture bằng credential private, vào
   **Thanh toán → Webhook SePay → Kiểm thử SePay**. Chọn Location test, phòng SEPAY-101 và
   Invoice còn nợ; đối chiếu thông tin với `payment-test-instructions.txt`.
2. Trong SePay **Test Mode**, cấu hình webhook URL trên cho đúng tài khoản nhận, JSON, Tiền vào,
   HMAC-SHA256 và secret hiện có trong `.env.sepay.local`; bật retry. Chưa xác minh cấu hình
   Dashboard thực, nên không khẳng định bước này đã sẵn sàng chỉ từ public HTTP 401.
3. Mở simulator và nhập đúng tài khoản, 2.500.000 VND và mã BH hiện tại. Tuyệt đối không dùng
   ứng dụng ngân hàng thật để chuyển vào tài khoản Sandbox.
4. Quay lại BHOME; kiểm tra event, receipt, allocatedAmount, unallocatedAmount, payment history.
   Chỉ chấp nhận Paid khi server trả paidAmount=2500000, outstandingAmount=0 và có allocation.
5. Mở Mobile với Tenant fixture trên cùng API; xác nhận trạng thái cập nhật sau focus/foreground
   hoặc trong cửa sổ polling. Native/device và thao tác này chưa chạy trong phiên.
6. Replay **cùng giao dịch** bằng tính năng gửi lại webhook của SePay. Không tạo một transfer mới
   để kiểm tra duplicate. Xác nhận một tác động tiền, không thêm receipt/allocation trùng.
7. Thử missed webhook trên một Invoice test khác: để JOB-03 nhận qua API; kiểm tra cùng identity
   sau redelivery. Không xóa/sửa ledger hay reset mã BH để tái sử dụng hóa đơn đã thanh toán.
8. Exact/partial/overpayment, sai code/account, outgoing, HMAC sai, unknown payer, Invoice đã Paid,
   deposit và webhook/polling duplicate đã có regression local; acceptance qua provider thật còn
   NOT RUN. Không coi HTTP 200 ACK hoặc mở simulator là thanh toán thành công.

## BHOME SEPAY FINAL HANDOFF

```text
Branch: member/QHuy. Six functional/documentation commits; no push/merge.
Backend: running, Development, isolated loopback test DB; local ready 200.
Owner Web: running in API mode at http://localhost:5173/.
API: https://userapi-sandbox.sepay.vn/v2; bearer access verified with HTTP 200.
Webhook: POST /api/v1/integrations/sepay/webhook; public unsigned request rejected 401.
Owner context: GET /api/v1/integrations/sepay/testing-context; Test/nonproduction only.
Other routes: existing invoice payment/transfer-instructions, events, payment transactions/history/debts.
Environment: SePay__Enabled, Mode, ApiBaseUrl, ApiToken, WebhookSecret,
  PaymentCodePrefix, PollIntervalSeconds, ReceivingAccounts__0__LocationId/BankIdentifier/Gateway/AccountNumber.
Receiving binding: matched to active Sandbox account and demo receiving-bank-account version.
JOB-03: actual API polling observed, durable checkpoint persisted; two historical ManualReview events.
Invoice: synthetic Final, 2500000 VND; actual registered BH code and local PNG QR.
Settlement: Unpaid, paid 0, outstanding 2500000; no simulated matching transfer created.
External Dashboard simulation / signed webhook delivery / completed settlement: NOT RUN.
Next action: configure Dashboard HMAC and simulate using private payment-test-instructions.txt.
```
