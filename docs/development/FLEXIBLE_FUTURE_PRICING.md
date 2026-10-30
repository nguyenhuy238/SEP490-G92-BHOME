# Sửa chính sách giá tương lai chưa sử dụng

Quyết định chủ dự án ngày 30/10/2026: áp dụng hướng linh hoạt hơn đã đề xuất, cho sửa chính sách
giá tương lai chưa dùng, giữ lịch sử giá đã có hiệu lực hoặc đã dùng cho hóa đơn. Phạm vi chỉ BE,
test, migration và Postman; không thay FE hoặc nới hiệu lực ngay trong ngày.

Nguồn: BF-01 / UC-06 A3–A4 / GBR-08 và quyết định thay đổi này. Thay thế lựa chọn cũ cấm mọi
chỉnh sửa policy tại docs/api/PROPERTY_MANAGEMENT.md; không thay công thức tiền hoặc chính sách cọc.

## Thiết kế và tiêu chí chấp nhận

- PUT `/api/v1/billing-policies/{id}` dành cho Owner. Body có policy và expectedVersion như
  replacement; không thay Location/Room Type/Room, category hoặc chargeCode của bản ghi.
- Chỉ sửa khi EffectiveFrom cũ và mới đều sau ngày hiện tại tại Việt Nam, FirstUsedAt null.
  Cho đổi name/rate/effectiveFrom/effectiveTo; giữ ID, tăng Version và audit đầy đủ snapshot.
- Giá đã bắt đầu, kể cả hôm nay, hoặc đã được dùng thì từ chối 409. Giá đang hiệu lực tiếp tục
  thay bằng POST replacement. Chưa hỗ trợ sửa hồi tố hoặc đổi giá hiệu lực ngay hôm nay.
- Validate rate, scope, precision, ngày và phương thức theo quy tắc hiện có. Cấm chồng kỳ cùng
  phạm vi/mã khoản thu kể cả song song. Transaction/khóa Location và DB exclusion constraint
  bảo vệ việc sửa; stale version hoặc xung đột rollback cả dữ liệu và audit.
- Thêm FirstUsedAt nullable (UTC) cho BillingPolicy. Mốc lần dùng đầu không được xóa/ghi lại.
  Request cấu hình không nhận field này; không có API Owner tự đánh dấu hoặc mở khóa.
- Trigger DB cho sửa nội dung/kỳ của policy tương lai chưa dùng; khóa identity/phạm vi/mã khoản
  thu, bảo vệ bản đã dùng/đã bắt đầu và giữ nhánh kết thúc kỳ hiệu lực có kiểm soát.
- Staff/Tenant không được PUT; Guest 401; Staff đọc vẫn theo assignment hiện hành.
- Test positive, bắt đầu hôm nay/quá khứ, đã dùng dù ngày bắt đầu tương lai, scope/mã thay đổi,
  dữ liệu sai, phiên bản cũ/song song, overlap và rollback/audit; kiểm tra DB không thể mở khóa.

## Giới hạn tích hợp billing

Repository hiện chưa có model Invoice/InvoiceLine hoặc quan hệ lưu policy đã sử dụng. Không
khẳng định đã kiểm tra được việc dùng giá xuyên luồng hóa đơn thật. FirstUsedAt là ràng buộc
lưu trữ để tích hợp: khi bổ sung billing, luồng tạo dữ liệu tham chiếu/snapshot policy phải
đánh dấu lần dùng đầu trong cùng transaction và khóa Location, trước khi commit. Không được
chỉ đọc rate rồi tạo Invoice mà bỏ qua mốc này. Tạo Invoice/backfill dữ liệu cũ cần regression
cho race giữa dùng giá và PUT; không có dữ liệu Invoice thật nào được tạo trong đợt này.

Migration mới cập nhật trigger thay vì sửa migration đã áp dụng. Nếu rollback có dữ liệu
FirstUsedAt thì phải dừng để không mất dấu sử dụng; cần kế hoạch rollback được duyệt.

## Kết quả kiểm tra ngày 30/10/2026

- Migration: `20261030032653_FlexibleFutureBillingPolicies`.
- Build: `dotnet build src/backend/BHome.sln --artifacts-path .tools/single-chain-build --no-restore -m:1 -p:UseSharedCompilation=false`: PASS, 0 warning/error.
- `dotnet test src/backend/BHome.sln --artifacts-path .tools/single-chain-build --no-build --no-restore --filter 'Category!=Docker' -m:1`:
  PASS 211 test (Application 78, Domain 56, Integration không Docker 77).
- Native PostgreSQL thử nghiệm riêng 18, port 55491; mỗi fixture tạo/xóa database ngẫu nhiên:
  `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --artifacts-path .tools/single-chain-build --no-build --no-restore --filter 'FullyQualifiedName~PropertyApiTests|FullyQualifiedName~SingleChainTests|FullyQualifiedName~LocationAssignmentApiTests|FullyQualifiedName~PermissionApiTests|FullyQualifiedName~PostgresAuthenticationTests|FullyQualifiedName~AuthenticationSecurityTests' -m:1`:
  PASS 108 test. Chưa thay thế CI PostgreSQL 16/MinIO hoặc tích hợp Invoice chưa có trong repo.
- Đã kiểm tra sửa future giữ ID/tăng version/nhật ký/giá tra cứu mới; đã dùng dù ngày bắt đầu
  tương lai vẫn bị khóa; không thể xóa/ghi lại mốc sử dụng bằng SQL; rollback migration khi có
  mốc sử dụng bị từ chối và giữ nguyên dữ liệu/schema; migration up/down khi chưa có usage PASS.
- Test ranh giới 17:00 UTC sang ngày Việt Nam mới, không cho PUT thành hiệu lực ngay hôm nay;
  validation/scope/rate/precision, phân quyền, stale/parallel edit, overlap rollback audit đều PASS.
- Postman: 87 request, JSON body/script hợp lệ; thêm 60a–60e tạo/xem/sửa/xem lại/stale-version.
  12 kịch bản lưu futurePolicyId/version khi thành công, không ghi khi lỗi, có/không Environment PASS.
- EF model khớp migration; whitespace và git diff --check PASS. Lượt whitespace đầu có lỗi
  định dạng/end-of-line của file mới; đã format lại và kiểm tra thành công.
- Không thay đổi FE; không commit/push/merge. Chưa chạy live các request PUT mới.

**Trạng thái local cập nhật ngày 30/10/2026:** sau yêu cầu trực tiếp "Áp dụng migration" của người
dùng, đã tạo bản sao lưu trong `.tools/database-backups/` và áp dụng
`20261030032653_FlexibleFutureBillingPolicies` bằng EF trên database `bhome` loopback.
Có 8 migration đã áp dụng, 0 pending; Chain vẫn đúng một bản ghi. Đã khởi động lại đúng BE local
qua scripts/Start-Api.ps1, xác minh `/health/ready` và `/health/live` đều 200 Healthy, Swagger có
PUT `/api/v1/billing-policies/{id}` và field response `firstUsedAt`. Không thay đổi FE.

Lệnh: `dotnet ef database update 20261030032653_FlexibleFutureBillingPolicies --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure --no-build`.
Thông tin kết nối được đọc nội bộ từ `.env`, không in credential. Kiểm tra live lần này chỉ gồm
migration/connectivity/readiness/liveness/Swagger, không tạo dữ liệu Invoice hay test business
mutation trên database người dùng. Trước yêu cầu trực tiếp này, automatic approval review từng
từ chối áp dụng; không dùng đường thực thi khác để né từ chối.
