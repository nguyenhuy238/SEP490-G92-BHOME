# Staff — danh sách công việc vận hành

Đã áp dụng vào màn live `work-orders` của Staff. API và nghiệp vụ giữ nguyên. Màn phê duyệt Owner vẫn dùng bố cục trước đó; màn chi tiết/cập nhật không thay đổi.

## Bố cục

- Header: quay lại, “Công việc vận hành”, nút tải lại nhỏ; giữ BHOME workspace và bốn tab Staff.
- Mô tả nhẹ: “Công việc trong cơ sở đang được phân công”.
- Bộ lọc trạng thái cuộn ngang: Tất cả / Cần làm / Đang xử lý / Chờ Owner kiểm tra / Hoàn thành / Đã hủy.
- Tóm tắt nhỏ: số công việc từ `totalCount`, số quá hạn và cần làm trong trang hiện tại. Nếu danh sách có nhiều trang, hiển thị chú thích phạm vi các bộ đếm phụ. Khi đang lọc, tổng được ghi “công việc phù hợp”.
- Thẻ: tên tối đa hai dòng + badge trạng thái; hạn theo giờ Việt Nam, quá hạn có nhãn và màu đỏ; yêu cầu tối đa hai dòng; kết quả gần nhất tối đa một dòng khi có; mức ưu tiên và nhãn ảnh khi được yêu cầu; “Chi tiết” + chevron.
- Toàn bộ thẻ là một nút truy cập chi tiết. Không có nút bắt đầu/gửi kết quả ngay trên danh sách; mọi thao tác vẫn qua màn chi tiết và kiểm tra quyền/trạng thái hiện có.
- MeterReading vẫn mở danh sách tác vụ ghi chỉ số theo đường điều hướng trước đó; không đi nhầm sang chi tiết AdHoc.

Không dùng màu đỏ cho badge trạng thái chỉ vì task quá hạn: trạng thái và quá hạn là hai thông tin riêng. Priority dùng chữ nhẹ, status dùng nền nhạt để dễ phân biệt. Không thêm ảnh minh họa, shadow hoặc nút tối màu toàn chiều rộng vào từng thẻ.

## Thành phần

`OperationalTasksScreen` chọn màn theo role:

- Staff → `StaffTaskListScreen`.
- Owner → `OwnerTaskList` với luồng phê duyệt/tạo việc trước đó.

Trong `StaffTaskListScreen.tsx`:

- `StaffTaskListScreen`: query, phân trang, loading/error/empty, điều hướng.
- `TaskFilterBar`: lọc bằng API, đổi trạng thái đặt lại trang 1.
- `TaskSummaryBar`: bộ đếm có phạm vi rõ ràng.
- `TaskCard`: thẻ gọn, nội dung có giới hạn dòng, một điểm bấm.
- `TaskBadge`: nhãn trạng thái; PendingVerification = “Chờ Owner kiểm tra”, Assigned = “Cần làm”.

`WorkspaceShell` đăng ký refresh cho riêng màn Staff work-orders, tích hợp nút header và kéo để làm mới, tránh lồng hai danh sách cuộn dọc.

## Trạng thái dữ liệu

Sử dụng cache `queryPolicies.tasks` hiện có, tách theo tài khoản và đường dẫn query. Cache được invalidation bởi các mutation công việc thành công qua hạ tầng hiện có.

- Lần tải đầu: spinner nhỏ, không bịa tổng bằng 0.
- Rỗng: “Chưa có công việc được giao”.
- Lọc rỗng: “Không có công việc phù hợp”, có “Xem tất cả”.
- Lỗi: nội dung lỗi và “Thử lại”.
- Refresh: giữ dữ liệu đã tải, hiển thị “Đang cập nhật…”. Lỗi tạm thời giữ danh sách và báo chưa cập nhật được; lỗi bị từ chối truy cập dùng cơ chế xóa dữ liệu cache hiện có.
- Phân trang chỉ hiện khi `totalCount > pageSize`.

## Kiểm tra

- 148 test liên quan đạt: `workspace-navigation.test.tsx` và `tests/mobile/ocr/liveWorkspace-ui.test.tsx`.
- Bao gồm điều hướng AdHoc/MeterReading, phân trang, lọc server/reset trang, loading/empty/error/retry/refresh, hạn theo múi giờ Việt Nam, metadata tùy chọn, giới hạn dòng, không giữ dữ liệu sau lỗi 403 và giữ bốn tab Staff.
- `npm run lint --workspace ./src/mobile`: đạt.
- `npm run typecheck --workspace ./src/mobile`: đạt.
- Đã mở màn mới trên Android emulator bằng tài khoản Staff test với dữ liệu API thật: ba công việc, ba quá hạn, hai cần làm; title/status/hạn và bốn bottom tab hiển thị đúng. Ảnh kiểm tra tại `.tools/bhome-task-redesign.png`.
- Không thay backend, dữ liệu task hay quyền thực thi trong thay đổi giao diện này.
