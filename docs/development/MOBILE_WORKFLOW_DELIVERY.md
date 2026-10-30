# BHOME Mobile — bổ sung luồng theo SRS

## Nguồn đối chiếu

- `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`, v1.3:
  §II.5.1 Screen Inventory (36 mục); UC-09, UC-11..19, UC-24..27;
  FE-03 §3.1–3.3, FE-04 §4, quy định quyền và xử lý CCCD.
- `BHOME_Report-1_Project_Introduction (3).docx`, v1.3.
- `BHOME_Report-2_Project_Management_Plan (3).docx`, v1.2.
- `Report-4_Software Design Specification (5).docx`: ảnh CCCD chỉ là đầu vào tạm;
  chỉ lưu các trường Staff xác nhận và metadata cần thiết.
- Bộ Stitch đã giải nén trong thư mục người dùng cung cấp; giữ Paper, Expo Router,
  font Inter, màu navy/blue, card và tab theo triển khai Stitch.
- Không tìm thấy tài liệu `BHome_Lam_Ro_Nghiep_Vu` trong bộ tài liệu hiện có. Không
  suy diễn chính sách còn mở từ tên tài liệu này.

Ma trận toàn bộ 36 mục và ba mục bổ sung ở `MOBILE_SCREEN_COVERAGE.csv`.
`Before` đánh giá code/thiết kế đã có trước phần bổ sung lần này.
`After=Incomplete` nghĩa là đã có form/luồng frontend nhưng API nghiệp vụ chưa tích hợp;
không coi một màn hình mẫu là nghiệp vụ đã hoàn tất ở production.
`Not Mobile Scope` là chức năng quản trị chính ở Owner Web/Public Website theo giới hạn
người dùng và SRS, không phải tuyên bố toàn bộ hệ thống đã triển khai chức năng đó.

## Luồng ưu tiên: Staff tiếp nhận → CCCD → xác nhận

Điểm vào: Staff Home → **Hồ sơ & Tác nghiệp → Tiếp nhận Tenant & Người cùng ở**.
Tài khoản Staff thật cũng có điểm vào này ngay màn hình chính.

1. Chọn cơ sở và phòng từ danh sách API theo phạm vi tài khoản.
2. Chọn mô hình hộ gia đình/nhóm hoặc từng cá nhân; thêm đại diện/người cùng ở.
3. Nhập nhãn hồ sơ, thông tin liên hệ và ngày bắt đầu ở.
4. Tạo hồ sơ Pending bằng API đã có; lưu ID trong bộ nhớ để tránh tạo lại khi chụp lại.
5. Màn chụp CCCD có chọn mặt trước/sau, hướng dẫn căn đủ bốn góc, xem lại ảnh,
   chụp lại, xóa ảnh và **Dùng ảnh này để OCR**.
6. Gửi ảnh đến OCR nội bộ đã có. Hiển thị đề xuất, cảnh báo/xung đột và nguồn từng trường.
   Không thay thế âm thầm giá trị đã có từ mặt còn lại.
7. Staff sửa thông tin hoặc nhập thủ công khi OCR lỗi; tick xác nhận đối chiếu giấy tờ.
   Sửa bất kỳ trường nào sẽ bỏ tick xác nhận.
8. Gửi đúng payload `IdentityConfirmation` tới API hiện có và chỉ hiện thành công thật
   sau phản hồi thành công. Quay về danh sách người ở để tiếp tục người tiếp theo.

`/identity` cũ tái sử dụng cùng `IdentityWizard`; luồng meter/setup/resident/OCR test
được giữ. Danh sách phòng cho phép mở xác minh hồ sơ Pending đã có, không buộc tạo lại.

Ảnh thuộc bộ nhớ đệm do component quản lý, không lưu thư viện ảnh/MinIO.
Ảnh và mảng byte được xóa sau xử lý; ảnh chưa xác nhận được xóa khi chụp lại, bỏ ảnh,
unmount hoặc ứng dụng vào nền. Các trường định danh chưa lưu cũng được xóa khi vào nền.
Giữ chặn screen capture và bảo vệ app switcher trên iOS theo cơ chế có sẵn.
Không log PII, không đưa PII/ảnh vào route params, storage hoặc lịch sử mẫu.
Các màn mẫu chỉ dùng đề xuất tổng hợp; không gửi giấy tờ thật để mô phỏng OCR.

Giới hạn API được hiển thị trong form: backend hiện chưa có endpoint lưu điện thoại,
email, ngày cư trú hoặc quan hệ hộ gia đình và chưa trả điều kiện đủ của phòng cho hợp đồng.
Các trường này chỉ là nháp trong bộ nhớ; không tuyên bố đã lưu. Tạo cư dân không đặt chỗ,
không tạo hợp đồng, không kích hoạt phòng. Không thay đổi backend trong tác vụ này.

## Các luồng frontend được thêm

Các route dưới `/workspace/`:

- `onboarding`: tiếp nhận và wizard CCCD; nối API thật cho create/OCR/confirm.
- `prepare-contract`: giữ chỗ/thuê chính, Tenant/phòng, kỳ hạn, cọc, điều khoản,
  kiểm tra đầu vào và gửi Owner trên bản mẫu. Không có nút Staff kích hoạt.
- `move-in`: kiểm kê từng nhóm tài sản, chìa/thẻ, chỉ số ban đầu, ảnh và trạng thái
  chờ Tenant đối chiếu; không tự xác nhận thay Tenant.
- `move-out`: hiện trạng so baseline, hỏng/thiếu, chìa/thẻ, chỉ số cuối, bằng chứng,
  gửi Owner kiểm tra; không tự trừ cọc/quyết toán/đánh dấu phòng trống.
- `residence`: hướng dẫn VNeID ngoài BHOME, thông tin chỗ ở, ngày cư trú,
  tham chiếu/kết quả/bằng chứng và trạng thái xác nhận Owner tách biệt.
- `adjustment`: chọn hóa đơn/khoản thu, lý do, số tiền đề nghị và bằng chứng;
  theo dõi trạng thái mẫu, giữ hóa đơn đã phát hành bất biến.
- `contract-request`: gia hạn/không gia hạn/chấm dứt trước hạn, ngày dự kiến,
  lý do, điều khoản mong muốn, thông tin nghĩa vụ và trạng thái xử lý.
- `signing`: Owner/Staff/Tenant theo quyền, tham chiếu nhà cung cấp, hai bên ký,
  Pending/Signed/Failed/Cancelled, bằng chứng và điều kiện kích hoạt. Không ký nội bộ.
- `billing-history`: hóa đơn/thanh toán ngân hàng, bộ lọc trạng thái, chi tiết phân bổ,
  liên kết hóa đơn và yêu cầu điều chỉnh.
- `shifts`: lịch ca riêng Staff và lịch sử thay đổi do Owner; không giao ca/đổi ca.
- `rooms`: danh sách phòng/người ở từ API hiện có, không tải định danh sâu.
- `debt-follow-up`: số phải liên hệ theo phòng/kỳ, kết quả và ghi chú liên hệ;
  không thu tiền mặt, không gạch nợ, không lộ tài chính toàn chuỗi.
- `task-detail`: việc chung và kỹ thuật, tiến độ, vướng mắc, đề xuất chi phí/thời gian,
  ảnh kết quả, gửi Pending Approval/Pending Verification; Owner mới hoàn tất.
- `report-incident`: Staff báo Normal/Emergency trong cơ sở, mô tả và bằng chứng;
  không tự phân loại bằng AI hoặc tự duyệt chi phí.

Luồng mới dùng component `WorkflowControls.tsx`, validator thuần và kiểu dữ liệu frontend.
Kiểu form không phải hợp đồng API được bịa ra. Chỉ adapter `captureService.ts` gọi endpoint
đã kiểm tra trong controller hiện có. Các luồng còn lại dùng fixture tách riêng và không gọi
endpoint giả. Thành công mẫu luôn ghi **mô phỏng / chưa gửi máy chủ**. Yêu cầu mẫu được giữ
trong bộ nhớ theo vai trò cho đến khi thoát preview; không đổi quyền tài khoản thật.

## Quyền và các điểm chưa tích hợp

Deep link sai vai trò hiện trạng thái từ chối truy cập, không mount màn hình dữ liệu.
Staff chỉ được onboarding/kiểm tra/tác nghiệp; Tenant chỉ mở hồ sơ của mình trong bản mẫu;
API thật vẫn là nguồn kiểm tra phân quyền cuối cùng. Owner giữ duyệt/kích hoạt/quyết toán.

Chưa có API adapter cho hợp đồng, handover, inspection, residence, adjustments, contract
requests, signing, history, shifts, debt, operational task mutations và các tùy chọn chung.
Không dùng fixture thay cho dữ liệu tài khoản thật. Upload bằng chứng mới, liên hệ,
chứng từ PDF và deep link đến nhà cung cấp ký cần API/thiết lập được xác nhận trước tích hợp.
Không triển khai IoT, khóa van từ xa, đăng ký công an, Staff-to-Staff handover hoặc chính sách
khấu trừ/hoàn cọc chưa được phê duyệt.

## Kiểm tra

- `npm run typecheck --workspace ./src/mobile`
- `npm run lint --workspace ./src/mobile`
- `npm run test --workspace ./src/mobile`
- Expo export bundle cho Android và iOS.

Test mới kiểm tra chặn truy cập sai vai trò, API trả 403 không fallback dữ liệu mẫu,
payload tạo cư dân không có PII/ảnh không được phép, ngày/số tiền, yêu cầu bằng chứng,
tiến độ/vướng mắc và tính nhất quán tổng hóa đơn. Camera trên thiết bị thật và luồng
server end-to-end cần kiểm tra với tài khoản/phòng mẫu được cấp quyền; không báo pass
cho những thao tác chưa thực thi.

Kết quả chạy 30/10/2026: TypeScript PASS, ESLint PASS, 7 file test / 81 test PASS,
export bundle Android PASS và iOS PASS, `git diff --check` PASS. Android emulator đã
render các màn Staff Home, Meter Reading, Onboarding và hộp chọn cơ sở/phòng;
không xem đây là bằng chứng đã chạy OCR/camera hoặc lưu dữ liệu end-to-end trên backend thật.
Ma trận CSV đã kiểm tra đủ 36 mục SRS và 3 mục bổ sung, mỗi dòng có đúng 8 cột.
