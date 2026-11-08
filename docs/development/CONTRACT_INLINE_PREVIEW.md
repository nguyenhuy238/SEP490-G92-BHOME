# Xem trước PDF hợp đồng nháp trong BHOME Mobile

## Nguyên nhân và phạm vi

Màn `MainDraftScreen` trước đây chỉ hiển thị metadata và gọi `expo-sharing` để mở file ngoài app.
Không có renderer inline. Backend đã tạo DOCX từ mẫu gốc và chuyển sang PDF bằng LibreOffice,
lưu file riêng tư ở MinIO và trả ID file. API download trả binary có JWT, không phải public URL.
Vì vậy chỉ thêm một nút mở file không thể hiển thị nội dung tài liệu ngay trong màn hình mobile.

Triển khai theo yêu cầu Redesign Contract Preview, liên quan UC-15/BF-03B và quyền Owner/Staff hiện có.
Giữ nguyên tạo/lưu Draft, người đã xác minh, snapshot, idempotency, ký, thu cọc và kích hoạt.
Không thay template DOCX, đơn giá, database, trạng thái phòng hoặc tạo tài khoản Tenant.
Giữ nguyên các thay đổi Toast/bàn phím đang có trong workspace.

## Giải pháp chạy trong Expo Go

Không thêm package hoặc native module. Backend dựng PNG động từ **chính PDF đã lưu** bằng
Poppler `pdftoppm` trong image converter hiện có. Đây không phải ảnh mẫu hoặc hợp đồng HTML dựng lại.
Client gọi API bằng transport có JWT hiện hữu, kiểm tra PNG và hiển thị từng trang bằng React Native Image.
Không đưa JWT vào URL, không dùng CDN PDF.js, không công khai MinIO hoặc trả object key cho client.

Inline hiển thị trang đầu thật. Nút mở rộng nằm ngay trên đầu khu vực tài liệu để không phải cuộn
qua toàn trang mới tìm được thao tác. Fullscreen có FlatList cuộn dọc, số trang, nút zoom 100–300%
và cuộn ngang khi phóng lớn. Chỉ render một nhóm trang gần viewport để hạn chế bộ nhớ.
Android/iOS dùng cùng API RN hiện có; Expo Go không cần development build mới.

Đây là trình xem các trang được render từ PDF, không phải native PDF engine. Chưa hỗ trợ tìm kiếm,
chọn/copy text hoặc liên kết tương tác trong trang. Người dùng vẫn có thể mở PDF gốc bên ngoài.
Giới hạn inline: 20 trang, cạnh dài mỗi trang tối đa 1800 pixel, nguồn PDF tối đa 10 MiB.
Tài liệu vượt giới hạn vẫn có thể tải PDF gốc qua endpoint cũ.

## Giao diện

- Summary gọn: Hợp đồng thuê phòng, phòng/cơ sở, thời hạn và badge trạng thái hợp đồng.
- Các hàng người đại diện, CCCD đã che và số người ở; badge xác minh riêng với trạng thái hợp đồng.
- Không lặp lại địa chỉ, biểu phí, hướng dẫn dài hoặc UUID trước khu vực preview.
- Bản PDF thật được ưu tiên ngay sau summary, có loading, lỗi ngắn, retry metadata và retry từng trang.
- Mở toàn màn hình dùng icon 44×44; PDF/DOCX là thao tác phụ dạng text button.
- `Lưu hợp đồng nháp` giữ ở footer; sửa thông tin quay về đúng form, giữ giá trị đã nhập.
- Bản nháp được lưu trước khi sinh tài liệu như luồng cũ. Lỗi converter vẫn giữ Draft/DOCX,
  không giả báo đã có PDF hoặc không cho xem gì mà không giải thích.
- Sau chỉnh sửa, file ID/key thay đổi: hủy request cũ, xóa trang cũ ngay và tải đúng bản mới.

## API bổ sung

Prefix giữ nguyên: `/api/v1/contracts/main-drafts`.

- `GET /{id}/documents/{fileId}/preview`: `DraftPreviewInfo { fileId, pages: [{ number, width, height }] }`.
- `GET /{id}/documents/{fileId}/pages/{page}`: binary `image/png`, `Cache-Control: private, no-store`.
- `POST /{id}/documents` và `GET /{id}/documents/{fileId}` vẫn tạo/tải PDF/DOCX như cũ.

Metadata và trang đều đi qua `CopyFileAsync`: kiểm tra role, phân công Location, đúng Contract/File,
snapshot hiện tại, độ dài và SHA-256 từ MinIO trước khi parse/render. Từ chối DOCX ở endpoint PDF.
Owner/Staff được phép theo scope cũ; Tenant không được vào module main-drafts. Không tạo URL ký sẵn.
HTTP 401/403/404/409/503 được giữ đúng; mobile dùng thông báo ngắn và retry, không bỏ qua quyền.

`PrivateContractConversion` dùng chung việc chạy LibreOffice và Poppler. Container không mạng,
read-only rootfs, drop capabilities, giới hạn CPU/RAM/PID, tối đa hai tiến trình đồng thời,
timeout 45 giây và xóa container/thư mục request khi kết thúc/hủy. Linux dùng UID/GID process API
với workspace 0700. Không ghi trang preview vào database/MinIO hoặc thư mục public.

Client giữ PNG trong bộ nhớ theo vòng đời component. Đổi tài liệu/đóng viewer hủy request;
app chuyển nền đóng fullscreen, gỡ trang và tải lại khi quay lại. Bytes tạm được xóa sau encode.
PDF/DOCX mở ngoài dùng cache riêng hiện hữu, xóa file trong finally kể cả khi share thất bại.

## Cấu hình triển khai

Image đã có `pdftoppm` trong `deploy/docker/ContractConverter.Dockerfile`; không cần thêm package.
Development/CI tiếp tục dùng:

```powershell
docker build -t bhome/contract-converter:local -f deploy/docker/ContractConverter.Dockerfile .
```

`MainDraft:LibreOfficeContainerImage=bhome/contract-converter:local` chạy cả chuyển PDF và preview.
Nếu dùng native LibreOffice thay Docker, cấu hình thêm đường dẫn đầy đủ `MainDraft:PdfToPpmPath`
đến executable Poppler. Thiếu Poppler trả lỗi rõ ràng; PDF/DOCX gốc vẫn tải được khi tồn tại.
Không có migration hoặc thay đổi bucket/credential. API cần khởi động lại để nhận endpoint mới.

## File của lượt triển khai preview

- Application: `MainDraftContracts.cs`, `MainDraftService.cs`.
- API: `Controllers/MainDraftsController.cs`.
- Infrastructure: `Contracts/PrivateContractConversion.cs`, `MainDraftPreviewRenderer.cs`,
  `MainDraftRenderer.cs`, `DependencyInjection.cs`.
- Client chung: `packages/client-core/src/mainDrafts.ts`.
- Mobile: `features/contracts/MainDraftScreen.tsx`, `ContractPdfPreview.tsx`,
  `ContractPreviewSummary.tsx`, `pdfPreview.ts`.
- Backend tests: `Contracts/MainDraftApiTests.cs`, `MainDraftPreviewTests.cs`.
- Mobile tests: `main-draft-screen.test.tsx`, `contract-pdf-preview.test.tsx`, `pdf-preview.test.ts`.
- Tài liệu này và cập nhật hướng dẫn Main Tenancy Draft.

## Kiểm tra thực tế

- Backend build: 0 warning/error.
- 44 test API/renderer PASS, gồm 10 case main-draft hiện có, 5 case parse/giới hạn preview,
  29 test PDF renderer cũ; thêm 8 test workflow guard PASS.
- Test thực với PostgreSQL + MinIO + LibreOffice + Poppler: metadata khớp số trang PDF,
  PNG trang đầu/cuối khác nhau, MIME/giới hạn pixel/no-store đúng. Owner đọc được;
  anonymous/Tenant/Staff ngoài scope bị từ chối. Thiếu file, DOCX, sai số trang,
  MinIO lỗi và file cũ sau sửa Draft đều bị xử lý đúng. Bản sửa sinh file ID mới;
  Contract vẫn Draft, không chữ ký và phòng không đổi trạng thái.
- Mobile: 331 test PASS. Có test inline, fullscreen nhiều trang, zoom, loading, lỗi auth/API,
  binary sai, lỗi decode, retry, file ref sai, đổi file/hủy request và chuyển nền.
- Tải PDF/DOCX qua client và xóa cache khi chia sẻ thành công/thất bại đã có test.
- TypeScript Mobile/Owner Web, lint, Android export PASS. Không thêm dependency.
- Đã xem trực quan cả 3 trang từ PDF tổng hợp, gồm trang được API trả về: tiếng Việt,
  thông tin người thuê, Ngày cấp, giá và điều khoản có đủ, không thay tài liệu bằng metadata.

Chưa kiểm thử thao tác native viewer/chia sẻ trên iPhone hoặc điện thoại Android thật.
Không thể chọn/copy text từ các trang raster; có thể dùng PDF gốc cho nhu cầu đó.
Module này là Draft thuê chính từ hồ sơ đã xác minh; không tự dựng luồng Holding đang thiếu dữ liệu nền.

Tham khảo API đã đối chiếu: [Expo 58](https://docs.expo.dev/versions/v58.0.0/),
[React Native Image](https://reactnative.dev/docs/image), [FlatList](https://reactnative.dev/docs/flatlist).
