# Metadata lưu giữ định danh — BR-27

Ngày 11/11/2026. Nguồn: BR-27, GBR-13, NFR privacy và OPEN-02. Chưa có thời hạn/căn cứ bắt đầu/phạm vi xóa được phê duyệt. Đây là cơ chế ghi nhận và rà soát metadata, **không phải quyền xóa hoặc ẩn danh hóa**.

Owner-only, no-store:

- `GET /api/v1/residents/{id}/identity-retention` trả policy metadata, ngày bắt đầu/ngày xét lại nếu đủ cấu hình, blockingReasons, activeHolds, history và reference.
- `POST .../identity-retention/reviews` nhận `{expectedReference,action,holdId,reason,humanConfirmed:true}` + UUID `Idempotency-Key`. Action Review/PlaceHold/ReleaseHold; chỉ ReleaseHold có holdId (ID của PlaceHold đang active trong đúng Resident).

Đọc/ghi bị chặn trước lookup với Staff/Tenant. Mutation khóa ledger và Resident, re-read context và yêu cầu reference hiện tại. Replay cùng key/content không ghi thêm; stale reference, key đổi nội dung hoặc gỡ hold khác hồ sơ bị 409. Các event append-only `IdentityRetentionReviewV1` nằm trong residents.history, audit riêng có actor/time/action/Resident; không thêm bảng hoặc đổi model. Chỉ lấy metadata retention từ history, không decrypt/select envelope định danh hoặc HMAC cho API này. Không ghi số CCCD/PII vào lý do.

Restrictions: còn Room hiện tại, contract chưa đóng, residence thực tế chưa đóng, settlement ledger chưa giải quyết, hoàn tiền đang chờ (kể cả whole-excess claim chưa tạo request) hoặc active hold. Chứng từ cọc Holding lịch sử có tiền được yêu cầu rà soát phạm vi lưu giữ theo policy, không bị gọi là nợ hay tự xóa dù đã forfeited/applied/refunded. Owner ghi Review hoặc gỡ manual hold không ghi đè các restriction tài chính/cư trú/chính sách.

Cấu hình `IdentityRetention` mặc định ba giá trị null: `ApprovedDecisionReference`, `RetentionDays`, `StartBasis`. Chỉ thiết lập từ quyết định pháp lý/nghiệp vụ đã được phê duyệt; không có API Owner tự phê duyệt policy. Các start basis được hỗ trợ về kỹ thuật là LatestActualMoveOut (Asia/Ho_Chi_Minh) hoặc IdentityVerification; **không có basis mặc định được chọn thay chủ dự án**. Thiếu reference/duration/basis/date thì giữ restriction. Tính lại trạng thái theo ngày Việt Nam, không thêm job hoặc cadence mặc định. Cấu hình áp dụng theo vòng đời options của ứng dụng, cần restart khi thay policy deployment.

View luôn `canDelete:false`, kể cả ReadyForPolicyReview. Không có route Delete/Anonymize/ApproveLegalPolicy. Khi policy được duyệt sau này, một triển khai riêng phải xác định dữ liệu nào được xóa/ẩn danh, xử lý các snapshot append-only/backup/lookup HMAC, quyền legal hold và financial evidence, rollback/khả năng khôi phục và audit; không thể chỉ xóa identity_data rồi tuyên bố đã xóa mọi bản sao. Các mục đó chưa được thực thi hoặc coi là hoàn tất trong slice này.

Owner Web: Cư dân → Xem chi tiết → Lưu giữ và rà soát định danh. Metadata, reason và xác nhận buộc theo source hiện tại; không yêu cầu nhập UUID/CCCD hoặc làm thay đổi identity/account/contract. Mobile không có mutation retention.
