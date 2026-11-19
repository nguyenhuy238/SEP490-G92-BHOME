# Chọn Holding để tạo hợp đồng chính thức

**Cập nhật quyết định cùng ngày:** yêu cầu mới bỏ hoàn toàn nhập cọc khi chuyển Holding. Phần mô tả ô nhập bên dưới là hành vi trước cập nhật và được thay thế bởi `HOLDING_MAIN_INHERITED_DEPOSIT_2026-11-18.md`.

Phạm vi BF-03/04, UC-14/15, GBR-01..04. Nguồn bổ sung: yêu cầu người dùng hiển thị tên thay UUID và xử lý nút tiếp tục bị khóa. Tái sử dụng `ConvertHoldingAsync`, `HoldingConversionInput.RequiredSecurityDeposit` và API preparation đang có; không thêm nghiệp vụ hay endpoint.

`HoldingMainStart.tsx` lấy tên người đại diện từ preparation đã được backend phân quyền cho từng Holding hợp lệ của phòng đã chọn. Select hiển thị tên và phòng; UUID chỉ là giá trị nội bộ. Tái sử dụng preparation cho thông tin CCCD đã che số và tiền cọc, không gọi lại khi chỉ đổi lựa chọn.

Nút cũ phụ thuộc hoàn toàn vào tiền cọc mặc định từ Owner settings; khi không có giá trị, nút bị khóa mà không có giải thích. Ô tiền cọc nay điền mặc định nếu có và cho nhập theo hợp đồng, tương tự biểu mẫu chuyển đổi hiện có. Chấp nhận số nguyên không âm theo quy tắc `Money` hiện hành, không tự đặt tiền cọc thiếu thành 0 hoặc tiền giữ chỗ. Giữ kiểm tra trạng thái Active/OnHold, hạn, khóa giá, phân quyền và phân bổ cọc trên backend. Không áp các blockers của tạo Main mới lên luồng conversion vốn dùng nội dung Holding đã ký.

Khóa gửi trùng vẫn được giữ. Idempotency key đổi khi thay số tiền. Tải lỗi có thông báo và nút thử lại; request cũ không ghi đè khi đổi phòng. Không hiển thị UUID làm nhãn dự phòng.

Files sửa: `src/mobile/src/features/contracts/HoldingMainStart.tsx`, `src/mobile/src/__tests__/holding-main-start.test.tsx`.

Xác minh: 7 test Mobile PASS (nhãn tên, dùng lại hồ sơ, chọn nguồn không hợp lệ, thiếu cọc mặc định, cọc 0 hợp lệ, tiền nhập sai, thử lại khi tải lỗi và chống gửi trùng); lint PASS. Metro bundle HTTP 200. Không chuyển đổi hợp đồng thật hoặc chỉnh cấu hình/tiền cọc trong database để kiểm thử.
