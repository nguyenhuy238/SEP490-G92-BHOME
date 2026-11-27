# Dọn workspace ngày 27/11/2026 — lần kiểm tra bổ sung

Phạm vi: dọn build/cache phát sinh sau lần dọn trước, giữ context và tài nguyên phát triển. Không thay đổi nghiệp vụ, API, schema, phân quyền hoặc cấu hình. Không có thay đổi BF/UC/GBR.

## Dung lượng và nguyên nhân

| Chỉ số                |            Dung lượng |
| --------------------- | --------------------: |
| Trước khi dọn lần này |             54,71 GiB |
| Sau khi dọn           |             26,21 GiB |
| Giảm                  | 28,50 GiB, khoảng 52% |

Số liệu là tổng kích thước tệp trong workspace; không đi theo symlink/junction và không đo cache hoặc dữ liệu nằm ngoài repository. So với mốc 25,46 GiB sau lần dọn trước, workspace đã tăng thêm khoảng 29,25 GiB qua các lần build/test mới.

Nguyên nhân chính là các bản build .NET có sao chép thư viện native OCR/PDF: `.tools/long-ci-artifacts` khoảng 6,54 GiB, bản sao `.tools/pr185-staging` khoảng 7,45 GiB, cùng các output mới trong `src`, `tools`, `tests`. Ngoài ra có hai bản xuất image Docker và log SQL mới. `.gitignore` chỉ ngăn Git theo dõi tệp phát sinh, không tự xóa chúng trên ổ đĩa.

## Đã dọn

- 569 mục build/cache được nhận diện, tổng khoảng 26,10 GiB: `bin`, `obj`, các bản publish chứa runtime sao chép và `dist`.
- Hai bản xuất image Docker tại `.tools/ci370-private`: khoảng 1,06 GiB. Đã kiểm tra cấu trúc OCI trước khi phân loại; đây không phải bản sao lưu cơ sở dữ liệu.
- Output chẩn đoán `diagnostic-out` trong bản sao PR185: khoảng 0,91 GiB. Đã kiểm tra manifest của `Probe`, các dependency BHome và toàn bộ loại tệp ở thư mục gốc; chỉ có binary/manifest/tài liệu thư viện và native runtime.
- Nén hai log lớn từ khoảng 480,10 MiB xuống 37,98 MiB. Trước khi xóa bản log thường, đã giải nén và so sánh SHA-256 với bản gốc. Lịch sử vẫn đọc được tại tên log cũ thêm đuôi `.gz`.

## Giữ lại để phát triển và tra cứu

- Mã nguồn, Git, migrations, tests, lockfile, tài liệu yêu cầu/thiết kế, báo cáo chức năng, checkpoint, patch và script thử nghiệm.
- Tệp chưa commit có sẵn: `docs/development/PR185_STAGING_DEMO_2026-11-27.md`.
- Tài liệu SePay và các chức năng đã phát triển; báo cáo CI, kết quả `.trx`, ảnh minh chứng và các bản lưu nguồn.
- Tệp môi trường, cấu hình, chứng chỉ, dữ liệu PostgreSQL/MinIO, backup và dữ liệu demo.
- Mô hình OCR, dữ liệu/kết quả huấn luyện, Python/PyTorch/CUDA, SDK .NET/Node, Android SDK/NDK/JDK và bộ thư viện JavaScript chính.
- Bằng chứng của các lần dọn trước. Không xóa toàn bộ `.tools`, `.tmp` hoặc `.artifacts`.

Phần dung lượng còn lại chủ yếu phục vụ phát triển, OCR và lưu bằng chứng; riêng `.tools` khoảng 20,43 GiB và `.tmp` khoảng 4,30 GiB. Không thể coi toàn bộ các thư mục này là rác chỉ dựa vào tên.

## Kiểm tra đã chạy

- SHA-256: **3.285 tệp Git theo dõi** không thay đổi; cùng tệp chưa commit và các tệp môi trường, tổng cộng **3.297 tệp được bảo vệ** bằng mã băm.
- Đối chiếu kiểm kê: không mất tệp ngoài danh sách dọn hoặc log đã nén; không có lỗi quét; không còn mục dọn chưa xử lý.
- `npm run lint -- --ignore-pattern '.artifacts/**'`: **PASS**. Giữ các script thử nghiệm cũ và không thay đổi cấu hình lint; lần chạy này kiểm tra với thư mục artifact được loại trừ bằng tham số CLI.
- `npm run typecheck --workspace ./src/mobile`: **PASS**.
- Resolve `react`, `typescript`, `vite` từ cả ba frontend: **PASS**, 9 kiểm tra.
- Hai log nén: **PASS**, đã xác minh SHA-256 sau giải nén.
- Không chạy lại build .NET, unit/integration/E2E hoặc ứng dụng thực tế; không thay đổi logic sản phẩm và không coi kết quả test cũ là lần chạy mới.

IDE đã tạo lại một số thư mục `bin` rỗng và metadata nhỏ trong `obj`; đã nhận diện qua loại tệp và thời gian tạo, ghi riêng trong kiểm kê. Không dừng IDE để xóa lặp những tệp phân tích mã này.

## Bằng chứng local

Kiểm kê trước khi dọn, mã băm, danh sách phân loại, bằng chứng nhận diện image/output chẩn đoán, nhật ký thao tác và kết quả đối chiếu nằm tại `.tools/storage-cleanup-20261127-r2/`. Các tệp chính: `final-verification.json`, `checks.json`, `log-archives.results.json`. Thư mục bằng chứng local được Git bỏ qua.

Tài liệu này là tệp mới duy nhất được thêm ngoài thư mục bằng chứng; không sửa các tệp nguồn/tài liệu có sẵn, không commit/push. Lần build tiếp theo sẽ tạo lại output/cache và có thể lâu hơn. Để hạn chế phình lại, dùng lại output phù hợp cho các lần kiểm tra thông thường, giữ báo cáo tách khỏi binary và dọn output của các đợt kiểm tra đã chốt; không dùng `git clean -fdx` hoặc xóa hàng loạt thư mục chứa dữ liệu/cấu hình/mô hình.
