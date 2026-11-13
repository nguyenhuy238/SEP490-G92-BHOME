# Hoàn thiện định danh bên thuê và ký Main Contract

## Truy vết và kế hoạch

Yêu cầu được duyệt ngày 13/11/2026 BR-01..05 → BF-03/04, UC-15/16, GBR-04; quyết định nghiệp vụ 10/11 BR-01/04/05/07. Nhánh `member/QHuy`, base `ffe9320b`, working tree ban đầu sạch. Không thay Staff/Tenant screens, billing, occupancy, schema hoặc provider policy.

1. Signer: bỏ global Tenant dropdown; đọc resident đại diện hiện tại qua GET `/api/v1/residents/{id}` (Owner-only), đối chiếu với persisted Draft; backend release bắt buộc account đúng liên kết resident. Tests linked/unlinked/unrelated/family và PDF review.
2. Signing: phương thức theo khả năng hiện có (null-account internal; linked-account MySign); reuse invitation, OTP, confirmation và certificate APIs. Không tự đổi phương thức hoặc giả provider success.
3. Navigation: route Owner là nguồn ID; xóa state cũ khi parameters bị xóa/đổi, promotion có ID persist, preserve back hợp lệ. Tests empty/malformed/switch/reload.
4. UX: summary bên thuê chỉ đọc, một lỗi, phương thức rõ, footer responsive.
5. Regression và local CI checks; commit từng giai đoạn, không push/merge.

## Phát hiện ban đầu

- `MainDraftSigningReview` tải global `/contracts/preparation/accounts`, cho chọn lại account hoặc internal; account không được giải quyết từ resident đã chọn.
- `MainDraftService.ReleaseAsync` chặn account khác khi resident đã linked, nhưng resident chưa linked có thể nhận account Tenant bất kỳ. Cần chặn ở backend.
- `ResidentAdministrationView` hiện có ID, RoomId, ResidentType, VerificationStatus, TenantUserId, ContactEmail; đủ để xác thực lựa chọn mà không tạo endpoint/DTO mới.
- Domain chỉ có Representative/CoOccupant, không có household classification riêng. Không suy family từ số người. Preparation backend yêu cầu một Representative và các CoOccupant; không gắn nhãn family mới. Individuals có Representative riêng và Draft riêng; giữ capacity/room/conflict guards hiện có.
- `ConflictsAsync` đã giới hạn active occupants theo capacity và trùng Resident; `DuplicateAsync` chặn Draft/Pending/Active chồng cùng occupant. Không nới các guard này.
- Invitation hiện dùng `Resident.ContactEmail` đã xác nhận, không dùng email tùy ý trong release; kiểm verified và unique emails toàn bộ actual occupants theo quyết định BR-05.
- Route dùng `selected || deepId` nên local selection có thể thắng route rỗng/mới. MainDraftStart giữ ID trong local state và `persistRoute=false`.

## Kết quả

Giai đoạn 1: bỏ global account query/selector, dùng Owner resident endpoint để đối chiếu ID/phòng/vai trò/xác minh/contact với Draft; resolve null-account hoặc account đã linked. Re-check trước generate/release; không giữ reviewed file khi liên kết/contact đổi. Backend không gán account bất kỳ khi resident chưa linked. 19 test Mobile mục tiêu và 19 test backend (bao gồm Compact24) PASS; lint các tệp và Mobile typecheck PASS. Test legacy chỉ kiểm rejection; null-account release được thực thi trên Compact24 đang triển khai vì schema lịch sử còn constraint signer cũ. Không thay schema để làm test qua.

Giai đoạn 2: Main internal invitation kiểm tra đúng resident/phòng/liên kết trước khi gửi; hiển thị recipient, delivery, Tenant acceptance, Owner confirmation. Delivery chưa thành công có blocker rõ; không hiển thị token. Owner có directory chứng thư MySign; unknown mode không fallback. Parent reload evidence sau action để tránh trạng thái cũ. 12 test Owner signing PASS và lint các tệp PASS. Reuse `/contracts/{id}/signing-invitations`, `/internal-signing`, `/internal-signing/owner-confirmation`, certificate và signing/sync/recover APIs; không thêm API hoặc thay hình thức ký.

Các giai đoạn còn lại đang triển khai. Live email/MySign chỉ được ghi PASS khi có bằng chứng provider thật.
