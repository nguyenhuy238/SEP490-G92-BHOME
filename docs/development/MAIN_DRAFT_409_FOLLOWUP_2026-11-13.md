# Điều tra tiếp lỗi 409 Main Draft

## Truy vết và kế hoạch

Yêu cầu ngày 13/11/2026: BF-03/04, UC-15/16, GBR-04; quyết định `BHOME_NQH_BUSINESS_DECISIONS_2026-11-10.md` BR-07/09/26. Giữ nguyên phương thức ký, quyền truy cập, snapshot và điều kiện kích hoạt. Nhánh `member/QHuy`, base `654e5427`, working tree ban đầu sạch.

1. Đối chiếu metadata chỉ đọc của contract được báo lỗi; kiểm tra vòng đời PDF trên Compact24 đang triển khai thay vì chỉ schema test legacy.
2. Sửa recovery Owner: không giữ tài liệu/review qua thay đổi resource, không tiếp nhận response cũ, không tạo đồng thời, xử lý trạng thái đã release, xóa lỗi sau recovery.
3. Gộp thông báo lỗi tài liệu vào viewer, giữ một hành động recovery; kiểm tra responsive và workflow ký hiện có.
4. Chạy test Mobile/backend, lint/typecheck/format/build/export; commit từng phần đã kiểm chứng.

Acceptance: create → generate → preview → update → old PDF 409 đúng code → generate → new PDF preview; configuration đổi yêu cầu lưu lại; recovery không PUT điều khoản, không double POST; chuyển route không nhận response cũ; non-Draft chuyển workflow hiện tại; lỗi chỉ một lần; ký/release/activation dựa vào backend.

## Bằng chứng ban đầu

- Không có listener 8081/7240 khi bắt đầu. Database loopback không chứa contract được báo; database cấu hình `.env` chứa contract đó. Chỉ chạy `BEGIN READ ONLY` / SELECT / COMMIT, không sửa business records.
- Contract ở Draft, version 20; 20 document records: 18 cũ không khớp snapshot, cặp DOCX/PDF mới nhất khớp snapshot. Không lấy PII, nội dung tài liệu, token hoặc thông tin kết nối vào báo cáo.
- `CopyFileAsync` trả `draft_document_outdated` khi file hash snapshot khác contract. Chưa có capture HTTP của fileId người dùng đang mở; không khẳng định fileId nào trong 18 tài liệu cũ đã được request.
- Các thiếu sót frontend xác nhận từ source: state tài liệu không reset khi initialId đổi; request generation dùng alive flag có thể nhận kết quả sau resource change; recovery thấy non-Draft chỉ throw; blocker không xóa sau generate thành công; lỗi document đồng thời hiện ở màn hình và viewer. Signing review xóa file khi 409 nhưng cũng làm mất viewer/recovery.

## Kết quả

### Nguyên nhân chính đã xác nhận

Người dùng cung cấp response thật lúc 15:16:14 UTC: **409 `contract_document_integrity_failed`**, không phải `draft_document_outdated`. FileId `425a8b96-b541-45f0-acf8-13e9b0b4f42e` khớp snapshot hiện tại. Các request lặp lại cùng fileId không thể sửa sự cố storage.

MinIO cấu hình tại localhost:9000 không có listener; container `bhome-dev-minio-1` đang dừng. Chẩn đoán chỉ đọc dùng đúng SDK 6.0.4/config trả **0 byte** (hai lần async, một lần sync), trong khi metadata yêu cầu **62.216 byte**. SDK hoàn tất mà không gọi callback; adapter cũ không kiểm tra điều này, nên `CopyFileAsync` so bytes rỗng và trả lỗi integrity. Adapter upload cũng chưa kiểm tra ETag/kết quả upload. Sau khi khởi động lại đúng container và volume cũ, đọc file nói trên trả **ObjectNotFoundException**: metadata tồn tại nhưng object thiếu. Không sửa metadata/hash để ép hợp lệ.

Frontend còn có fallback coi mọi 409 chưa biết là thay đổi tài liệu. Vì integrity không thuộc nhóm recovery, nút thử lại gọi lại `/preview` cùng fileId. Backend `/documents` chỉ kiểm tra metadata PDF cùng snapshot rồi tái sử dụng nó mà không xác minh object; vì vậy tạo lại cũng không thay tệp thiếu/hỏng. Signing-review có cùng lỗi reuse.

### Sửa backend

- `MinioObjectStorage`: upload phải có ETag và length đúng; download phải nhận response và hoàn tất callback. Mất kết nối là `IntegrationUnavailableException` (HTTP 503), không còn tệp rỗng giả thành công. Object thiếu chuyển thành `FileNotFoundException` để tầng nghiệp vụ xử lý.
- `MainDraftService`: trước reuse DOCX/PDF/signing-review, xác minh bytes bằng length/SHA-256. Trong thao tác generate được gọi rõ ràng và chỉ khi Draft chưa ký, tệp thiếu/hỏng được sinh lại dưới ID/object key mới; giữ toàn bộ record cũ. Storage unavailable dừng thao tác, không ép hợp lệ hay thay điều khoản. Download thiếu object trả 404 `draft_document_missing`. Release vẫn kiểm tra đúng reviewed file, snapshot và bytes.
- Không thêm dependency, endpoint, bảng hoặc migration. Không chỉnh dữ liệu tài chính/chữ ký/contract bằng SQL.

### Kiểm chứng backend

27 test PASS: MainDraft API/release/preview, bốn case Compact24 và hai test MinIO thật. Có create → generate → preview → update → 409 đúng code với PDF cũ → generate fileId mới → PNG/PDF mới; configuration đổi yêu cầu save; thiếu/hỏng object sinh ID mới nhưng version/input/signatures không đổi; MinIO offline không báo upload/download thành công. PostgreSQL/MinIO test dùng container dùng một lần; LibreOffice converter thật. Fixture Compact24 dùng storage adapter trong bộ nhớ và được phân biệt với các ca MinIO thật.

Build Debug ban đầu bị DLL lock do Visual Studio/API của người dùng đang chạy. Chạy lại bằng `--artifacts-path .tools/owner-pdf-validation/dotnet` thành công, không dừng debugger của người dùng.

### Sửa Mobile

- Phân biệt integrity, object thiếu, snapshot cũ, configuration/template, timeout và 409 chưa biết. Integrity/missing có `Tạo lại PDF`, không bị coi là snapshot cũ.
- Recovery khóa chống double tap, tải latest Draft rồi generate một lần; không PUT điều khoản. Non-Draft chuyển workflow hiện tại. Thành công xóa blocker cũ, dùng fileId mới; lỗi chỉ xuất hiện một lần trong viewer Owner.
- Đổi resource/reload hủy request và xóa document/review trước; response đến muộn không thay state hoặc mở/tải tệp của resource cũ. Owner xem Draft chưa sửa không tạo một version mới.
- Signing-review giữ recovery sau khi bỏ file lỗi; checkbox cũ luôn bị xóa, configuration cần quay lại sửa/lưu nháp. Không đổi phương thức ký hay biểu diễn release thành đã ký.
- Owner không còn thấy dãy nút export/fullscreen bị vô hiệu khi không có tệp. Staff/Tenant giữ các nhánh workflow hiện hữu.

### Kiểm chứng Mobile/Web

- Full Mobile: **100 files / 1.090 tests PASS**, có regression Staff/Tenant. Lint, typecheck, Prettier và `git diff --check` PASS. Sau khi thêm guard cho download/refresh đến muộn, chạy lại 20 test MainDraftScreen, typecheck và lint các component: PASS.
- Owner Web contracts: **16 files / 63 tests PASS**; không sửa Owner Web.
- Workspace build, Expo Web export và `dotnet format whitespace --verify-no-changes` cho các tệp C# sửa: PASS.
- Chrome với API transport tổng hợp: cả `draft_document_outdated`, `contract_document_integrity_failed`, `draft_document_missing` → recovery → inline PDF → fullscreen/zoom 150% → Blob PDF → download → review → một release → PendingSigning. Mỗi case hai generation theo thao tác đọc/recovery, **không PUT**, không request ngoài dự kiến/page error. Kiểm tra 360/400/768/1280px không tràn ngang; ảnh/PDF/request paths tổng hợp ở `.tools/owner-pdf-validation/followup-*` (ignored).
- Browser test trên là UI regression với transport tổng hợp; PDF/PNG thật, MinIO thật và API được kiểm tra riêng trong backend suite. Không gộp thành MySign hoặc bank E2E thật.

### Tệp sửa và giới hạn

Backend: `MainDraftService.cs`, `MinioObjectStorage.cs`; tests: `MainDraftApiTests.cs`, `MinioStorageRegressionTests.cs`, `Compact24/MainDraftDocumentRegressionTests.cs`.

Mobile/shared: `MainDraftScreen.tsx`, `MainDraftSigningReview.tsx`, `ContractPdfPreview.tsx`, `pdfPreview.ts`, `packages/client-core/src/mainDrafts.ts`; tests: `main-draft-screen`, `rental-contract-flow`, `contract-pdf-preview`, `pdf-preview`. Không sửa Owner Web, Staff/Tenant screens hoặc thêm migrations.

Phiên localhost thực tế đã được đọc qua UI và xác nhận đúng route; không thực hiện ký/thanh toán. API đang chạy trong debugger dùng DLL cũ; đã yêu cầu người dùng restart sau commit backend `a91e6e29` để nạp sửa. Chưa tuyên bố preview của đúng contract đã PASS cho đến khi kiểm chứng sau restart. Android/iOS thiết bị, MySign/SMTP/bank thật: NOT RUN. Production vẫn cần template được duyệt, Main deposit QR vẫn phụ thuộc API hiện có.
