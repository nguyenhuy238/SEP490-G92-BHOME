# Test tay toàn bộ API BHOME bằng Postman

Cập nhật 09/11/2026. Bộ Simple là danh mục request để gửi tay, chia theo nhóm nghiệp vụ của [báo cáo API](../../reports/BHOME_BE_BUSINESS_FLOW_API_COVERAGE_2026-11-09.md).

## 1. Import và bắt đầu

Import hai file:

- [BHome.Simple.postman_collection.json](BHome.Simple.postman_collection.json).
- [BHome.Local.postman_environment.json](BHome.Local.postman_environment.json).

Chọn environment **BHOME Local**. Nếu đã import bản cũ, thay collection/environment cũ để tránh chọn nhầm. Chỉ chuyển các giá trị tài khoản và ID test còn dùng được sang bản mới; không export mật khẩu/token vào Git.

Collection có **376 request** trong **20 folder**:

- 372 cặp method–route của API chính, mỗi cặp có đúng một request.
- 2 bản đăng nhập bổ sung cho Staff/Tenant; bản chính dùng Owner.
- 2 health endpoint, nằm trong folder `00. Health và hướng dẫn`.

Các folder 01–19 tương ứng 19 phần nghiệp vụ. Có cả API alias và diagnostics đã kiểm kê; không cộng 15 route riêng của Sandbox ký số vào API chính.

Tại thư mục repository, sau khi cấu hình môi trường/database test:

```powershell
./scripts/Update-LocalDatabase.ps1 -Check
./scripts/Start-Api.ps1
```

`Start-Api.ps1` mặc định đọc `.env`; có thể dùng `-EnvironmentFile` để chọn cấu hình test riêng đã chuẩn bị. Không chạy migration legacy lên Compact24.

1. Folder 00: gửi `GET /health/ready`; kiểm tra kết quả 200.
2. Điền `ownerPassword`, `staffPassword`, `tenantPassword`; sửa email theo tài khoản test thật đang có. Các email `example.invalid` là gợi ý, collection không tự tạo tài khoản.
3. Folder 01: gửi ba request **OWNER / STAFF / TENANT — Đăng nhập và lưu token**. Script lưu riêng AccessToken, RefreshToken, UserId và SessionId từng role.
4. Chọn request cần thử trong nhóm nghiệp vụ, đọc Description, kiểm Body/Params rồi Send.

## 2. Giữ thao tác đơn giản

Mỗi API có method/URL, mô tả tiếng Việt, Bearer token mặc định theo role phù hợp và body mẫu dựa trên DTO/OpenAPI hiện tại. Không cần copy token cho từng request. Đổi token ở Authorization nếu chủ động kiểm tra quyền khác.

Gửi từng request theo luồng, **không Run toàn bộ collection**: nhiều request là nhánh thay thế như cancel/reject/rework, publish/unpublish, hoặc thao tác chốt/hoàn tiền/cấu hình. Thứ tự liệt kê trong folder không phải một script E2E có thể chạy liên tục.

Tests mặc định kiểm tra kịch bản hợp lệ trả 2xx và không có 5xx. Nếu bạn cố tình dùng sai quyền/dữ liệu để kiểm nhánh lỗi, cần đối chiếu mã lỗi theo API và đổi assertion tương ứng; màu đỏ của assertion 2xx không tự chứng minh backend sai.

## 3. Dữ liệu trong environment

Đã có ví dụ tổng hợp: tên/địa chỉ cơ sở, số phòng, tên người dùng test, số điện thoại test, lý do, tiền thuê/cọc, số tiền thanh toán, số đọc, tài khoản ngân hàng giả lập, thông tin định danh tổng hợp và các ngày/kỳ.

Các khoản tiền, lịch billing, kỳ/ngày và dữ liệu định danh chỉ là đầu vào mẫu để kiểm thử, không phải chính sách được dự án phê duyệt hoặc thông tin dùng trong hợp đồng thật. Không dùng giấy tờ/ngân hàng cá nhân thật.

| Nhóm biến                                                                        | Cách điền/sử dụng                                                                                                             |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                                                                        | Mặc định `https://localhost:7240`; sửa theo server test                                                                       |
| `owner/staff/tenantEmail`                                                        | Tài khoản test đang tồn tại                                                                                                   |
| `*Password`, `*AccessToken`, `*RefreshToken`, provider secret, push token        | Để trống trong file; tự điền khi dùng hoặc nhận qua login                                                                     |
| `locationId`, `roomId`, `residentId`, `contractId`, `invoiceId`, …               | Để trống vì chưa có bản ghi thật; script lưu từ response thành công phù hợp hoặc bạn điền từ GET                              |
| `*Version`, `staffAccountVersion`, `profileVersion`                              | GET bản ghi trước cập nhật; lấy version mới, không tự tăng bằng tay                                                           |
| `dateD0`, `dateD1`, `dateD2`, `contractEndDate`, `period`, `nowUtc`, `taskDueAt` | Có dữ liệu mẫu ngày 09/11; kiểm/sửa lại theo ngày test. Script chỉ điền `dateD0`/`period` nếu trống, không tự ghi đè lựa chọn |
| `assetTemplateItemId`                                                            | UUID tổng hợp cho item mới trong template; không phải ID bản ghi có sẵn                                                       |
| `idempotencyKey`                                                                 | Để trống: key mới mỗi lần Send. Điền UUID cố định: chủ động kiểm replay cùng thao tác/dữ liệu                                 |

Collection sẽ báo rõ biến còn trống trước khi gửi, ví dụ `locationId` hoặc `ownerAccessToken`. Đây là lời nhắc chạy bước tạo/GET/login trước, không phải lỗi server. Danh sách response không tự chọn bản ghi đầu tiên; bạn chọn ID cần dùng để tránh thao tác nhầm.

Các Params tùy chọn thường được tắt sẵn; bật khi cần lọc. Params cơ sở/phòng/kỳ dùng cho workflow có thể đã bật và cần ID thật. Đọc tên Params theo từng request.

## 4. Luồng nên thử

1. Owner tạo Location → Room → giá/phí → Staff và assignment. GET lại Location sau assignment vì version có thể đổi.
2. Tạo resident → OCR → Staff xác nhận dữ liệu → Main Draft/settings → tài liệu review → Owner release → ký/cọc/kích hoạt → bàn giao.
3. Tạo meter/task → ảnh/OCR → Staff confirm → Draft Invoice → Final → ghi nhận tiền được xác minh → allocate → xem công nợ/lịch sử.
4. Staff báo Incident → Owner review/assign → Staff proposal → Owner plan-decision → Staff start/submit → Owner verify → resolve.
5. Trả phòng → kiểm tra/review → quyết toán → hoàn/khấu trừ cọc nếu áp dụng → complete.
6. Kiểm Tenant isolation, residence, thông báo, finance/What-if và public publication bằng role tương ứng.

Đường Holding có `holdingContractId` riêng. Tạo Holding cũng chọn nó làm `contractId` cho các API ký dùng chung. Chuyển Holding/Main hoặc đổi sang hợp đồng khác cần kiểm lại `contractId`; release Main Draft lưu ID hợp đồng được phát hành vào biến này.

Không tự sửa trạng thái phòng/hợp đồng để bỏ qua điều kiện ký, tiền, kiểm kê hay quyết toán. Thiếu dữ liệu/phân công/provider thì ghi nhận Pending/Blocked theo phản hồi, không coi là thành công.

## 5. Ảnh và dịch vụ ngoài

- **Body → binary:** chọn file PNG theo Content-Type mặc định `image/png`; nếu chọn JPEG thì đổi header sang `image/jpeg` khi API cho phép.
- **Body → form-data:** chọn file ở trường Images/Evidence tương ứng; để Postman tự tạo Content-Type và boundary.
- Có ảnh tổng hợp tại [fixtures/synthetic-meter.png](fixtures/synthetic-meter.png). Ảnh này chỉ dùng kiểm upload/cơ chế fallback, không chứng minh độ chính xác OCR hoặc dùng thay mọi loại bằng chứng.
- Ảnh ký hiển thị không phải chữ ký số provider. Request MySign, email/push và OCR cần cấu hình/model phù hợp; không mặc định provider thật đã sẵn sàng.
- Notification reminders và billing automation trong mẫu mặc định tắt; chỉ thay cấu hình nếu bạn muốn kiểm tính năng đó theo quy tắc đã chốt.

## 6. Kiểm tra offline và tái sinh

```powershell
node scripts/postman/Validate-CurrentCollections.cjs
# Kiểm thêm trường và kiểu dữ liệu DTO với OpenAPI hiện tại:
node scripts/postman/Validate-CurrentCollections.cjs path/to/swagger.json
```

Validator kiểm cấu trúc folder, đủ route theo báo cáo, không duplicate ngoài ba login, biến tồn tại, credentials để trống, JSON/script syntax, body type/field theo OpenAPI nếu có, file uploads và một số tình huống lưu token/ID/version bằng response tổng hợp. Không gửi HTTP hoặc thay đổi database.

Tái sinh từ OpenAPI và MVC descriptors đã xuất từ backend hiện tại:

```powershell
python scripts/postman/Generate-SimpleCollection.py path/to/swagger.json path/to/descriptors.json
```

Generator đối chiếu inventory CSV và báo cáo trong repo; khi thay API cần cập nhật các nguồn này trước. Đây là thao tác **ghi lại** collection/environment mẫu, không dùng với file đã chứa credentials hoặc kết quả test cá nhân. Hãy giữ kết quả chạy riêng.

## 7. Kết quả kiểm tra bản cập nhật

- Danh mục: **372 API + 2 login bổ sung + 2 health = 376 request**, 19 folder nghiệp vụ + 1 folder health.
- Đã kiểm offline: **155 JSON bodies** khớp kiểu/trường OpenAPI; **15 binary uploads** có Content-Type; multipart fields và script hợp lệ; biến không trùng và secret để trống.
- Đã mô phỏng: token ba role lưu riêng; ID/version lưu sau thành công; assignment làm hết hiệu lực locationVersion; release Main Draft lưu contractId; giao dịch lưu paymentId; response lỗi không ghi đè ID; key mới/replay; báo biến thiếu.
- **Chưa chạy 376 request HTTP hoặc nghiệm thu nghiệp vụ/provider thật.** Body theo DTO không bảo đảm dữ liệu/phòng/hợp đồng đang thỏa mọi tiền điều kiện. Đây là danh mục test tay có mẫu, không phải kết quả 376 test pass.

Các file `BHome.NguyenQuocHuy.*` không được sửa trong lần này.
