# BHOME Mobile — Luồng hợp đồng thuê, 09/11/2026

## Phạm vi và nguồn

Yêu cầu UI/UX đính kèm ngày 09/11/2026: đồng bộ với danh sách hợp đồng Mobile, dùng bốn bước, tái sử dụng API hiện hữu. Phạm vi BF-03/BF-04, UC-13..16, GBR-04: Staff chuẩn bị hồ sơ; Owner duyệt/chuyển sang ký; Owner/Tenant ký; Owner đối chiếu cọc và kích hoạt. Bản nháp, chữ ký và điều kiện kích hoạt vẫn do backend quyết định. Không sửa backend/schema hoặc ghi thêm dữ liệu Neon trong lượt chỉnh UI này.

## Trước và sau

- Trước: màn nháp có bước xác nhận lưu riêng; tiến trình chi tiết có năm bước khác với luồng nhập; mục điều hướng xuống nhiều hàng; tài liệu hiển thị metadata kỹ thuật.
- Sau: cùng thanh **Xem hợp đồng → Ký hợp đồng → Tạo mã QR → Kích hoạt hợp đồng**. Bản nháp chuyển trực tiếp từ xem PDF đến bước duyệt/ký. Mục điều hướng chi tiết cuộn ngang một hàng; phần nhận phòng, vòng đời và lịch sử vẫn truy cập được.
- Form tạo hợp đồng gom ba thẻ Phòng, Người thuê, Điều khoản thuê. Có email, không hiện Nơi cấp CCCD; các giá/phí theo hàng, ghi chú nằm cùng điều khoản; thiếu cấu hình chỉ có một thẻ cảnh báo. Footer giữ Lưu nháp/Xem trước hợp đồng.
- Xem trước có tóm tắt đại diện/CCCD che/thời hạn và PDF riêng tư, đọc toàn màn hình, tải PDF/DOCX theo khả năng hiện có. Giữ cùng ID và dữ liệu nhập khi quay lại sửa.
- Ký có trạng thái từng bên và MySign/Development rõ ràng. Owner có thể chọn Tenant đang hoạt động, tạo PDF đưa đi ký, xác nhận đã xem và gọi release; Staff thấy chờ Owner duyệt. Không tự tạo tài khoản hoặc tự ký.
- Bước cọc hiển thị số yêu cầu, cọc giữ chỗ áp dụng và số đã xác minh/còn thiếu khi API trả dữ liệu. Chỉ Owner có thao tác đối chiếu sao kê hiện hữu.
- Bước kích hoạt có checklist và blocker từ server. Thành công chỉ xuất hiện với trạng thái Active từ API, kèm xem chi tiết/về danh sách; không có trang thành công toàn màn hình.

## Thành phần và tính nhất quán

- Tái sử dụng `OnboardingStepper`, `Box`, `Heading`, `Pill`, `Action`, `ContractDateField`, `ChoiceField`, `ContractPdfPreview`, `ContractActionForm`, `SigningCertificates` và `ContractEvidence`.
- Mới: `RentalContractStepper`, `rentalContractState`, `RentalContractFlow`, `MainDraftSigningReview`.
- Cập nhật: `MainDraftScreen`, `MainDraftStart`, `ContractScreen`, `ContractProgress`, `ContractPreviewSummary`, `ContractWorkflowPanel`.
- Dùng palette/theme hiện có, header navy, nền sáng, thẻ trắng bo góc, primary xanh và hệ cỡ chữ hiện hữu. Không thêm thư viện hoặc thay bottom navigation. Giữ modal chỉnh bản nháp và safe-area theo cách đã có.
- Release dùng `signing-review` và `release` đang tồn tại, ràng buộc `expectedVersion`, `reviewedFileId`, Tenant, xác nhận người dùng và Idempotency-Key. Khóa thao tác trong lúc gửi; chuyển bước không tự ghi payment/signature/activation.
- Tác vụ chuyển PDF đưa đi ký dùng giới hạn 60 giây như tạo tài liệu, không tự retry mutation. Các API thông thường giữ giới hạn 15 giây.

## Giới hạn backend

- **Chưa có QR tiền cọc hợp đồng:** API transfer-instructions hiện gắn với Invoice. Bước 3 nêu rõ chưa có QR/tham chiếu cọc từ server; không dựng mã chuyển khoản, không dùng QR hóa đơn khác, không có nút tự xác nhận đã thanh toán.
- Chỉ Owner/Tenant được đọc tài liệu ký và thông tin tài chính theo quyền API; Staff theo dõi hồ sơ, không được cấp quyền bổ sung.
- MySign thật cần cấu hình/chứng thư/provider hiện hữu. Development được ghi nhãn, chữ ký Simulated không được trình bày là Signed. Có thể đi tiếp để kiểm tra điều kiện trong luồng mô phỏng sau khi cả hai đã mô phỏng; kích hoạt vẫn cần backend readiness.
- PDF đưa đi ký Development chưa được coi là mẫu đã duyệt production. Không nới validation hoặc điều kiện release để che lỗi cấu hình.

## Kiểm chứng

- Mobile typecheck và lint: PASS.
- Toàn bộ Mobile test chạy bằng Node 22.23.4: **868/868 PASS, 70 file**. Bao gồm test mới về bước ký một bên, chữ ký mô phỏng, QR chưa có, role controls, backend readiness, Active, release đúng file/version/xác nhận, chặn gửi lặp và giữ bản nháp khi quay lại.
- Headless Chrome dùng app thật và intercept toàn bộ API bằng dữ liệu tổng hợp: tạo hợp đồng, footer tại 360×780, 320×600 và 360×480; PDF toàn màn hình; ký, cọc, kích hoạt bị chặn, Active tại 320–360px. Không có tràn ngang hoặc page error. Không phát sinh mutation trên Neon từ kiểm tra trình duyệt này.
- Artifact cục bộ, bị ignore: `.tools/contract-ui-all-tests.log`, `.tools/contract-flow-visual.log`, `.tools/contract-create-visual.log`, `.tools/onboarding-visual/contract-*.png`, `.tools/onboarding-visual/pdf-fullscreen-360.png`.
- Chưa kiểm thử trên thiết bị Android/iOS thật, chưa nghiệm thu MySign/bank thật và chưa tuyên bố full UI flow trên Neon READY.
