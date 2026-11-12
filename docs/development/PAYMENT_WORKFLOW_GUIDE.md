# BH-25 — Thanh toán, công nợ và lịch sử

Luồng đã triển khai: Final Invoice của BH-21 → hướng dẫn chuyển khoản → Owner đối chiếu
sao kê và lưu giao dịch → xác nhận phân bổ → ledger PostgreSQL → cả ba Tenant cùng thấy Paid.
Không sửa số tiền hoặc dòng hóa đơn Final. Nhánh `member/QHuy`, chỉ commit local.
Nguồn và giới hạn quyết định: [BH25_TRACEABILITY](BH25_TRACEABILITY.md), SRS BF-06,
UC-22/23/25, GBR-01/02/10/13/18, DBR-08 và quyết định một hóa đơn/phòng/kỳ đã duyệt.
[API chi tiết](../api/PAYMENTS.md).

## Kiến trúc và dữ liệu

Tái sử dụng Identity/JWT, phân công Staff–Location hiện hành, Invoice/InvoiceRecipients,
immutable Final, DepositVerification, SecurityAudit, PostgreSQL/MinIO và clients hiện có.
Controller → PaymentService/TransferInstructionsService → IPaymentRepository → EF/PostgreSQL.
Owner Web dùng React Query; Tenant Mobile dùng workspace query/Expo Router.

| Migration                              | Thay đổi                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261101131328_InvoicePaymentLedger`  | PaymentTransfers, PaymentAllocations, PaymentReconciliations, BankReferenceClaims, PaymentCommands, PaymentConfirmedEvents; FK/index/check/append-only triggers |
| `20261101131954_ReceivingBankAccounts` | ReceivingBankAccounts: phiên bản cấu hình theo Location, Owner/time, enabled/demo; unique LocationId+Version, không ghi đè lịch sử                              |

Tiền dùng decimal nguyên VND; API trả chuỗi, UI định dạng VND. Unique provider+normalized
reference nhận diện giao dịch, unique TransferId bảo vệ allocation. BankReferenceClaims dùng
normalized reference toàn hệ thống vì cọc cũ không có provider; cùng giao dịch không được ghi
có cho cả cọc và hóa đơn. Migration backfill từ cọc, dừng nếu trùng sau chuẩn hóa, không xóa/hợp nhất.

Idempotency-Key + actor + operation lưu fingerprint/result trong DB. Giao dịch đối soát dùng
transaction, advisory lock chung, khóa transfer/phòng và kiểm tra lại Final/số dư/payer/reference.
DB trigger kiểm tra allocation và claim; rollback cả transaction khi xung đột. Ledger, quyết định
đối soát, cấu hình nhận tiền và event chống UPDATE/DELETE/TRUNCATE. Down migration chặn nếu
làm mất lịch sử. Không áp migration vào database của người dùng để chạy demo.

`PaidByUserId` là người trả đã được Owner xác minh, khác `VerifiedByUserId`. Có thể để chưa
xác định. Tenant khác chỉ thấy “Khách thuê khác trong hóa đơn”, không thấy tên, user ID, mã sao
kê hoặc tài khoản của người trả. Quyền xem dùng snapshot InvoiceRecipients, giữ nguyên sau khi
rời phòng. Staff chỉ đọc Room/kỳ/hạn/outstanding trong Location được phân công hiện tại.

## Cấu hình và khởi động

Yêu cầu .NET 8, Node 22, dependencies restore/install, Docker, image PostgreSQL/MinIO theo
`deploy/docker/compose.contract-demo.yml`. Chạy từ root trong PowerShell; đóng API demo đang
dùng output build trước khi rebuild. Không reset volumes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1
dotnet build src/backend/BHome.sln --no-restore -m:1 -nr:false
```

Initializer áp migration và chuẩn bị fixture Payment riêng trong database loopback
`bhome_contract_demo`, bucket `contract-demo`, chỉ Development/Testing. Không đụng database `bhome`.
Mở ba terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component Api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component OwnerWeb
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component MobileWeb
```

Sau khi sẵn sàng:

```powershell
node scripts/Seed-PaymentDemoWorkflow.cjs
node scripts/Test-PaymentDemo.cjs
```

Owner mặc định `http://localhost:5517`, API `http://localhost:5540`, Mobile Web
`http://localhost:5581` gọi HTTPS API `https://localhost:7540`. Thiết lập/trust chứng chỉ
development theo hướng dẫn Contract/Mobile hiện có. Browser smoke dùng Playwright đã cài ở
`.tools/contract-browser` hoặc dependency local, và Edge; có thể chọn executable bằng
`BHOME_TEST_BROWSER`. Không đưa Playwright vào dependencies production.

Nếu chạy cổng khác, cấu hình CORS/AuthWeb và client API tương ứng; đặt
`BHOME_PAYMENT_DEMO_API`, `BHOME_PAYMENT_DEMO_WEB`, `BHOME_PAYMENT_DEMO_MOBILE` cho scripts.
Phiên kiểm chứng này dùng API 5543/7543, Owner 5519, Mobile 5583 để giữ nguyên các tiến trình cũ.

Tài khoản tổng hợp: `owner.contract.demo@example.invalid`, `staff.contract.demo@example.invalid`,
`tenant1.contract.demo@example.invalid`, `tenant2.contract.demo@example.invalid`,
`tenant3.contract.demo@example.invalid`. Mật khẩu initializer sinh trong file local bị gitignore
`.tools/contract-demo/runtime.json`, trường `BHOME_DEV_TEST_PASSWORD`. Đọc tại máy để đăng nhập;
không commit/chia sẻ file, password hoặc token. Scripts không in thông tin đăng nhập.

Owner cấu hình tài khoản nhận ở **Thanh toán / Đối soát**, chọn Location và xác nhận thông tin.
BIN 6 số, account 6–19 số, chủ tài khoản ASCII hoa, trạng thái bật/tắt; expectedVersion chống
ghi đè cấu hình đồng thời. Đây là Owner kiểm tra cấu hình, chưa có API ngân hàng xác nhận chủ tài khoản.
Thiếu/disabled/demo account trong production trả trạng thái unavailable, không bịa QR.

QR tạo local bằng QRCoder 1.8.1 (MIT), không gửi dữ liệu tới dịch vụ QR ngoài. Cấu trúc TLV/CRC
được đối chiếu [vector VietQR Kit](https://www.vietqr.io/generate); PNG được giải mã độc lập bằng
OpenCV trong kiểm chứng developer. Amount quá 13 chữ số chỉ cung cấp InstructionsOnly, không
cắt số tiền. Reference dùng toàn bộ Invoice ID mã hóa base36, tối đa 25 ký tự.
Dependency [QRCoder](https://github.com/Shane32/QRCoder) phục vụ PNG đa nền tảng;
[expo-clipboard SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/clipboard/) phục vụ thao tác copy.

## Fixture và demo từng bước

Location riêng **BHOME PAYMENT DEMO**, GUID prefix `fa250000`; không thay dữ liệu Contract/Billing cũ.
Mỗi phòng có capacity 3, ba Contract cá nhân và một hóa đơn chung. Gia đình vẫn theo Contract
gia đình có người đại diện của luồng hiện có.

| Phòng          | Trạng thái khi seed                                | Mục đích                                              |
| -------------- | -------------------------------------------------- | ----------------------------------------------------- |
| PAY101-PAID    | Final tháng trước, đã phân bổ đủ bởi Tenant A      | A/B/C cùng Paid, một allocation                       |
| PAY102-UNPAID  | Final tháng trước, hạn cuối tháng hiện tại         | QR/copy, chưa quá hạn; giao dịch 100 đ PendingReview  |
| PAY103-OVERDUE | Final hai tháng trước, hạn cuối tháng trước        | Owner/Staff xem nợ quá hạn theo giờ Việt Nam          |
| PAY104-UI      | Final chưa trả khi tạo mới; Paid sau browser smoke | Thực hiện đối soát qua UI mà vẫn giữ mẫu Unpaid riêng |

Tổng mẫu **3.119.250 đ** = thuê 3.000.000 + điện 25,5×3.500 + nước 2×15.000.
Tài khoản `000000000000`, chủ tài khoản `BHOME SYNTHETIC DEMO` chỉ là dữ liệu tổng hợp;
không chuyển tiền thật. Contract ký Simulated, cọc yêu cầu 0, activation/signing/capture/billing
đều qua API hiện có. Không tạo callback ngân hàng giả. Lịch/giá quá khứ chỉ nằm trong seed cô lập.

1. Tenant A mở **Hóa đơn & Thanh toán**, chọn Final PAY102 hoặc PAY104 còn Unpaid.
   Xem số dư, hạn, tài khoản, QR. Copy số tiền/tài khoản/BIN/nội dung; QR chưa làm Paid.
2. Owner mở **Thanh toán / Đối soát**, chọn cơ sở, mở PAY104. **Ghi nhận giao dịch từ sao kê**:
   nguồn sao kê, mã giao dịch, tiền VND, ngày giờ Việt Nam, nội dung đúng reference, căn cứ và
   tham chiếu sao kê; đánh dấu tổng hợp khi demo và xác nhận đã đối chiếu.
3. Lưu giao dịch chỉ tạo PendingReview. Chọn người thực trả A đã xác minh hoặc chưa xác định;
   xác nhận đúng hóa đơn/người trả, bấm phân bổ và xác nhận dialog. Backend mới ghi allocation.
4. Tenant B/C tải lại hóa đơn: cùng Paid, còn 0 đ, lịch sử amount/date và nhãn payer đúng quyền;
   không còn QR/copy chuyển tiền. Owner xem lịch sử và số dư đã cập nhật.
5. Owner mở **Công nợ**, chọn Location và **Chỉ hóa đơn quá hạn**: PAY103 xuất hiện,
   PAY102 trước hạn không xuất hiện, Paid không nằm danh sách nợ. Không tính tiền phạt.
6. Nhập lại cùng reference/dữ liệu: trả giao dịch hiện có, không ghi có thêm. Chuyển khoản
   thứ hai sau Paid vẫn được lưu review; không xóa tiền thừa hoặc tự hoàn tiền.
7. Lịch sử Tenant chỉ theo recipient snapshot. Automated integration test kết thúc Contract
   trong fixture và kiểm tra vẫn đọc được kỳ cũ, người ngoài nhận 404. Demo không giả hoàn tất
   nghiệp vụ trả phòng/quyết toán; quy trình kết thúc tài chính đầy đủ thuộc BH-40.

Seed chạy lặp giữ Contract/Invoice/payment history hiện có, không đổi mật khẩu hoặc đưa Final
về Draft. File fixture và ảnh bằng chứng browser nằm trong `.tools/contract-demo`, bị gitignore.
Không dùng seed để làm mới dữ liệu sau quyết định tài chính thực tế hoặc chuyển tháng mà fixture
đã được thao tác; dùng môi trường demo cô lập mới nếu cần bộ kịch bản ban đầu.

## Ngân hàng, thông báo và chính sách còn chờ

- **SePay opt-in — 12/11/2026:** webhook HMAC, provider adapter và JOB-03 đã được triển khai.
  Mặc định tắt, giữ OwnerBankStatement xác minh thủ công theo sao kê. Credential, tài khoản
  Test Mode và public HTTPS cần cấu hình riêng theo [hướng dẫn SePay](../api/SEPAY.md).
- **Notification Integration Pending:** PaymentConfirmedEvents ghi bền vững cùng allocation,
  `payment.confirmed.v1`, key allocationId, contract `{allocationId, invoiceId, occurredAt}`.
  Module notification lấy Owner và InvoiceRecipients từ server, cần consumer/inbox delivery
  ledger riêng để deduplicate theo allocationId+recipient+channel. Chưa consume/deliver, không
  tuyên bố đã gửi in-app/push/email; không sửa worker/JOB-19. Lỗi delivery không rollback payment.
- **Business Decision Pending:** partial/excess, Tenant Credit, refund, allocation priority và
  điều chỉnh được duyệt. Hiện thiếu/thừa/sai reference/trùng cọc/đã Paid giữ PendingReview với
  lý do, không trừ dư nợ hoặc sửa Final. BH-41 hiện đã nối approved adjustments vào effective
  payable/debt/QR; xem [hướng dẫn điều chỉnh](INVOICE_ADJUSTMENT_WORKFLOW_GUIDE.md). Khoản
  thừa do điều chỉnh giảm sau Paid được giữ riêng PendingReview, chưa tự refund/credit.
- **Awaiting Tester:** formal ST/AT, thiết bị iOS/Android thực, app ngân hàng và chuyển khoản
  thực, hiệu năng tải và recovery chưa được kiểm chứng trong tác vụ này.

## Bằng chứng developer ngày 01/11/2026

| Kiểm tra đã chạy                                                                           | Kết quả                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Backend solution build output riêng                                                        | PASS, 0 warnings/errors                                                               |
| MigrationConsistencyTests: snapshot, target models và ownership migration                  | PASS 3/3, không có model drift                                                        |
| Backend non-Docker toàn bộ                                                                 | PASS 431: Application 173, Domain 77, Integration 181                                 |
| PostgreSQL/MinIO regression: PaymentLedger/CaptureWorkflow/InvoiceApi/ContractLifecycleApi | PASS 42/42 trước lần hardening cuối                                                   |
| PaymentLedger PostgreSQL sau hardening demo guard/filter/VND                               | PASS 11/11                                                                            |
| Owner Web tests                                                                            | PASS 79/79 sau kiểm tra refresh balance                                               |
| Owner build/typecheck/lint                                                                 | PASS                                                                                  |
| Mobile tests/typecheck/lint                                                                | PASS 237/237; typecheck/lint PASS                                                     |
| Expo export iOS + Android                                                                  | PASS; không phải native device run                                                    |
| PNG QR decode độc lập                                                                      | PASS, payload khớp tài khoản/amount/memo/CRC fixture                                  |
| Seed chạy lặp trên isolated DB                                                             | PASS, không thêm allocation trùng                                                     |
| Edge/Playwright UI gọi API thật                                                            | PASS: Owner reconcile/debt, Tenant QR/copy, A/B/C cùng Paid; không route interception |
| ST/AT chính thức, ngân hàng thật, native device, load/recovery                             | NOT RUN                                                                               |

Lệnh kiểm chứng có thể lặp từ root (dùng output riêng để tránh khóa DLL API đang chạy):

```powershell
dotnet build src/backend/BHome.sln --artifacts-path .tools/bh25-checks --no-restore -m:1 -nr:false
dotnet test src/backend/BHome.sln --artifacts-path .tools/bh25-checks --no-restore --filter 'Category!=Docker'
dotnet test tests/backend/BHome.IntegrationTests --artifacts-path .tools/bh25-checks --no-restore --filter 'FullyQualifiedName~PaymentLedgerTests'
npm.cmd --prefix src/owner-web test
npm.cmd --prefix src/owner-web run build
npm.cmd --prefix src/owner-web run lint
npm.cmd --prefix src/mobile test
npm.cmd --prefix src/mobile run typecheck
npm.cmd --prefix src/mobile run lint
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Export-ContractDemoMobile.ps1
```

Logs `.tools/bh25-*.log`, ảnh `payment-owner-reconciled.png`, `payment-owner-debt.png`,
`payment-tenant-qr.png`, `payment-tenant-shared-paid.png` và `payment-browser-results.json`
được giữ local. Đây là evidence developer với dữ liệu tổng hợp, không thay thế sign-off Tester.
