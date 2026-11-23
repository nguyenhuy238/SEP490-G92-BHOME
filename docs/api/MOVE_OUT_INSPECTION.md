# Kiểm tra trả phòng bốn phần — 21/11/2026

**Căn cứ:** BF-03/04 (hợp đồng, bàn giao), UC-19 (trả phòng), JOB-02 (hết hạn), BF-06/GBR-10/18 (không thu/hoàn trùng).

## Khởi tạo trả phòng không trùng

- ContractExpiryProcessor tính ngày tại Asia/Ho_Chi_Minh. Khi hợp đồng Main/Renewal còn Active có EndDate **trước hôm nay**, job tạo một ContractMoveOut Approved nếu trước đó chưa có **và không có bản gia hạn kế tiếp đang mở/Active**. Mã hợp đồng là khóa duy nhất; khoá transaction payment ledger → Location → Room tránh tạo trùng trong nhiều lượt job hoặc Owner thao tác.
- Lịch sử ghi **ExpiryInspectionOpenedBySystem** và lý do hệ thống khởi tạo; ApprovedByUserId=null vì không phải Owner thao tác. Trường RequestedByUserId/ActorId cũ dùng OwnerSignerId làm người chịu trách nhiệm do FK bắt buộc; không coi là Owner phê duyệt. Job không giải ngân, không thu phí, không chấm dứt hợp đồng hoặc giải phóng phòng.
- Trạng thái Terminated chỉ hình thành sau khi Owner duyệt kiểm kê và hoàn thành bàn giao vật lý. Staff không tự thấy nhiệm vụ khi chưa có người được phân công. MoveOut mới có PendingReason=inspection_staff_assignment_required; Owner dùng POST move-out/schedule với Staff đủ quyền/location và ngày giờ hợp lệ.
- Chấm dứt sớm giữ chuỗi có sẵn: Tenant termination-requests → Owner move-out/approve → Owner/Staff move-out/schedule. Không tạo nhánh song song sau Terminated.

## Staff kiểm tra đầy đủ bốn phần

GET move-out/inspection-preparation trả dữ liệu nhận phòng để **đối chiếu nếu có**, số meter Final và inventory hiện tại. MoveOut là phép kiểm tra thực tế độc lập, không bắt buộc biên bản MoveIn đầu vào, không lập PDF hay ký nhận. Staff lưu từng mục bằng GET/PATCH move-out/inspection-draft, rồi gửi POST move-out/inspection với version/idempotency:

1. **Điện/nước:** electricityReadingId và waterReadingId bắt buộc là Final confirmed và ảnh/hash hợp lệ.

2. **Hiện trạng phòng:** `roomChecks` luôn đủ bảy mã chuẩn, mỗi mục chỉ nhận `Passed` (Tốt) hoặc `Issue` (Có vấn đề). `Issue` phải có lý do; mỗi mục được đính kèm tối đa năm ảnh nhưng ảnh là tùy chọn ở cả hai trạng thái. `roomCondition` có thể bỏ trống để hệ thống tổng hợp từ bảy kết quả.
3. **Kiểm kê tài sản:** nhập tình trạng và số lượng thực tế (`observedQuantity`) khi có quản lý số lượng. Ghi lý do nếu tình trạng có vấn đề hoặc phát hiện thiếu/chênh lệch với dữ liệu đầu vào đã xác thực. Ảnh nhóm và ảnh từng tài sản vật lý đều tùy chọn; ghi chú là bắt buộc với tài sản vật lý có vấn đề. Không buộc Staff tự phân tách `goodQuantity`/`wornQuantity`/`damagedQuantity` hoặc khai báo `handedOverQuantity` khi chưa kiểm đếm riêng; các giá trị không ghi nhận giữ nguyên `null`. `missingQuantity` chỉ được tính từ số lượng lúc nhận đã xác thực, nếu không có baseline thì vẫn là `null`. Không tự tạo khoản thu/bồi thường.
4. **Chìa khóa:** `accessItems` gồm đúng một mục `{type: RoomKey, quantity, notes}` với số lượng 0–100; ghi chú và `keyEvidenceIds` đều tùy chọn, kể cả khi ít hơn số lượng ban đầu. `keysAndAccess` có thể được tổng hợp từ số chìa đã nhận.

Kể cả hợp đồng cũ không có dữ liệu bàn giao ban đầu, khi trả phòng Staff vẫn phải kiểm tra đủ bảy mục phòng, kiểm kê tài sản đang có và nhập số chìa khóa nhận lại. Ghi chú tổng quan `notes` và ảnh chung `evidenceIds` là tùy chọn. Ảnh hạng mục không được trùng ảnh chung hoặc ảnh nhóm khác; Backend kiểm tra quyền, nội dung ảnh và hash. Snapshot ghi vào ContractFinalInspection.ObservedSnapshot, Owner/Tenant được xem qua GET move-out/inspections có kiểm quyền.

Staff có thể hoàn tất bốn phần **dù có Issue/Missing/Damaged** để Owner kiểm tra và yêu cầu sửa hoặc kiểm lại. Owner duyệt kết quả qua inspection-review có phiên bản, lý do, thời điểm và audit; không yêu cầu Tenant phản hồi/ký hoặc Owner ký. Tenant feedback từ phiên bản cũ chỉ là dữ liệu tham khảo. Lịch sử kết quả đã chốt không bị sửa thành phiên bản khác.

## Giá, cọc, khoản còn nợ và hoàn tiền

Owner đặt giá theo từng tài sản hoặc mã lỗi roomCheckCode qua POST receivables/damage; Tenant thấy ngay SettlementReceivable cùng số tiền, nguồn chứng cứ và trạng thái. Cấn trừ cọc qua deposit-offsets phải ghi PaymentAllocation trỏ đúng receivable, không tạo hóa đơn hoặc khoản nợ trùng. Số tiền cao hơn cọc được giữ ở outstanding của receivable hiện hữu.

### Owner chốt quyết toán sau khi duyệt đầy đủ

- Owner Web có bước **Chốt quyết toán và xử lý tiền cọc**; Backend nhận `POST /api/v1/contracts/{id}/move-out/receivables/final-close` với `Idempotency-Key` và `SettlementFinancialCloseInput` gồm `expectedReference`, `expectedChargeReviewId`, `waivedIssueKeys`, `beneficiaryResidentId`, `beneficiaryVerified`, `reason`, `humanConfirmed`. Đây là **thao tác Owner xác nhận trực tiếp**, không phải tác vụ chạy nền.
- Phải có **kết quả kiểm tra trả phòng lưu trong hệ thống và Owner đã xác nhận** (không phải PDF/biên bản ký), nguồn điện/nước và các khoản cuối kỳ đã đối soát, bản duyệt khoản thu hiện hành khi có khoản phải thu. Mỗi mục tài sản/phòng/chìa khóa phát sinh lỗi phải **có khoản bồi thường riêng** hoặc được Owner **miễn thu rõ ràng** qua `waivedIssueKeys`; không tự xem lỗi chưa định giá là miễn thu.
- Một tài sản có số lượng thực tế không giảm nhưng chuyển từ tình trạng **Tốt** đã xác thực sang **Có vấn đề** vẫn phải được Owner xem xét. Thiếu chìa khóa so với baseline đã xác thực vẫn là hạng mục phải định giá/miễn thu dù Staff không chụp ảnh. Việc ghi nhận vấn đề không tự sinh tiền; **khi Owner thực sự lập khoản thiệt hại** qua `POST receivables/damage`, backend vẫn yêu cầu ảnh riêng đã kiểm tra/hàm băm hợp lệ. Không có ảnh để làm căn cứ thu phí thì Owner có thể miễn thu minh bạch hoặc yêu cầu kiểm tra lại.
- Backend kiểm tra lại tham chiếu sổ cái và các điều kiện nghiệp vụ, giữ khóa giao dịch theo thứ tự, tự dùng luồng `deposit-offsets` có sẵn để phân bổ **cọc đã xác minh** vào khoản `TenantDamage`. Thiệt hại vượt cọc giữ nguyên là **outstanding của khoản phải thu đó**, không tạo hóa đơn hoặc nghĩa vụ trùng.
- Chỉ khi **không còn nghĩa vụ khác chưa trả**, còn cọc đủ điều kiện và Owner xác minh **người nhận hoàn** theo thỏa thuận, Backend mới tạo **một** yêu cầu hoàn cọc trạng thái `REQUESTED` qua luồng Refund hiện hữu. Không tự `APPROVED`, `COMPLETED` hay chuyển tiền. Nếu không còn cọc, không tạo hoàn tiền giả.
- Backend từ chối tham chiếu cũ, nguồn hoàn bị chặn, giá/miễn thu chưa đủ, người nhận không xác minh, lịch sử khấu trừ cũ chưa xử lý và chốt lại lần thứ hai; idempotency key lặp hợp lệ trả kết quả cũ. Refund vẫn cần Owner duyệt/thực thi có chứng cứ trong luồng riêng.

**Giới hạn xác minh:** Có unit test và các ca PostgreSQL integration cho auto-offset, refund `REQUESTED`, overage, cạnh tranh/idempotency. Ca PostgreSQL được đánh dấu `CompactPostgresFact` và **bị skip nếu không có** `BHOME_COMPACT24_TEST_ADMIN` trỏ tới PostgreSQL test dùng database tạm; không diễn giải unit test/build/commit là đã nghiệm thu E2E trên DB/MinIO đang chạy.
