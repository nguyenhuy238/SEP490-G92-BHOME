# FE-09 — Khắc phục tải ảnh local ngày 23/11/2026

## Nguyên nhân và xử lý

Owner tại `localhost:5173/public-content` nhận lỗi dịch vụ khi tải ảnh. Docker
Linux engine không chạy, endpoint MinIO `localhost:9000` không có listener.
Backend trả 503 khi không ghi được object; metadata ảnh không được lưu. Public
Website vì vậy vẫn hiển thị trạng thái chưa có ảnh công bố.

Đã khởi động Docker Desktop và service MinIO local hiện có, giữ volume và bucket
private. Cấu hình storage hiệu lực của API đã được đối chiếu với local MinIO,
không ghi credential vào bằng chứng. Không đổi API/DTO, schema hoặc logic xuất bản.
Không thay đổi ảnh, nội dung hoặc publication trong database ứng dụng.

Kiểm chứng trực tiếp bucket local bằng một PNG tổng hợp có key ngẫu nhiên riêng:
Put xác nhận ETag/size, Get khớp từng byte, truy cập anonymous bị từ chối, Remove
và Stat xác nhận object thử nghiệm đã được dọn. Không đọc ảnh người dùng.

## Traceability

Nguồn: yêu cầu sửa ảnh của người dùng; SRS local
`docs/reports/BHome_Report-3_Software Requirement Specification.docx`, FE-09,
§III.9.1–9.2, UC-37 (Owner quản lý/xuất bản), UC-38 (Guest xem), GBR-01/02/17.
Mapping theo master UC local đã ghi trong
[biên bản triển khai](FE09_IMPLEMENTATION_2026-11-22.md).

| Hành vi cần bảo đảm                                 | Thành phần hiện có                                               | Bằng chứng                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Chỉ lưu metadata sau khi object được ghi thành công | `OperationsService.UploadPublicPhotoAsync`, `MinioObjectStorage` | Upload khi MinIO ngắt trả 503, danh sách ảnh vẫn trống                      |
| Hồi phục upload cho Location và Room                | Controller/service/repository + private MinIO                    | Khởi động lại container thử nghiệm, upload thành công, Owner đọc đúng byte  |
| Chỉ Guest xem ảnh đã duyệt                          | Snapshot publication + public photo proxy                        | Trước publish 404; sau publish đúng byte; unpublish 404; Owner vẫn xem được |
| Xóa ảnh thu hồi truy cập                            | Photo delete/preview                                             | Owner preview sau xóa trả 404                                               |

## Thay đổi trong lần sửa này

- `scripts/Start-LocalStorage.ps1`: lệnh khôi phục riêng MinIO local theo `.env`;
  kiểm tra Development, loopback, HTTP/port và chờ health. Có `-CheckOnly`.
  Không reset database/volume, không build/pull image hoặc đổi credential.
- `package.json`: thêm `npm.cmd run storage:dev`.
- `BHOME_TEAM_ENVIRONMENT_SETUP.md`: hướng dẫn khởi động/kiểm tra kho ảnh và giới
  hạn của HTTP health so với kiểm tra credential/bucket/lưu dữ liệu thực tế.
- `PublicPhotoMinioTests.cs`: hai trường hợp Location/Room dùng MinIO thật và
  PostgreSQL thử nghiệm riêng; toàn bộ dữ liệu tổng hợp.

Các chỉnh sửa FE-09 có sẵn trước yêu cầu sửa ảnh được giữ nguyên. Không commit,
push, merge hoặc deploy.

## Kiểm tra đã thực hiện

| Kiểm tra                                                                                                           | Kết quả                 |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| MinIO health qua Postman CLI, không gửi report events                                                              | 1 assertion PASS        |
| Probe bucket local hiệu lực: ghi/đọc/private/xóa                                                                   | PASS                    |
| `npm.cmd run storage:dev` trên local đã thiết lập                                                                  | Exit 0                  |
| PowerShell parser; 5 trường hợp non-Development, remote, SSL mismatch, port mismatch, health offline; local health | PASS                    |
| `PublicPhotoMinioTests`, `OwnerPublicContentPreviewTests`, `MinioStorageRegressionTests` Release                   | 15 PASS, 0 FAIL, 0 SKIP |

`dotnet format` verify cho file C# mới, Prettier check package/tài liệu mới và
`git diff --check` đều PASS.

Lệnh test:

```powershell
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --no-restore --filter "FullyQualifiedName~PublicPhotoMinioTests|FullyQualifiedName~OwnerPublicContentPreviewTests|FullyQualifiedName~MinioStorageRegressionTests" --logger "trx;LogFileName=photos-final.trx" --results-directory .tools/fe09-photo-fix/trx
```

`BHOME_COMPACT24_TEST_ADMIN` trỏ đến PostgreSQL disposable trên loopback 55442,
không phải database ứng dụng. Hai test mới dùng MinIO container riêng. Các lần
test đầu thất bại tại fixture hồi phục do Docker cấp lại cổng ngẫu nhiên; đã cố
định cổng thử nghiệm và chờ health có timeout. Lần chạy cuối cả 15 test đều pass.
Log/TRX và probe nằm trong `.tools/fe09-photo-fix` (không theo dõi Git).

Không chạy lại toàn bộ CI/frontend vì lần sửa này không đổi mã sản phẩm frontend
hay backend. Browser verification của phiên người dùng chưa thực hiện được:
Computer Use dừng vì không xác minh chắc chắn URL hiện tại; không dùng cơ chế
điều khiển trình duyệt khác để vượt chặn. Không khẳng định `images.jpg` của người
dùng đã được lưu. Sau khi tải lại thành công, Owner cần xuất bản bản nháp đã
duyệt để ảnh xuất hiện ở Public Website.
