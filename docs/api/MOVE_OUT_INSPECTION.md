# Kiểm tra trả phòng bốn phần — 21/11/2026

**Căn cứ:** BF-03/04 (hợp đồng, bàn giao), UC-19 (trả phòng), JOB-02 (hết hạn), BF-06/GBR-10/18 (không thu/hoàn trùng).

## Khởi tạo trả phòng không trùng

- ContractExpiryProcessor tính ngày tại Asia/Ho_Chi_Minh. Khi hợp đồng Main/Renewal còn Active có EndDate **trước hôm nay**, job tạo một ContractMoveOut Approved nếu trước đó chưa có **và không có bản gia hạn kế tiếp đang mở/Active**. Mã hợp đồng là khóa duy nhất; khoá transaction payment ledger → Location → Room tránh tạo trùng trong nhiều lượt job hoặc Owner thao tác.
- Lịch sử ghi **ExpiryInspectionOpenedBySystem** và lý do hệ thống khởi tạo; ApprovedByUserId=null vì không phải Owner thao tác. Trường RequestedByUserId/ActorId cũ dùng OwnerSignerId làm người chịu trách nhiệm do FK bắt buộc; không coi là Owner phê duyệt. Job không giải ngân, không thu phí, không chấm dứt hợp đồng hoặc giải phóng phòng.
- Trạng thái Terminated chỉ hình thành sau khi Owner duyệt kiểm kê và hoàn thành bàn giao vật lý. Staff không tự thấy nhiệm vụ khi chưa có người được phân công. MoveOut mới có PendingReason=inspection_staff_assignment_required; Owner dùng POST move-out/schedule với Staff đủ quyền/location và ngày giờ hợp lệ.
- Chấm dứt sớm giữ chuỗi có sẵn: Tenant termination-requests → Owner move-out/approve → Owner/Staff move-out/schedule. Không tạo nhánh song song sau Terminated.

## Staff kiểm tra đầy đủ bốn phần

GET move-out/inspection-preparation vẫn cho dữ liệu baseline bàn giao phòng có xác nhận, số meter Final và inventory. Staff gửi POST move-out/inspection với version/idempotency; dữ liệu mới đặt ở cuối InspectionInput, không sửa nội dung PDF/historical signatures đã tồn tại:

1. **Điện/nước:** electricityReadingId và waterReadingId bắt buộc là Final confirmed và ảnh/hash hợp lệ.
2. **Hiện trạng phòng:** roomCondition và roomChecks với bảy mã chuẩn, mỗi phần tử gồm code/status/notes/evidenceIds. Issue có mô tả và ảnh riêng; NotApplicable vẫn là quan sát, không tự coi Passed.
3. **Kiểm kê tài sản:** assets với từng số lượng, tình trạng, ghi chú/ảnh, so với baseline ký đầu vào và inventoryToken phiên bản hiện tại.
4. **Chìa khóa/quyền ra vào:** keysAndAccess, accessItems có {type: RoomKey, quantity, notes}, keyEvidenceIds. Trả ít chìa hơn baseline cần nêu rõ và có ảnh riêng.

Hồ sơ mới có roomChecks/accessItems trong baseline bắt buộc nhập lại đầy đủ module tương ứng khi trả phòng; dữ liệu lịch sử chưa cấu trúc vẫn tương thích. Ảnh hạng mục không được trùng ảnh chung hoặc ảnh nhóm khác, Backend kiểm tra quyền, nội dung ảnh và hash. Snapshot ghi vào ContractFinalInspection.ObservedSnapshot, Owner/Tenant được xem qua GET move-out/inspections có kiểm quyền.

Staff có thể hoàn tất bốn phần **dù có Issue/Missing/Damaged** để Owner kiểm tra và yêu cầu sửa hoặc kiểm lại. Owner vẫn duyệt qua inspection-review; Tenant có quyền phản hồi; lịch sử immutable không bị cập nhật lại.

## Giá, cọc, khoản còn nợ và hoàn tiền

Owner đặt giá theo từng tài sản hoặc mã lỗi roomCheckCode qua POST receivables/damage; Tenant thấy ngay SettlementReceivable cùng số tiền, nguồn chứng cứ và trạng thái. Cấn trừ cọc qua deposit-offsets phải ghi PaymentAllocation trỏ đúng receivable, không tạo hóa đơn hoặc khoản nợ trùng. Số tiền cao hơn cọc được giữ ở outstanding của receivable hiện hữu.

**Giới hạn an toàn hiện tại:** Chưa có nghiệp vụ Owner miễn phí *từng* mục lỗi và chưa có quy tắc xác minh duy nhất bên thụ hưởng cọc trong mọi hợp đồng đồng thuê. Vì vậy tự khấu trừ cọc/tự tạo yêu cầu Refund chưa kích hoạt; Owner dùng quyết định cấn trừ/refund có kiểm chứng sổ cái hiện hữu. Khi thêm chính sách chốt giá/miễn phí, chỉ tạo trạng thái Refund REQUESTED và dùng duyệt/thực thi hiện hữu; không tự hoàn tiền.
