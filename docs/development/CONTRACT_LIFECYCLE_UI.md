# D011/D012 — Giao diện kích hoạt và vòng đời hợp đồng

Ngày đối chiếu: 30/10/2026. Phạm vi: BF-03B/BF-04A, FE-03, UC-15/16/19;
GBR-01/02/04/18, DBR-02/03 và yêu cầu bảo mật, tiếng Việt, VND, ngày Việt Nam.

Nguồn: `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
(master UC, detailed UC-15/16/19, business rules, OQ-01/02/05),
`docs/reports/Report-4_Software Design Specification (5).docx`,
`docs/api/API_CONVENTIONS.md`, `CONTRACT_LIFECYCLE_DELIVERY.md`, controller/service/test hiện có.
Tên file báo cáo khác chỉ mục AGENTS; không giả định có phiên bản khác.

## Truy vết và tiêu chí chấp nhận

| Yêu cầu               | Lớp ảnh hưởng                                            | Chấp nhận / từ chối                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC-15, GBR-01/02      | Contract list DTO → service → repository → GET contracts | Phân trang trên DB, lọc quyền trước count/page; Tenant chỉ của mình, Staff chỉ Location có assignment còn hiệu lực; không trả CCCD/object key                                                 |
| UC-15, GBR-04, DBR-03 | Client API, Owner web, mobile Owner/Tenant               | Ký bằng chứng thư chính actor; gửi yêu cầu không hiển thị đã ký; sync/recovery không tự ký lại; PDF tải qua bearer                                                                            |
| UC-15, DBR-02, GBR-18 | Owner web → API kích hoạt/xác minh cọc hiện có           | Chỉ Owner xác minh cọc/kích hoạt; readiness từ server quyết định nút; retry cùng payload dùng lại idempotency key; không tự đánh dấu đã trả tiền                                              |
| UC-16                 | Web Owner / mobile Staff                                 | Gia hạn tạo phiên bản mới; ngày hết hạn tăng; giữ nguyên bản cũ; chỉ Owner hủy renewal đang chờ                                                                                               |
| UC-19                 | Web Owner / mobile Tenant, Staff                         | Tenant yêu cầu trước hạn; Owner khởi tạo hết hạn, duyệt và quyết toán; Staff đặt lịch, upload ảnh, nhập reading ID đã xác nhận và biên bản; không giải phóng phòng khi ledger chưa giải quyết |
| NFR client            | Validation, component/service tests                      | Không mất chính xác số VND lớn; ngày date-only không qua UTC; lịch nhập giờ Việt Nam gửi UTC; lỗi mạng/409/503 không trả thành công giả; không dùng dữ liệu mẫu trong phiên thật              |

## Thiết kế

Giữ React/MUI Owner Portal, Expo mobile, JWT/refresh client và layering backend hiện có.
Thêm GET danh sách hợp đồng có page/pageSize, Location và trạng thái; DTO chiếu nhãn phòng,
Location và kỳ thuê. Không thay schema, state machine hay quy tắc tài chính. Các mutation tiếp tục
đi qua ContractService, transaction khóa Room, audit và khóa idempotency hiện có.
Client không lưu token/hợp đồng/chứng thư vào localStorage; dữ liệu chỉ nằm trong bộ nhớ phiên.
Preview/mock hiện có được tách khỏi UI gọi API thật.

Kiểm thử DB trống phát hiện lỗi có sẵn: `PropertyConfiguration` đã tạo `Rooms.Status`
(Available=0, OnHold=1, Occupied=2, Unavailable=3, default=3), nhưng
`ContractActivationLifecycle.Up` thêm lại cùng cột và `Down` xóa cột của Property.
Đã bỏ hai thao tác trùng trong migration Contract, giữ nguyên trạng thái/default/constraint của
Property. Đây là sửa chuỗi migration từ DB trống, không tạo schema/policy mới. Không chạy trên
DB người dùng. DB đã áp dụng migration từ nhánh lịch sử khác cần so sánh schema và ý nghĩa
giá trị trạng thái trước rollout; bản sửa này không tự chuyển đổi dữ liệu lịch sử.

OQ-01/02/05 vẫn mở. MySign/PDF renderer, Holding ledger và settlement ledger có giới hạn như
bàn giao backend: UI chỉ phản ánh pending/blockers và lỗi 503, không thay provider bằng ký vẽ/OTP,
không tự tính phí/khấu trừ, không xác nhận quyết toán bằng checkbox. Chưa bổ sung JOB-02,
notification, addendum ngoài renewal hoặc baseline bàn giao tài sản.

## Các phần đã nối

- Owner web `/contracts`: danh sách thật có phân trang/lọc cơ sở và trạng thái, mở chi tiết,
  tạo Main draft với người đại diện/co-occupants, khai báo chứng thư của chính actor, ký/sync/recovery,
  tải PDF riêng tư, xem blockers/cọc, xác minh sao kê và kích hoạt; chuẩn bị/hủy renewal;
  lập trả phòng hết hạn, duyệt/đặt lịch, tạo tác vụ Final, xem biên bản/ảnh và lịch sử quyết toán,
  ghi nhận quyết định và chỉ cho hoàn tất khi server trả Settled.
- Mobile phiên thật: mở **Hợp đồng & Vòng đời** từ màn hình chính; Tenant xem hợp đồng của mình,
  ký/sync/recovery, tải tài liệu, yêu cầu chấm dứt trước hạn và theo dõi trả phòng/quyết toán.
  Staff tạo nháp/gia hạn, đặt lịch, chụp ảnh hiện trạng và lập biên bản bằng chỉ số Final đã xác nhận.
  Owner có các thao tác nhanh theo cùng quyền và trạng thái. Không thêm quyền ký/duyệt/cọc cho Staff.
- API danh sách mới và metadata tương thích ngược được ghi tại
  [CONTRACT_LIFECYCLE.md](../api/CONTRACT_LIFECYCLE.md). Không thêm state/table/provider mới.
- UI dùng chung validation, DTO và mô tả thao tác tại `packages/client-core/src/contracts.ts`;
  readiness lấy từ server. Tiền VND dùng chuỗi/BigInt khi hiển thị, không đi qua Number;
  lịch Việt Nam gửi UTC; định dạng instant dùng năm bốn chữ số.
- Mobile thêm `expo-crypto` (UUID idempotency) và `expo-sharing` (mở/lưu file riêng tư sau thao tác
  của người dùng), cài bằng Expo CLI cho SDK 58. File tải tạm trong cache ứng dụng được xóa sau
  khi đóng hộp chia sẻ; cache còn sót được dọn khi khởi động. Không lưu token vào URL.
  Đã đối chiếu [Crypto SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/) và
  [Sharing SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/sharing/).

## Cách mở

Owner web dùng cấu hình `src/owner-web/.env.local`: `VITE_API_MODE=api` và
`VITE_API_BASE_URL` trỏ đến backend HTTPS đang chạy; chạy
`npm run dev --workspace src/owner-web`, đăng nhập Owner và mở `/contracts`.
Chế độ mock vẫn giữ dữ liệu minh họa, không gọi API hoặc tạo chữ ký/thanh toán thật.
Mobile đăng nhập tài khoản thật rồi mở **Hợp đồng & Vòng đời**; route chuẩn bị hợp đồng của
Staff, hợp đồng/yêu cầu của Tenant và signing đều dùng cùng module dữ liệu thật.

Chưa có API tra cứu tài khoản Tenant dành riêng cho lập hợp đồng. Biểu mẫu hiện yêu cầu UUID
tài khoản Owner/Tenant đã có, khác UUID hồ sơ Resident; backend xác minh tài khoản/vai trò.
Danh sách người ở lấy từ API capture, chỉ cho chọn hồ sơ đã xác minh tại Room đã chọn.
API capture vẫn giới hạn 100 tác vụ/lựa chọn như trước; nếu có nhiều hơn, cần phát triển
phân trang/tra cứu phù hợp quyền, không tự tải toàn bộ tài khoản hoặc dữ liệu ngoài phạm vi.

## Kiểm chứng thực thi trong lượt này

Sử dụng dữ liệu tổng hợp, PostgreSQL 16/MinIO Testcontainers; không thao tác DB người dùng.
Các check JS cuối dùng Node 22.23.4 cục bộ theo engines của repo. Lần gọi npm/npx ban đầu qua
PowerShell bị ExecutionPolicy chặn; đã dùng `.cmd`. Hai lần Expo install ban đầu chạy Node 24
và báo EBADENGINE; sau đó chuyển sang Node 22 cho kiểm tra. Không dùng kết quả bàn giao cũ làm PASS.

| Lệnh / kiểm tra                                                                                                                                           | Kết quả                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dotnet build src/backend/BHome.sln --no-restore`                                                                                                         | PASS, 0 warning/error                                                                                        |
| `dotnet test tests/backend/BHome.IntegrationTests --filter FullyQualifiedName~ContractLifecycleApiTests --no-restore`                                     | PASS 17/17; bao gồm 2 case danh sách mới và kiểm tra metadata reading/scope                                  |
| `dotnet test src/backend/BHome.sln --no-restore`                                                                                                          | FAIL: Domain 56/56, Application 161/161; IT 234 PASS, 15 FAIL, 0 skip                                        |
| `npm run test --workspace src/owner-web`                                                                                                                  | PASS 53/53; gồm 7 UI/hook case mới                                                                           |
| `npm run test --workspace src/owner-web -- src/features/contracts/Contracts.test.tsx` sau sửa cuối                                                        | PASS 5/5 ở lượt trước; lượt cuối toàn bộ suite bao gồm 7/7 Contract UI/hook                                  |
| `npm run test --workspace src/mobile`                                                                                                                     | PASS 102/102; gồm 19 case Contract/shared transport mới                                                      |
| `npm run build --workspace src/owner-web` với `VITE_API_MODE=api`                                                                                         | PASS; còn cảnh báo chunk dùng chung >500 kB của portal                                                       |
| `npm run typecheck --workspace src/mobile`                                                                                                                | PASS                                                                                                         |
| `npm run lint --workspace src/mobile`; ESLint các file client-core/Contract web và test mới                                                               | PASS                                                                                                         |
| `npx expo export --platform ios --output-dir ../../.tools/contract-ui-ios` tại mobile                                                                     | PASS bundle; không phải build binary hoặc chạy thiết bị                                                      |
| Export iOS debug `--no-bytecode --source-maps`                                                                                                            | PASS; kiểm tra map chỉ có React 19.3.0 của mobile, không nhập thêm bản React 19.3.1 của Owner                |
| Edge headless, viewport 1440×1000 và 390×844                                                                                                              | PASS luồng thiếu cọc → xác minh → kích hoạt, có xác nhận; API mô phỏng tổng hợp, không MySign/ngân hàng thật |
| `git diff --check`; Prettier các file TS/TSX/docs sửa mới                                                                                                 | PASS                                                                                                         |
| `dotnet ef migrations has-pending-model-changes --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure --no-build` | FAIL do snapshot hiện có thiếu navigation `Contract.Residents`; chưa kết luận model đồng bộ                  |

Các lượt IT trung gian: ban đầu 17 case không khởi tạo được DB vì `Rooms.Status` bị thêm trùng;
sau sửa migration, fixture Contract thiếu ChainId bắt buộc của SingleSystemChain. Đã cập nhật
fixture lấy Chain có sẵn trong DB test. Hai test mới từng lỗi deserialize decimal string và
fixture assignment trùng phạm vi; đã sửa annotation/fixture, giữ nguyên constraint. Lượt Contract
cuối 17/17, không bỏ/skip test. Test UI trung gian sửa thao tác mở select và mock Response chỉ
được đọc một lần; không thay điều kiện nghiệp vụ để làm test pass.

## Lỗi và giới hạn còn lại

- 15 IT thất bại thuộc `PropertyApiTests` (13) và `SingleChainTests` (2): các nhánh validation,
  scope, conflict/concurrency trả 500 thay vì 400/404/409. `ApiExceptionHandler` hiện chưa map
  exception Property; file này không được sửa trong lượt UI Contract. Không tuyên bố toàn bộ
  backend đạt hoặc các nhánh Property đã được kiểm chứng thành công.
- Model snapshot hiện có khai báo `Contract.Residents` nhưng thiếu mapping tương ứng, khiến
  EF tooling không dựng được snapshot. Lần đầu command thiếu env connection; chạy lại với
  connection giả tới cổng 1 (không kết nối DB) phát hiện lỗi snapshot như trên. Không tự phát sinh
  migration để gộp/sửa toàn bộ schema. Test migration Up/Down Room cũ trong Property suite đã PASS.
- MySign thật, template/PDF signer được phê duyệt, Holding ledger, invoice/refund/deposit ledger
  thật vẫn có giới hạn bàn giao backend. OQ-01/02/05 chưa có quyết định mới. UI không vượt qua
  các blocker này. Không chạy E2E ký/đối soát/quyết toán thật hoặc giải phóng phòng thật.
- NOT RUN: thao tác camera/chia sẻ trên iPhone/Android thật, Android binary, hiệu năng/coverage,
  rollout hoặc xác minh schema DB đang sử dụng. UI test web và browser dùng adapter/API tổng hợp;
  integration Contract dùng provider/ledger test như bàn giao trước.
- Không đổi `.env`/secret, không commit, push, merge hoặc publish. Không có migration mới;
  sửa file migration Contract cũ cần được review cùng lịch sử schema trước triển khai.

Artifacts cục bộ (gitignored): `.tools/contract-test-results/` (TRX),
`.tools/contract-browser/` (kịch bản và screenshot tổng hợp), `.tools/contract-ui-ios*` (bundle).
