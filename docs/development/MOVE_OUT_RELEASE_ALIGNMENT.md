# Tách bàn giao vật lý khỏi nghĩa vụ tài chính

Nguồn thay đổi được duyệt: BR-19/23/25 thay yêu cầu cũ “hết nợ/hoàn cọc mới trả phòng”; BR-24 giữ Tenant-only early request, Owner expiry/nonrenewal. ContractService hiện đã chặn Owner early termination; không tạo lại quyền này.

Slice: xác nhận inspection + final readings/evidence + Owner review → Complete physical move-out dù settlement còn Pending; Room Available chỉ khi không còn occupancy Active khác; đóng residence của đúng Contract và xóa current-room link của người thực sự rời khi không có occupancy còn hiệu lực khác. InvoiceRecipient, bank allocations, signed contracts, residence evidence và debt/refund history giữ nguyên. Refund/settlement tiếp tục trên Contract Terminated, không coi bàn giao là đã thanh toán.

Thành phần: ContractService/Repository, Resident optional RoomId (physical current_room_id đã nullable), DTO/query nơi hiển thị người đã rời, Owner lifecycle panel và Tenant debt/history. Acceptance: chưa kiểm tra/bàn giao bị chặn; Owner-reviewed inspection giải phóng được khi còn nợ/refund; shared room vẫn Occupied; resident còn hợp đồng không bị clear; historical invoices/readings vẫn được phân quyền; lặp completion không nhân hiệu ứng.

Migration PhysicalResidenceClosure giữ nguyên 24 bảng/data. current_room_id vốn nullable; EF/domain nay biểu diễn đúng null thay vì ID giả. Check ngày actual cho phép biết ngày rời khi ngày bắt đầu thực tế cũ chưa được ghi nhận; không điền ngày hợp đồng thay actual start. Nếu cả hai ngày biết thì vẫn bắt buộc out >= start. Closure ghi actual_move_out_date, residence_to và append history; giữ evidence/result và status Completed của đăng ký đã hoàn thành; Pending/InProgress được đóng hợp lệ, không gọi VNeID.

Runtime readiness yêu cầu lifecycle/residence constraints mới và contact column. Cờ compatibility cũ không thể báo Ready cho backend mới; database cũ cần migration explicit. Không tự migrate/recreate database có dữ liệu. Các kiểm thử và migration chỉ dùng database disposable.

Hoàn tất bàn giao không xóa/nạp lại financial ledger, không xác nhận hoàn tiền, không xóa account. Owner có thể tiếp tục review settlement và thực hiện refund sau Terminated; beneficiary/payer lấy từ membership/InvoiceRecipient lịch sử, không đòi current room. Source hash vẫn được kiểm tra. Phần receivables/cấn trừ/cọc theo BR-14/15/20/21 tiếp tục ở slice kế tiếp; không tuyên bố toàn bộ quyết toán đã hoàn thiện tại slice này.
