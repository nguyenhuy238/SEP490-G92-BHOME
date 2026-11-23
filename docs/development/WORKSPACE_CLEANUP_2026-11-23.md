# Dọn dung lượng workspace ngày 23/11/2026

Phạm vi: vệ sinh môi trường phát triển theo yêu cầu người dùng. Không thay đổi nghiệp vụ, API, phân quyền, schema hoặc cấu hình chạy; không áp dụng thay đổi BF/UC/GBR.

## Kết quả đo

| Chỉ số        |                         Dung lượng |
| ------------- | ---------------------------------: |
| Trước khi dọn |                         145,93 GiB |
| Sau khi dọn   |                   Khoảng 23,18 GiB |
| Giảm          | Khoảng 122,75 GiB, tương đương 84% |

Số liệu là tổng kích thước tệp trong workspace, không phải số block thực chiếm trên ổ đĩa. Khi quét không đi theo symlink/junction để tránh đếm lặp hoặc tác động ngoài workspace. Dung lượng có thể tăng lại khi IDE/build tạo cache mới.

## Đã dọn

- Các bản build .NET và thư mục trung gian `bin`/`obj` trong mã nguồn, công cụ, test và những lần kiểm tra riêng tại `.tools`/`.tmp`.
- Các bản xuất build .NET chứa thư viện native OpenCV/ONNX/SkiaSharp bị sao chép nhiều lần; chỉ xóa tệp build được nhận diện qua manifest runtime .NET, giữ tệp nguồn, cấu hình, báo cáo và mô hình.
- Gradle cache, thư mục build Android và kết quả biên dịch C++ tạm phục vụ thử nghiệm camera.
- Thư viện `node_modules` trong bản sao CI `.tools/sepay-ci-385e2cda`; giữ thư viện chính và workspace links của dự án.
- Các bản build web/mobile `dist`, bốn tệp xuất image container dùng cho CI cũ và ba bộ cài đã giải nén.
- Nén 28 log lớn: tổng khoảng 8,60 GiB xuống 0,59 GiB. Đã so sánh SHA-256 của dữ liệu giải nén với bản gốc trước khi xóa log dạng thường. Đọc lịch sử tại đường dẫn cũ thêm đuôi `.gz`.

## Đã giữ để tiếp tục phát triển và tra cứu

- Toàn bộ tệp Git theo dõi, lịch sử `.git`, mã nguồn, migrations, tests, Dockerfiles, lockfile và các script phát triển.
- Tài liệu yêu cầu, thiết kế, báo cáo triển khai, kiểm tra/audit, checkpoint, patch và script thử nghiệm; bao gồm `.tools/validation-summary.json`.
- Kết quả test `.trx`, báo cáo, ảnh minh chứng và dữ liệu thử nghiệm.
- Các tệp môi trường local, cấu hình, chứng chỉ, dữ liệu PostgreSQL/MinIO, backup và dữ liệu demo.
- Các mô hình OCR, bộ dữ liệu và kết quả huấn luyện, môi trường Python/PyTorch/CUDA, SDK .NET/Node và Android SDK/NDK/JDK.
- Bộ thư viện JavaScript chính và trạng thái IDE đang dùng. Không xóa toàn bộ `.tools` hoặc `.tmp`: hai thư mục này chứa cả tài nguyên cần thiết.

## Kiểm tra đã thực hiện

- Đối chiếu SHA-256 đủ **3.018 tệp Git theo dõi** trước/sau: không thay đổi, không mất tệp.
- Đối chiếu kiểm kê trước khi dọn: không mất tệp ngoài danh sách đã phân loại hoặc log đã lưu bản nén.
- `npm run lint`: **PASS**, dùng Node 22 cài sẵn tại `.tools`.
- `npm run typecheck --workspace ./src/mobile`: **PASS**.
- Kiểm tra resolve `react`, `typescript`, `vite` từ cả ba frontend: **PASS**.
- SHA-256 của 28 log sau giải nén: **PASS**.
- Không chạy lại build .NET, unit/integration/E2E hoặc ứng dụng thực tế trong tác vụ này; không có thay đổi logic sản phẩm. Không diễn giải kết quả test cũ thành lần chạy mới.

IDE đang mở có thể tự tạo lại thư mục `bin` rỗng và một ít tệp metadata trong `obj` để phân tích mã. Chúng được ghi riêng trong báo cáo kiểm kê; không dừng IDE để xóa lặp các tệp này.

## Bằng chứng local và sử dụng tiếp

Danh sách đã phân loại, nhật ký thao tác, kiểm kê, mã băm và kết quả đối chiếu nằm tại `.tools/storage-cleanup-20261123/`. Báo cáo tổng hợp: `final-verification.json`; nhật ký nén: `log-archives.results.json`. Đây là bằng chứng local, nằm trong thư mục đã được Git bỏ qua. Tài liệu hiện tại là tệp bổ sung duy nhất ngoài thư mục đó; không sửa tệp mã nguồn đã có, không commit/push.

Lần chạy/build tiếp theo sẽ tạo lại `bin`, `obj`, `dist` hoặc cache cần thiết và có thể mất thời gian hơn lần chạy đã có cache. Giữ một thư mục output dùng lại cho các lần kiểm tra thông thường thay vì tích lũy nhiều bản build đầy đủ theo từng ngày/tác vụ. Giữ báo cáo và kết quả kiểm tra tách khỏi output build; không chạy `git clean -fdx` hoặc xóa hàng loạt `.tools`/`.tmp`.
