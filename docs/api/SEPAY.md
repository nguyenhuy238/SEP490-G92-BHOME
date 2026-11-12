# Tích hợp SePay và hướng dẫn Test Mode

BHOME nhận webhook SePay qua `POST /api/v1/integrations/sepay/webhook`. Endpoint dùng HMAC-SHA256 và raw body. Backend lưu inbox bền vững trước khi xử lý receipt, allocation và payment event trong ledger Compact24. Phạm vi truy vết gồm BF-06, UC-22/23/25, GBR-10/18, DBR-08, JOB-03 và API-01.

## Contract và phân quyền

| Thành phần           | Giá trị được triển khai                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Webhook              | `POST /api/v1/integrations/sepay/webhook`                                                                                          |
| Content type         | `application/json`, tối đa 32 KiB                                                                                                  |
| Xác thực             | `X-SePay-Signature` và `X-SePay-Timestamp`, cửa sổ mặc định 300 giây                                                               |
| Chuỗi được ký        | `{timestamp}.{raw_body}`, HMAC-SHA256 và constant-time comparison                                                                  |
| ACK                  | HTTP 200, `{"success":true}` sau durable ingestion và xử lý thành công hoặc phân loại review/ignored                               |
| Lỗi                  | 401 cho xác thực sai, 400 cho payload sai, 409 cho identity conflict, 413/415 cho kích thước/content type, 503 khi integration tắt |
| Lỗi xử lý kỹ thuật   | HTTP lỗi, inbox và job đã nhận được giữ lại để retry                                                                               |
| Owner event list     | `GET /api/v1/integrations/sepay/events?page=1&pageSize=20`, Owner JWT                                                              |
| Event DTO            | `id, mode, status, reason, transferId, receivedAt`                                                                                 |
| Invoice QR           | `GET /api/v1/invoices/{id}/transfer-instructions`, Owner hoặc Tenant có entitlement                                                |
| Invoice status       | `GET /api/v1/invoices/{id}/payment`                                                                                                |
| Deposit code         | `GET /api/v1/contracts/{id}/deposit-payment`, Owner                                                                                |
| Receipt/evidence     | API payment-transactions và reconciliation-history hiện có, Owner                                                                  |
| Payment history/debt | API payment-history/debts hiện có với quyền và snapshot Tenant hiện hành                                                           |

SePay payload được đọc gồm `id`, `gateway`, `transactionDate`, `accountNumber`, `subAccount`, `code`, `content`, `transferType`, `transferAmount`, `referenceCode`, `description`, `accumulated`. Payer được giữ trống. Thông tin mã/thời điểm/tài khoản nhận không xác minh danh tính người chuyển.

Owner Web có tab **Webhook SePay** tại trang Thanh toán, hiển thị inbox và lý do cần xem xét. Receipt liên kết mở màn hình đối soát hiện có. API event list loại số tài khoản, raw payload và credential khỏi response. Tenant Mobile tiếp tục nhận QR và payment status qua API hiện có.

Inbox giữ quyết định của lần xử lý provider. Kết quả xử lý thủ công sau đó được đọc từ receipt liên kết; số dư và lịch sử thanh toán luôn lấy từ ledger.

## Cấu hình Backend

Các biến môi trường dùng dấu `__`. File `.env.example` chứa mẫu placeholder. File cấu hình riêng như `.env.sepay.local` được Git ignore.

| Biến                                          | Giá trị hoặc nguồn                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SePay__Enabled`                              | `true` để bật, mặc định `false`                                                                 |
| `SePay__Mode`                                 | `Test` cho ASP.NET environment Development/Testing, `Live` cho environment triển khai tương ứng |
| `SePay__ApiBaseUrl`                           | Test dùng `https://userapi-sandbox.sepay.vn/v2`, Live dùng `https://userapi.sepay.vn/v2`        |
| `SePay__ApiToken`                             | Token API Access của đúng môi trường, optional cho polling, private                             |
| `SePay__WebhookSecret`                        | Secret ngẫu nhiên ít nhất 32 ký tự, cùng giá trị tại SePay, private                             |
| `SePay__WebhookPath`                          | Giá trị cố định `/api/v1/integrations/sepay/webhook`                                            |
| `SePay__PaymentCodePrefix`                    | Giá trị được hỗ trợ `BH`                                                                        |
| `SePay__RequestTimeoutSeconds`                | Mặc định `15`, khoảng 1–30                                                                      |
| `SePay__SignatureToleranceSeconds`            | Mặc định `300`, khoảng 1–300                                                                    |
| `SePay__PollIntervalSeconds`                  | Mặc định `60`, khoảng 30–3600                                                                   |
| `SePay__ReceivingAccounts__0__LocationId`     | GUID Location thử nghiệm                                                                        |
| `SePay__ReceivingAccounts__0__BankIdentifier` | BIN ngân hàng, 6 chữ số                                                                         |
| `SePay__ReceivingAccounts__0__Gateway`        | Tên `gateway` thực tế do SePay gửi                                                              |
| `SePay__ReceivingAccounts__0__AccountNumber`  | Số tài khoản Test Mode, private trong hướng dẫn chia sẻ                                         |

Thêm phần tử `__1__`, `__2__` cho các Location khác. Binding này phải khớp receiving-bank-account version đang enabled trong DB của Location. Test yêu cầu receiving account và Contract liên quan mang `isDevelopmentDemo=true`. Mỗi môi trường dùng secret/token và dữ liệu riêng. Payload webhook không có trường môi trường đáng tin cậy để tự xác định Test/Live, nên Backend kiểm tra qua credential, host API, binding và marker nguồn/nghĩa vụ.

`BankIntegration:ApiKey` cũ không được dùng làm credential SePay. WebhookSecret và ApiToken có chức năng riêng. Chỉ webhook và retry cần secret. Polling còn cần token API.

## Database và tính nhất quán

Migration `20261112000100_SePayIntegration` giữ 24 bảng. Registry dùng COMMAND records trong operational_tasks vì JSONB payment_requests phân tán trên các Invoice không bảo đảm uniqueness giữa Invoice và deposit. Unique indexes bảo vệ code và obligation. Trigger bảo vệ mapping bất biến và bằng chứng provider. Cột allocation creator cho phép null với source AUTO SePay có bằng chứng hợp lệ, thể hiện actor provider riêng.

Mã mới có dạng `BH` cộng 8 chữ số ngẫu nhiên, ví dụ hình thức `BH12345678`. Mã được phát một lần cho obligation trong môi trường tương ứng, không tái sử dụng cho obligation khác. GUID và reference lịch sử được giữ. Owner vẫn có thể đối soát reference cũ. Automatic matcher chỉ nhận BH code đã đăng ký và một nghĩa vụ xác định.

Receipt identity dùng mode, gateway, receiving account và bank reference. Inbox còn giữ provider ID. Cách này xử lý việc webhook có ID số trong khi API v2 có UUID. Cùng bank reference chỉ có một receipt và financial effect. Partial giữ dư nợ. Excess nằm trên receipt, cần quy trình hoàn tiền hiện có. Receipt cho Invoice đã đủ tiền hoặc mã chưa xác định giữ PendingReview. Tiền ra và tài khoản ngoài binding được ghi nhận với lý do, không phân bổ.

Nếu bank reference đã có trong sao kê thủ công chưa có account scope, callback ở lại inbox với lý do cần Owner đối chiếu. Nhập thủ công một reference đã được provider ghi nhận trả 409 và yêu cầu dùng receipt hiện có. Native guard bảo vệ cả nhánh xác minh cọc trực tiếp khỏi tác động tiền trùng giữa manual và provider.

Owner chỉ định actual payer bằng bằng chứng theo workflow hiện có. Khoản hoàn có payer chưa xác định tiếp tục cần Owner đối chiếu. Đăng ký cọc không tự kích hoạt Contract hoặc đổi Room thành Occupied.

JOB-03 tái sử dụng worker, lease và backoff hiện có, tối đa 4 lần. Event lỗi kỹ thuật sau giới hạn xuất hiện trong Owner event list với lý do `sepay_technical_retry_exhausted`. Resend từ SePay có thể xử lý lại inbox sau khi sửa nguyên nhân. Unknown code là manual review terminal.

SePay worker chạy riêng khi `Jobs:Enabled=false`, chỉ xử lý SePay jobs. Khi worker tổng quát bật, cùng các handler đó xử lý qua queue chung. Polling tùy chọn lưu page/candidate ID và chỉ nâng since_id sau trang cuối. Thời điểm giao dịch không offset dùng Asia/Ho_Chi_Minh, timestamp lưu UTC.

## Khởi động trên Windows PowerShell

Chuẩn bị PostgreSQL test và MinIO theo hướng dẫn local của repository. Với EF tooling hiện có, database thử nghiệm phải mang tên `bhome_compact24_` cộng 32 ký tự hex. `BHOME_COMPACT24_DIRECT` phải chứa connection string private tới database đó. `ConnectionStrings__Database` trong file chạy API phải trỏ cùng database.

```powershell
Copy-Item .env.example .env.sepay.local
git check-ignore .env.sepay.local

# Điền cấu hình local và SePay riêng tư trong file vừa tạo.
# Cấp BHOME_COMPACT24_DIRECT qua môi trường riêng tư của shell.
dotnet tool restore
dotnet ef migrations script --idempotent --context Compact24DbContext `
  --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api `
  --configuration Release --output .tools/sepay-migrations.sql

# Sau khi kiểm tra script trên database thử nghiệm đã chọn.
dotnet ef database update --context Compact24DbContext `
  --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api `
  --configuration Release

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 `
  -EnvironmentFile .env.sepay.local
```

Kiểm tra trên cửa sổ PowerShell khác với chứng chỉ local đã được trust.

```powershell
curl.exe --fail https://localhost:7240/health/live
curl.exe --fail https://localhost:7240/health/ready

# Probe không có chữ ký. Khi SePay đã bật, kết quả mong đợi là 401.
curl.exe -i -X POST https://localhost:7240/api/v1/integrations/sepay/webhook `
  -H 'Content-Type: application/json' --data '{}'
```

Database guard, migration và route được kiểm tra bằng test riêng. Việc áp dụng migration vào database làm việc và cấu hình credential là bước vận hành cần thực hiện trên môi trường test đã chọn.

## HTTPS tunnel và Dashboard

Sau khi cài đặt và cấu hình ngrok, có thể forward tới binding HTTPS local.

```powershell
ngrok http https://localhost:7240
```

Lấy hostname HTTPS thực tế từ output ngrok. Thêm hostname vào `AllowedHosts` của profile test và khởi động lại API. Kiểm tra `{PUBLIC_HTTPS_BASE_URL}/health/live`, rồi probe POST không chữ ký như trên qua public hostname. Public Webhook URL bằng hostname thực tế cộng `/api/v1/integrations/sepay/webhook`.

| Trường Dashboard Test Mode  | Giá trị cần dùng                                                           |
| --------------------------- | -------------------------------------------------------------------------- |
| Tên                         | `BHOME Test Mode`, tên đề xuất                                             |
| URL                         | `{PUBLIC_HTTPS_BASE_URL}/api/v1/integrations/sepay/webhook`                |
| Loại giao dịch              | Tiền vào                                                                   |
| Định dạng                   | JSON, application/json                                                     |
| Tài khoản                   | Tài khoản Test Mode khớp binding và DB receiving account                   |
| Dùng để xác thực thanh toán | Bật                                                                        |
| Xác thực                    | HMAC-SHA256                                                                |
| Secret Key                  | Cùng secret đã cấu hình riêng trong Backend                                |
| Nhận diện mã                | Bật                                                                        |
| Prefix                      | `BH`                                                                       |
| Hậu tố tối thiểu/tối đa     | `8` / `8`                                                                  |
| Loại ký tự                  | Số nguyên                                                                  |
| Chỉ gửi khi có mã           | Có thể bật cho kiểm thử mã hợp lệ. Tắt khi kiểm thử unknown/no-code review |
| Lọc tiền tố                 | `BH` khi kiểm thử mã hợp lệ                                                |
| Retry khi HTTP ngoài 2xx    | Bật                                                                        |
| API Access                  | Tạo token Test Mode nếu cần polling                                        |

## Một kịch bản SePay Test Mode

1. Tạo bank account Test Mode với dữ liệu tổng hợp. Cấu hình cùng account/BIN/Location trong Backend và receiving account API Owner.
2. Chuẩn bị Invoice Final trong database test, Contract và receiving account có marker demo. Tenant cần có Invoice entitlement.
3. Dùng Tenant hoặc Owner gọi transfer-instructions. Lấy đúng `transferDescription`/`transferReference` BH đã được lưu và `outstandingAmount` hiện hành.
4. Trong SePay Test Mode, tạo giao dịch mô phỏng Tiền vào trên đúng account, số tiền bằng outstanding và nội dung chứa nguyên mã BH. Cấu hình webhook phải có public URL và HMAC khớp.
5. Kiểm tra delivery log của SePay, HTTP 200 và `success:true`. Nếu HTTP lỗi, xem correlation và mã lỗi Backend, đồng thời giữ inbox để retry.
6. Owner Web mở Thanh toán → Webhook SePay, rồi mở receipt. Kiểm tra source SePayTest, reference sao kê, quyết định và số đã/chưa phân bổ.
7. Tenant Mobile refresh Invoice. Kiểm tra paymentStatus, paidAmount, outstandingAmount và payment history. Các Tenant cùng entitlement phải nhận cùng số dư.
8. Replay sự kiện. Receipt/allocation/event tiền không tăng lần hai. Thử thêm partial, excess, code sai, account sai và tiền ra trong dữ liệu test riêng.

Các GET kiểm chứng gồm `/api/v1/invoices/{id}/payment`, `/api/v1/payment-history`, `/api/v1/debts` và `/api/v1/integrations/sepay/events`. Truy vấn PostgreSQL chỉ cần lấy totals/status của payments, payment_allocations và technical jobs. Tránh xuất raw payload, tài khoản nhận hoặc credential trong báo cáo chia sẻ.

## Kiểm thử provider nội bộ

Postman CLI có thể chạy simulation đã commit bằng dữ liệu tổng hợp.

```powershell
postman simulation run postman/simulations/sepay/sepay.sim.yaml `
  --port 4511 --output ndjson --no-history
```

Trên shell khác, chạy adapter smoke test qua mock HTTP đó.

```powershell
$env:BHOME_SEPAY_SIMULATION_URL = 'http://127.0.0.1:4511/sepay/v2/'
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj `
  -c Release --filter FullyQualifiedName~ProviderContractSmokeCanUseTheLocalPostmanSimulation
Remove-Item Env:BHOME_SEPAY_SIMULATION_URL
```

Các test PostgreSQL dùng biến `BHOME_COMPACT24_TEST_ADMIN` theo convention test của repository và tạo database riêng cho từng fixture. Simulation chỉ xác lập hành vi của HTTP adapter trên contract fixture. SePay account, public TLS và delivery thực tế vẫn cần kiểm tra theo các bước Dashboard.

Nguồn provider gồm [xác thực webhook](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc), [webhook Test Mode](https://developer.sepay.vn/vi/tien-ich-khac/test-mode/tao-webhook), [API Access Test Mode](https://developer.sepay.vn/vi/tien-ich-khac/test-mode/api-access) và [danh sách giao dịch v2](https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach).
