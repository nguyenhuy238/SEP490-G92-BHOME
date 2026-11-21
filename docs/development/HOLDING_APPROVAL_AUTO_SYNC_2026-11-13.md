# Đồng bộ phê duyệt và ký mô phỏng Holding trên Mobile

Cập nhật mới nhất: [Bước 6 Owner xác nhận thật và Tenant ký qua email](HOLDING_STEP6_REAL_OWNER_TENANT_EMAIL.md) thay thế cơ chế hai bên mô phỏng mô tả dưới đây.

Theo yêu cầu ngày 13/11/2026: sau Owner phê duyệt, Mobile tự cập nhật; Staff có hai nút ký mô phỏng trên dữ liệu test rồi xem QR theo cọc đã có. Không ghi chữ ký pháp lý hoặc thay đổi quyền ký thật.

## Tiến trình Mobile

1. Chọn phòng.
2. Người giữ chỗ.
3. CCCD.
4. Xác nhận.
5. Bản nháp và phê duyệt.
6. Chờ ký.
7. QR và tiền cọc.
8. Giữ chỗ/OnHold.

Backend phê duyệt Holding vẫn lưu `approvedAt` và giữ Draft. Mobile đọc `approvedAt` để chuyển từ bước 5 sang 6; không suy diễn đã ký từ thao tác phê duyệt.

`useContractDetail` hỗ trợ refresh nền theo chu kỳ. Mobile dùng 5 giây cho Holding chưa hoàn tất. Không đặt loading toàn màn hình trong refresh nền, không thay object dữ liệu khi response không đổi, không xóa form đang mở. Có thông báo riêng nếu refresh nền thất bại; timer dừng khi unmount hoặc hợp đồng đến trạng thái cuối. Owner Web giữ hành vi cũ trừ khi chủ động truyền interval.

## Ký mô phỏng

Hai nút dùng API `/api/v1/integrations/sepay/testing/holdings/{id}/simulation/signatures` hiện có, participant Owner hoặc Tenant, simulationOnly true. Timestamps và `SigningState: Simulated` được lưu vào metadata database, audit ghi đúng Staff thực hiện. Không tạo ContractSignature Signed hoặc InternalAcceptance giả.

Sau khi đủ hai xác nhận, **hợp đồng test** chuyển PendingActivation. Staff sang QR với số tiền còn thiếu và mã BH lấy từ backend. Chỉ API hoàn tất test mới chấp nhận metadata mô phỏng; API kích hoạt thật vẫn kiểm tra bằng chứng ký thật. OnHold test vẫn cần cọc đã xác minh đủ từ ledger, Owner phê duyệt, chưa hết hạn và không xung đột phòng.

Không cho ghi mô phỏng đè lên hợp đồng đã có signature/internal acceptance evidence. Thao tác lặp lại trước kích hoạt là idempotent. Hợp đồng Cancelled không được mở lại.

## Giới hạn Neon test

Mặc định các API thử nghiệm chỉ cho database loopback sandbox. Bổ sung opt-in riêng bằng nhóm `HoldingTesting` trong file môi trường private:

- Enabled phải bật rõ ràng.
- Development/Testing, SePay Test Mode hợp lệ; không hỗ trợ Production/Live.
- Host/database Neon phải khớp chính xác cấu hình; TLS VerifyFull và ChannelBinding Require.
- LocationIds phải khai báo rõ. Cấu hình local hiện tại chỉ bật BHOME JOB09 TEST.
- Chỉ Holding **mới tạo** trong location này được đánh dấu development demo. Các hợp đồng khác không đổi; hợp đồng cũ không tự chuyển thành demo.
- Staff phải có phân công cơ sở còn hiệu lực; quyền truy cập được kiểm tra bằng ContractService.GetAsync trước khi dùng API test.
- QR vẫn yêu cầu tài khoản nhận tiền demo khớp binding theo Location. Đã cấu hình tài khoản SePay Test Mode cho cơ sở được cho phép; không sao chép kết nối database/JWT từ sandbox sang Neon.

Các token, HMAC secret, profile bật tính năng và mật khẩu đều nằm trong file local được Git bỏ qua. Không chuyển tiền thật với QR Test Mode.

## Kiểm tra

Tests kiểm tra: phê duyệt được polling mà không mất form; lỗi refresh nền không xóa dữ liệu; bước 5/6/7/8 đúng dữ liệu; hai nút và QR; metadata Simulated được lưu; đủ cọc mới OnHold; từ chối Staff ngoài cơ sở; guard từ chối sai host/database/location/TLS/Production/Live. Luồng OTP/chữ ký thật hiện có được kiểm thử hồi quy trên database PostgreSQL dùng một lần.

Hợp đồng `fb491442-b821-454e-af42-e0ff4b788efe` trong ảnh được đọc thấy đã Cancelled trong lúc thực hiện yêu cầu. Không đổi lại trạng thái hoặc tạo chữ ký cho bản ghi này. Kiểm thử thủ công luồng mới cần tạo Holding test mới.
