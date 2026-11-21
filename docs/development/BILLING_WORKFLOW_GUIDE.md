# BH-21 luồng ghi chỉ số và hóa đơn

Đã triển khai thao tác Owner cấu hình → Staff xác nhận → Owner tạo/cập nhật Draft →
Owner phát hành → Tenant xem hóa đơn. API và PostgreSQL quyết định trạng thái/số tiền;
OCR chỉ đề xuất. [API](../api/INVOICES.md) và [quyết định nghiệp vụ](BH21_TRACEABILITY.md)
ghi đầy đủ phạm vi. Nhánh `member/QHuy`; chỉ có commit local, không push/merge/deploy.

## Khởi động demo riêng

Yêu cầu .NET 8, Node 22, dependencies đã restore/install, Docker và image MinIO theo
`deploy/docker/compose.contract-demo.yml`. Các lệnh dưới chạy từ root bằng PowerShell.
Đóng tiến trình API demo đang dùng output build trước khi rebuild. Không reset volume.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1
dotnet build src/backend/BHome.sln --no-restore -m:1 -nr:false
```

Mở ba terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component Api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component OwnerWeb
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component MobileWeb
```

Sau khi các service sẵn sàng:

```powershell
node scripts/Seed-InvoiceDemoWorkflow.cjs
node scripts/Test-InvoiceDemo.cjs
```

Owner Web mặc định `http://localhost:5517`, API `http://localhost:5540`, Mobile Web
`http://localhost:5581` gọi HTTPS API `https://localhost:7540`. Dùng certificate local
đã thiết lập theo hướng dẫn Contract/Mobile của repo. Bootstrap và browser smoke chỉ
cho localhost, database `bhome_contract_demo`; không dùng database `bhome`.

Tài khoản tổng hợp: `owner.contract.demo@example.invalid`, `staff.contract.demo@example.invalid`,
`tenant1.contract.demo@example.invalid`, `tenant2.contract.demo@example.invalid`.
Mật khẩu do initializer sinh, lưu cục bộ trong `.tools/contract-demo/runtime.json`;
không commit/chia sẻ file đó, token hoặc ảnh riêng tư. Script không in password/token.
Contract demo dùng **Simulated**, cọc yêu cầu 0; không giả lập một giao dịch ngân hàng
hay chữ ký pháp lý thành công. Chỉ kích hoạt qua signing/readiness API hiện có.

## Dữ liệu và thao tác

| Phòng       | Seed qua API                                                                            | Mục đích                                  |
| ----------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| P105-BILL   | Hai hợp đồng cá nhân Active, điện 100→125,5; nước 100→102; Final tháng trước            | Xem hóa đơn đã phát hành                  |
| P106-DRAFT  | Hai hợp đồng Active, baseline đã xác nhận; task periodic đang chờ; Draft tháng hiện tại | Staff chụp/nhập tay, Owner cập nhật nháp  |
| P107-REVIEW | Hai hợp đồng Active, đủ readings tháng trước; Draft đủ input                            | Owner kiểm tra và phát hành qua giao diện |

Mỗi phòng có capacity 2. Khách family vẫn có thể nằm trong một Contract nhiều residents.
Owner chọn hợp đồng đại diện phòng khi lập hóa đơn; chỉ lấy một tiền thuê phòng theo
cấu hình, không cộng tiền thuê của mọi hợp đồng. Các Tenant trong kỳ cùng xem một bill.

1. Owner mở **Giá thuê & Chính sách phí**, chọn cơ sở BHOME CONTRACT DEMO. Xem/lưu lịch
   và quy tắc bắt buộc; xem giá, tạo policy hoặc phiên bản kế tiếp qua Property API hiện có.
   Giá mới chỉ có hiệu lực từ hôm nay; không ghi đè giá đã dùng hoặc tạo giá hồi tố.
2. Staff đăng nhập Mobile, mở **Điện nước**. Chọn P106-DRAFT, chụp ảnh, dùng OCR nếu có
   hoặc nhập tay, đối chiếu và xác nhận. Ảnh bắt buộc, kể cả nhập tay. Kết quả hiển thị
   previous/current/consumption do server trả; mở **Tất cả** để xem lại kết quả đã lưu.
3. Owner mở **Hóa đơn**, chọn cơ sở/phòng/tháng/hợp đồng đại diện, **Tạo / mở bản nháp**.
   Nếu đã có bill cùng phòng/kỳ thì mở lại, không tạo trùng. Đọc các khoản còn thiếu.
4. Sau khi Staff bổ sung đủ input, **Cập nhật đầu vào bản nháp** rồi kiểm tra chi tiết.
   Chọn P107-REVIEW để phát hành ngay khi đến mốc cấu hình. Bấm **Phát hành hóa đơn**,
   xem số tiền và xác nhận. Backend revalidate; input thay đổi yêu cầu refresh/review lại.
5. Tenant1 hoặc Tenant2 mở **Hóa đơn & Thanh toán** → **Xem hóa đơn**. Kiểm tra phòng,
   kỳ, chỉ số/tiêu thụ, giá và từng khoản. UI không hiện Paid khi chưa có payment ledger.
   Snapshot recipient giữ quyền xem kỳ đã ở, không mở bill cũ cho khách mới.

Giá tổng hợp: thuê 3.000.000 đ, điện 3.500 đ/kWh ×25,5, nước 15.000 đ/m³ ×2;
tổng chính thức **3.119.250 đ**. Đây là dữ liệu demo, không phải kết quả ngân hàng.
Seed chạy lặp không sửa/xóa lịch sử hay đổi mật khẩu; không đưa Final trở về Draft.
Sau browser smoke, P107-REVIEW đã Final; chạy lại kiểm tra trạng thái đã lưu.

## Persistence và API

- Migration `20261101121951_RoomInvoiceDrafts`: BillingSchedules, Invoices, InvoiceLines,
  InvoiceRecipients; unique Room + BillingPeriod; snapshots giá/lịch/chỉ số/recipient;
  thay unique Active Contract/Room bằng index và deferred occupancy/capacity triggers.
- Migration `20261101122940_ImmutableFinalInvoices`: DB bảo vệ Final/lines/recipients,
  kiểm tổng tiền, cấm xóa/truncate lịch sử. Rollback bị chặn khi làm mất billing/shared-tenancy data.
- Location advisory lock dùng chung với Property configuration; Room row lock dùng chung
  với Contract. Không estimate official consumption; readings phải confirmed, có ảnh linked,
  đúng kỳ và baseline hợp lệ. Policy.RecordUsage cùng transaction snapshot hóa đơn.
- Human confirmation trả timestamp theo microsecond PostgreSQL để kết quả đầu/reload/replay khớp.
- Chỉ Owner mutate billing; Tenant read theo persisted recipient; Staff không đọc tài chính.
  Payment, allocation, điều chỉnh sau Final phải đi qua module tương ứng, không sửa bill gốc.

## Kiểm chứng thực hiện ngày 01/11/2026

| Kiểm tra                                                                            | Kết quả thực thi                                                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Backend solution build (output riêng `.tools/bh21-build` / `.tools/bh21-checks`)    | PASS, 0 warnings/errors                                                                                                           |
| `dotnet test ... --filter 'Category!=Docker'`                                       | PASS: Application 173, Domain 69, Integration 180; tổng 422                                                                       |
| Docker PG/MinIO: InvoiceApiTests + CaptureWorkflowTests + ContractLifecycleApiTests | PASS 32/32 sau sửa timestamp; gồm concurrency, missing input, immutable DB, scoped/history access, ảnh private và storage failure |
| Owner Web test                                                                      | PASS 74/74                                                                                                                        |
| Mobile test                                                                         | PASS 236/236                                                                                                                      |
| Owner build/typecheck/lint, Mobile typecheck/lint                                   | PASS                                                                                                                              |
| Expo export iOS/Android                                                             | PASS; không phải chạy camera trên thiết bị thật                                                                                   |
| Seed Development và API bootstrap chạy lặp                                          | PASS; giữ nguyên bill/history và dữ liệu Contract demo cũ                                                                         |
| Browser thật, không mock API                                                        | PASS Owner cấu hình, review/phát hành; Tenant đọc chi tiết; Staff đọc lại confirmed result; 0 page runtime errors                 |

Lệnh Docker tái hiện:

```powershell
dotnet test tests/backend/BHome.IntegrationTests --filter "FullyQualifiedName~InvoiceApiTests|FullyQualifiedName~CaptureWorkflowTests|FullyQualifiedName~ContractLifecycleApiTests" -m:1 -nr:false
npm.cmd run test --workspace ./src/owner-web
npm.cmd run test --workspace ./src/mobile
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Export-ContractDemoMobile.ps1
```

Trong phiên này dùng API 5542/HTTPS 7542, Owner 5518, Mobile 5582 để giữ API demo cũ
đang chạy. Các biến `BHOME_INVOICE_DEMO_API`, `BHOME_INVOICE_DEMO_WEB`,
`BHOME_INVOICE_DEMO_MOBILE` cho phép script smoke chọn các URL localhost này.
Kết quả JSON và screenshot tổng hợp ở `.tools/contract-demo/invoice-*`; không đưa vào Git.

Các lỗi ban đầu đã xử lý: phân công Staff commit transaction hai lần; query chưa có
schedule trả 204 cần chuyển thành null cho React Query; tracking dòng mới khi refresh;
so sánh giá trị decimal theo số thay cho JSON có scale khác nhau; timestamp .NET/PG.
Full build thường ban đầu bị API cũ khóa DLL, nên dùng output riêng; test Mobile ban đầu
chạy nhầm Node hệ thống gây lỗi startup test, đã chạy lại bằng Node 22 của repository.

## Giới hạn còn lại

- Chưa triển khai scheduler JOB-09/JOB-10 hay billing push/email/in-app notification chung;
  luồng giao diện hiện là Owner tạo/phát hành thủ công, có chặn ngày theo schedule.
- Chưa có Payment/InvoiceAdjustment/settlement ledger. Không có Paid, tự cộng tiền cọc,
  chia nghĩa vụ theo đầu người, tự hoàn tiền hoặc tự sửa Final.
- Rate áp dụng một mốc đầu/cuối kỳ do Owner chọn; chưa chia đa mức giá trong tháng,
  bậc thang, reset/replacement meter hay phân bổ consumption giữa tenancy. Trường hợp
  thiếu/gãy baseline hoặc nhiều meter trong kỳ giữ Draft để review.
- Đại diện được chọn và lưu trên từng hóa đơn; chưa có màn thay đại diện phòng riêng
  theo ngày. Đổi đại diện cho một bill đã tạo bị chặn để tránh đổi nghĩa vụ âm thầm.
- Camera thật Android/iOS, OCR accuracy, provider/bank/push thật, performance, System
  Testing và Acceptance Testing chuyên trách: **NOT RUN**. Export/browser/API tests
  không thay thế nghiệm thu các phạm vi đó. Chưa áp migration lên database `bhome`.
