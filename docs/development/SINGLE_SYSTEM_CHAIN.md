# Chain duy nhất của hệ thống

Quyết định chủ dự án ngày 30/10/2026: BHOME có **đúng một Chain**; chỉ cấu hình đổi tên,
không tạo/xóa thêm Chain. Location mới mặc định thuộc Chain này, không nhận lựa chọn Chain.
Quyết định này thay đề xuất chọn Chain ngày 29/10/2026. Nguồn nền: BF-01 / UC-04,
GBR-01/02/13, DBR-13; Report 3 UC-04 và Report 4 §3.1–3.2. Không đổi quyền global Owner.

## API và quyền

- Owner: `GET /api/v1/chain` trả `{id,name,version}`.
- Owner: `PUT /api/v1/chain` nhận `{name,version,reason?}`; name sau trim dài 1..150 ký tự.
  Giữ nguyên id, tăng version, lưu actor/UTC/reason/snapshot append-only. Không có field cấu hình khác.
- Staff/Tenant nhận 403, Guest chưa xác thực nhận 401 ở hai action cấu hình.
- Version cũ trả 409; hai Owner đổi tên đồng thời cùng version chỉ một thành công.
- `POST /api/v1/capture/chains` đã bỏ; không có POST/DELETE Chain mới. GET capture/chains cũ
  vẫn trả danh sách chỉ đọc chứa một Chain để tương thích client đọc cũ.
- POST/PUT `/api/v1/locations` nhận name/address/isActive/version/reason như trước, **bỏ chainId**.
  `/capture/locations` cũng bỏ chainId và dùng cùng PropertyService. Nếu client cũ còn gửi field
  chainId, field không còn bind vào DTO và không thể chọn/chuyển Chain; server luôn dùng Chain chung.
  Response Location vẫn có chainId chỉ đọc.
- Phạm vi theo xác nhận tiếp theo của chủ dự án: **chỉ BE và Postman, không thay đổi FE**.
  Mobile/Owner Web hiện tại được giữ nguyên. Client còn gọi POST tạo Chain sẽ nhận 405;
  việc đồng bộ giao diện với hợp đồng API mới nằm ngoài đợt này.
- Postman 25a xem tên/version, 25b tùy chọn đổi tên; 26 tạo Location mà không có chainId.
  chainVersion được lưu tự động vào Environment đang chọn hoặc Collection Variables.

## Schema và chuyển đổi

Migration `20261030023603_SingleSystemChain`:

1. Chưa có Chain: khởi tạo cấu hình chung tên `BHOME` (không tạo tài khoản hay dữ liệu Tenant).
2. Có đúng một Chain: giữ nguyên GUID và tên hiện tại.
3. Có nhiều Chain: **dừng migration**, không xóa/gộp/đổi các Chain; cần quyết định chuyển đổi
   cụ thể của chủ dự án. Toàn bộ migration rollback nếu gặp điều kiện này.
4. Location chưa có chainId được gắn Chain duy nhất; FK chainId trở thành bắt buộc.
5. Unique index hằng bảo đảm tối đa một Chain. Trigger cấm DELETE/TRUNCATE/thay ID Chain;
   vì migration đã tạo/giữ một bản ghi nên hệ thống luôn có đúng một Chain.
6. Thêm concurrency Version; PropertyChanges.LocationId nullable cho audit cấu hình toàn hệ
   thống. Không tạo Location giả để lưu audit Chain. Audit cũ giữ nguyên và vẫn append-only.

Down migration không xóa Chain hoặc sửa lại tên. Nếu đã có audit toàn hệ thống (LocationId null),
rollback sẽ dừng để không mất lịch sử hoặc gán audit sang Location giả; cần kế hoạch lưu trữ/rollback
được phê duyệt trước. Trường hợp chưa có audit này có thể rollback schema về PropertyConfiguration.

Kiểm thử: SingleChainTests kiểm tra tự gán Chain khi tạo Location kể cả đường capture, bỏ quyền
tạo Chain, Owner-only, validation, stale/parallel edit, audit, DB uniqueness/không xóa, migration
0/1/nhiều Chain và bảo toàn GUID/tên/Location. PropertyApiTests và LocationAssignmentApiTests được
cập nhật để không tạo Chain cho mỗi fixture. Không tuyên bố bao phủ toàn bộ BF-01.

## Kết quả thực thi ngày 30/10/2026

- Build solution dùng output riêng `.tools/single-chain-build`: PASS, 0 warning/error.
  Lệnh: `dotnet build src/backend/BHome.sln --artifacts-path .tools/single-chain-build -m:1 -p:UseSharedCompilation=false -p:NuGetAudit=false`.
- `dotnet test src/backend/BHome.sln --artifacts-path .tools/single-chain-build --no-build --no-restore --filter 'Category!=Docker' -m:1`: PASS 208 test (Application 76, Domain 55, Integration không Docker 77).
- PostgreSQL thử nghiệm riêng, cổng 55491, fixture tạo/xóa database độc lập:
  `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --artifacts-path .tools/single-chain-build --no-build --no-restore --filter 'FullyQualifiedName~SingleChainTests|FullyQualifiedName~PropertyApiTests|FullyQualifiedName~LocationAssignmentApiTests|FullyQualifiedName~PermissionApiTests|FullyQualifiedName~PostgresAuthenticationTests|FullyQualifiedName~AuthenticationSecurityTests' -m:1`:
  PASS 101 test. Native PostgreSQL 18, chưa thay thế một lượt CI PostgreSQL 16/MinIO.
- Một lượt test trước đó FAIL do fixture lấy toàn bộ audit đổi tên của nhiều test dùng chung
  Chain; đã lọc theo reason riêng từng test. Không thay hoặc xóa audit production để sửa test.
- Các kiểm tra mobile trước đó đã PASS nhưng phần thay đổi FE đã được hoàn tác theo yêu cầu
  chỉ cập nhật BE. Diff hiện tại không có thay đổi trong mobile/Owner Web/Public Web.
- Postman: JSON/54 body/82 event scripts hợp lệ; không còn chainId trong payload hoặc POST tạo
  Chain; bốn kịch bản lưu chainVersion với/có và không có Environment đều PASS.
- EF `has-pending-model-changes`: PASS, model khớp migration.
- `git diff --check`: PASS. Không commit/push/merge hoặc hoàn nguyên thay đổi có trước.
- NOT RUN: mobile UI/E2E, trọn bộ Docker/MinIO, chạy live các request Postman mới.

**Trạng thái local cập nhật 30/10/2026:** sau khi người dùng yêu cầu rõ cập nhật migration để
khắc phục readiness, đã tạo bản sao lưu trong `.tools/database-backups/` và áp dụng
`20261030023603_SingleSystemChain` bằng EF. Database `bhome` local có đúng một Chain,
7 migration đã áp dụng và 0 pending. `/health/ready` và `/health/live` đều trả 200 Healthy.
Không cần restart tiến trình API đang chạy để readiness cập nhật. Không thay đổi FE.

Lệnh cập nhật: `dotnet ef database update 20261030023603_SingleSystemChain --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure --no-build`.
Kết nối được đọc từ `.env` vào biến môi trường của tiến trình, không in hoặc ghi credential
vào tài liệu. Trước khi được phê duyệt rõ ràng, automatic approval review từng từ chối việc áp
dụng schema; chỉ thực hiện sau yêu cầu trực tiếp của người dùng, không né cơ chế này.
