# Owner Web — hoàn cọc theo thỏa thuận hợp đồng

Traceability: BR-30, BF-04/06, UC-19/25, GBR-01/02/10/18; JOB-04 cho thông báo sau commit. Người nhận Security Deposit theo thỏa thuận hợp đồng, Owner xác nhận. Receipt excess giữ actual-payer rule.

## Phạm vi kiểm thử

`DepositAgreementBrowserTests.OwnerBrowserCompletesAgreedRecipientRefundThroughRealApiAndPersistence` tạo PostgreSQL dùng một lần qua Compact24Fixture. Backend ASP.NET chạy trong WebApplicationFactory; loopback HTTP bridge chỉ chuyển tiếp request/response cho trình duyệt, không mock route hoặc thay quyết định nghiệp vụ. Owner Web dùng Vite và Edge/Chromium thật qua Playwright đã có trong repository.

Preconditions được seed bằng dữ liệu tổng hợp: shared Contract đang Active, ba người ở/tài khoản, hóa đơn đã được thanh toán, biên bản kiểm tra được Owner xác nhận, nguồn cọc đã xác minh 400.000đ. Đây không phải kiểm chứng các bước tạo/ký/kích hoạt Contract hoặc chuyển tiền ngân hàng. Object storage là substitute của integration fixture, chưa phải MinIO/provider acceptance.

Trình duyệt đăng nhập qua form, mở Contract hiện có, chọn người nhận khác đại diện, kiểm tra các xác nhận bắt buộc, lập và duyệt yêu cầu. Sau đó nhập thời gian hoàn thực tế với độ chính xác mili giây hiện có, tải ảnh tổng hợp, xác nhận thực hiện, tải lại trang và tải chứng từ riêng tư; so sánh byte tải xuống với ảnh đã gửi. Không chèn token vào localStorage hoặc giả response tài chính.

Phần backend kiểm tra row COMPLETED, số tiền, beneficiary khác representative, basis CONTRACT_AGREEMENT_OWNER_CONFIRMED, Contract/source reference, proof, lịch sử Tenant đúng người nhận và thông báo đúng beneficiary. Không có browser error. Database dùng một lần được fixture xóa sau test, Vite/browser/bridge dừng trong finally. Không sửa database làm việc hoặc cấu hình demo cũ.

## Chạy local

Yêu cầu Node 22, dependencies đã restore, trình duyệt cài sẵn, backend Release build. Cấu hình các biến môi trường cho riêng process chạy test:

- `BHOME_COMPACT24_TEST_ADMIN`: PostgreSQL admin được phép tạo database dùng một lần, loopback và database `postgres`. Không dùng database nghiệp vụ.
- `BHOME_RUN_BROWSER_E2E=true`: opt in; mặc định suite bỏ qua bài này.
- `BHOME_TEST_NODE`: đường dẫn executable Node 22 nếu khác `.tools/node-v22.23.4-win-x64/node.exe`.
- `BHOME_TEST_BROWSER`: đường dẫn Chromium/Edge executable nếu khác đường dẫn Edge Windows mặc định.

```powershell
dotnet build tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --configuration Release --no-incremental
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --configuration Release --no-build --settings tests/backend/ci.runsettings --filter FullyQualifiedName~DepositAgreementBrowserTests
```

Artifacts nằm trong `.tools/browser-deposit-<guid>`: screenshot, kết quả và runner log; cấu hình có mật khẩu tài khoản synthetic, không commit hoặc publish thư mục. Backend test tạo fixture/config, không chạy script Node trực tiếp bằng dữ liệu tùy ý. Vite phải được resolve từ Owner workspace để khớp plugin, không dùng bản của root Vitest.

## Giới hạn

Đây là acceptance trình duyệt của một luồng Owner Web trên local. Chưa chứng minh Tenant Mobile UI, Android/iOS, real bank payout, MySign, SMTP/SMS, MinIO hoặc GitHub Actions. Receiver ngoài cohort/external, adjustment/reversal và các luồng E2E khác vẫn cần thực hiện. Các failed attempts của runner phải được giữ là FAIL, không cộng vào số PASS.
