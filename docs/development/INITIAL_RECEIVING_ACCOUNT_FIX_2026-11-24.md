# Tài khoản nhận tiền và QR thanh toán ban đầu — 24/11/2026

## Nguyên nhân và truy vết

BF-06 / UC-22 / GBR-10, GBR-18; đối chiếu `AGENTS.md`, `MainInitialPayments`, `HoldingTestScope`, cấu hình SePay và tài khoản Owner thực tế trên Staging.

Tài khoản chung của Owner đã lưu, đang bật, và khớp ngân hàng/số tài khoản SePay. API theo Location đọc đúng tài khoản này. Lỗi không nằm ở việc lưu tài khoản: hợp đồng mới chưa có `PaymentMode`, vì scope Test chỉ nhận database loopback hoặc Neon đã cấu hình, trong khi Staging dùng Docker DNS `postgres`. Chế độ trống bị suy ra Live, không khớp SePay Test. Ngoài ra, nhánh tương thích hợp đồng cũ đã tính `roomScopeMode=Test` nhưng lại kiểm tra tài khoản đơn lẻ theo chế độ suy ra của Contract.

API vẫn trả HTTP 200 với `availability=ReceivingAccountUnavailable`, khiến Mobile hiển thị “chưa có tài khoản” dù tài khoản tồn tại.

## Thay đổi

- `HoldingTestScope`: nhận Docker hostname chính xác `postgres` chỉ khi host environment và Deployment anchor đều Staging; vẫn bắt buộc SePay Test hợp lệ và database có tên `bhome_compact24_dev_<32 hex>`. Production, database `bhome`, hostname tùy ý và anchor sai bị từ chối.
- `MainInitialPayments`: dùng nhất quán chế độ đã xác định cho chu kỳ thanh toán khi kiểm tra tài khoản và trả DTO. GET không tự đánh dấu đã thanh toán.
- Khi người dùng yêu cầu cấp QR, chỉ hợp đồng **chưa khai báo PaymentMode**, trong scope Test hợp lệ, tài khoản khớp SePay và chưa có allocation, mới được gắn rõ `PaymentMode=Test`; lưu audit `MainInitialSandboxPaymentModeResolved` trong giao dịch hiện hữu. Không đổi chế độ ký, snapshot điều khoản hoặc chữ ký. Không chuyển hợp đồng explicit Live sang Test.
- Mobile mô tả tài khoản “chưa sẵn sàng” và cần kiểm tra tài khoản/kết nối SePay, thay vì khẳng định chưa cấu hình.
- Không đổi endpoint/DTO/schema, công thức tiền, xác thực webhook, điều kiện ký hoặc Owner kích hoạt. Ledger vẫn chỉ nhận receipt đúng chế độ và giữ chống phân bổ trùng.

## Kiểm chứng cục bộ

- Infrastructure unit `HoldingTestScopeTests`: **7/7 PASS**, không skip; gồm Staging Docker, loopback và các trường hợp Production/sai anchor/DB/host/tắt SePay.
- Integration trên PostgreSQL tạm cổng loopback 55481, database do fixture tạo và xóa: **3/3 PASS**, không skip; test `MainInitialQrUsesOneReceiptForDepositAndRentFeesAndRejectsPartialOrDuplicateEffects` cho cả ký mô phỏng và ký nội bộ với PaymentMode cũ trống, cộng test tài khoản Owner dùng chung/isolated. Kiểm tra QR/code lặp, thiếu tiền, callback trùng, xung đột mode và snapshot. Fixtures email đã đổi sang giá trị tổng hợp duy nhất để hai nhánh theory không trùng unique index.
- Mobile `main-initial-payment.test.tsx`: **5/5 PASS**.
- Build API Release: **PASS**, 0 warnings/errors.
- Evidence: `.tools/receiving-account-demo-20261124/receiving-scope.trx` và `receiving-initial-payment.trx`.

Postman CLI `status` đã kiểm tra: chưa có workspace/account binding. Không khởi tạo workspace hay gửi dữ liệu tài khoản lên dịch vụ bên ngoài; dùng integration HTTP hiện hữu và probe Staging riêng, chỉ in trạng thái/so sánh, không in credentials hoặc thông tin tài khoản.

## Staging thực tế

Đã cập nhật riêng API Staging bằng image `bhome/receiving-account-fixed:20261124`, kế thừa image bỏ cảnh báo đang chạy. Không đổi tài khoản Owner hoặc các thông số SePay.

Đúng hợp đồng đang chờ kích hoạt: cấp hướng dẫn chuyển khoản trả **HTTP 200 / Available**, có QR PNG và mã BH; ngân hàng/số tài khoản khớp bản Owner đã lưu. Hai lần yêu cầu trả cùng mã. Backend ghi rõ PaymentMode Test cho hợp đồng trước đó chưa được gắn chế độ; snapshot và chữ ký không đổi, trạng thái vẫn PendingActivation và Paid=false. Không gửi giao dịch ngân hàng hay gọi kích hoạt để kiểm chứng.

Số dư backend tại probe là **100.000 VND**, sau khi luồng room-scope Test hiện hữu đối chiếu nghĩa vụ chung của phòng. Không gán số tiền 7.700.000 VND từ ảnh cũ vào QR hoặc sửa số dư bằng client; số tiền trước/sau hai lần cấp QR khớp nhau. Việc phân bổ tiền vẫn yêu cầu receipt đã xác thực, đúng mode và ledger.

HTTPS/auth/CORS/webhook smoke PASS; snapshot bảo vệ xác nhận Production, database/storage/edge containers không đổi. Bản manifest/image trước được giữ để rollback. Evidence VPS: `/opt/bhome-deploy/operator-receiving-account-20261124/` với checksum artifact, source patch, protected snapshot, live probe và deployed manifest. Không in credentials/token/thông tin ngân hàng vào evidence đọc ra.

Không migration, commit/push/merge hoặc triển khai Production. CI/CD tiếp theo cần chứa thay đổi nguồn này. Mobile đã sửa nguồn/thông báo và kiểm thử; không phát hành binary native/EAS update.
