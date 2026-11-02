# Contract Management — triển khai và demo Development

Branch: `member/QHuy`. Phạm vi: luồng hợp đồng đã có, tích hợp trực tiếp Owner Web và Expo Mobile. Các thay đổi được tổ chức thành commit local theo yêu cầu riêng của Nguyễn Quốc Huy; không push, merge hoặc deploy. Không sửa `.env*`, migrate hay reset database `bhome` của developer.

## Truy vết và giới hạn nghiệp vụ

Đã đối chiếu `AGENTS.md`, quy tắc Git, bốn tài liệu `HUY_*`, SRS tại `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`, Report 4 và [BH-16 renderer](BH16_CONTRACT_PDF_RENDERER.md). Các báo cáo audit cũ giữ nguyên kết quả tại thời điểm audit.

| Hành vi                                                | Nguồn / quyết định                                                   | Thành phần                                                          | Tiêu chí xác minh                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chuẩn bị Main Contract, representative và co-occupants | BF-03/BF-04, UC-13/15, GBR-01/02, DBR-02; giữ mô hình hiện hành D-01 | `ContractService`, `Resident`, preparation API, wizard hai client   | Staff đúng Location; resident đã verified; tài khoản Tenant đã liên kết; xung đột phòng bị backend chặn                            |
| Template, PDF từ sealed snapshot                       | UC-15, GBR-04, Report 4; chỉ template Development đã có của BH-16    | Renderer hiện có, `ContractDocumentFile`, private MinIO             | Phiên bản/hash được lưu; đúng Tenant; download kiểm tra hash; không lấy điều khoản từ frontend để render                           |
| Ký điện tử thật / mô phỏng                             | GBR-04; prompt hiện tại cho phép adapter demo qua port hiện có       | MySign hiện có + `DevelopmentContractSigningAdapter`                | Production/Staging không bật được simulation; không CA/private key; kết quả demo luôn `Simulated`, không `Signed`                  |
| Cọc và kích hoạt                                       | UC-15, GBR-04/10, DBR-02, invariants hiện có                         | Xác minh cọc và activation hiện có                                  | Owner đối chiếu tham chiếu sao kê; thiếu cọc/chữ ký chặn; chỉ backend chuyển Room sang Occupied                                    |
| Nhận phòng                                             | SRS UC-17 normal flow 1–10 và A1/A3                                  | Handover service/repository, snapshot/history/FK, Mobile, Owner Web | Active Main; Staff hiện được phân công; đủ condition/assets/keys/readings/photos; Tenant xác nhận phiên bản, Staff hoàn tất sau đó |
| Gia hạn / trả phòng                                    | UC-16/19 và guards hiện có                                           | Client actions + `RenewAsync`/inspection/settlement hiện có         | Gia hạn giữ lịch sử; không giải phóng phòng khi chưa có settlement ledger thật                                                     |
| Holding / chuyển cọc                                   | BF-03A/B, UC-14; OQ-03 và dependency ledger chưa được duyệt          | `IContractHoldingLedger` hiện có                                    | Hiển thị blocker; không tạo fake ledger, thời hạn, mất cọc hay hoàn tiền tự động                                                   |

Checklist nhận phòng ở đây gồm đúng các nhóm thông tin UC-17 nêu: hiện trạng phòng, kiểm kê/hiện trạng từng asset, chìa khóa/quyền truy cập, điện/nước có ảnh đã xác nhận và ảnh hiện trạng. Không thêm khoản phí, mức bồi thường hoặc quyền Owner mới. Checklist chi tiết bổ sung, thông báo quyết định xử lý thiệt hại và chính sách lưu trữ còn cần chủ dự án/module liên quan xác nhận.

## Tính năng đã nối

| Workflow     | Backend                                                                           | Owner Web                                    | Mobile                                                | Persistence                         | Demo                       |
| ------------ | --------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- | ----------------------------------- | -------------------------- |
| Cấu hình     | Template được server chọn, version/fields/availability/mode                       | Card cấu hình + chọn mẫu hợp lệ trong wizard | Bước cấu hình trong form                              | Template resource versioned hiện có | Development v1             |
| Tạo nháp     | Preparation theo quyền, liên kết resident–Tenant do Owner, validate draft hiện có | Wizard 3 bước, back/next, chọn dữ liệu thật  | Owner/Staff chọn dữ liệu thật, back/next              | PostgreSQL                          | Có                         |
| PDF preview  | Render snapshot, metadata, private upload, hash-verified read                     | Xem PDF trong trang / tải file               | Mở/lưu PDF qua transport có xác thực                  | PostgreSQL + MinIO                  | Có                         |
| Signing      | MySign giữ nguyên; demo adapter opt-in                                            | Gửi/sync/recover, đọc trạng thái và tài liệu | Signer thao tác bằng tài khoản của mình               | Signature/evidence/audit hiện có    | Simulated                  |
| Cọc / Active | Dùng guards và transaction hiện có                                                | Lịch sử cọc, readiness, verify, activate     | Tenant đọc; Staff không activate                      | Contract + Room + deposit + audit   | Có                         |
| Holding      | Ledger thật chưa có; policy còn mở                                                | Blocker hiển thị trong cấu hình              | Blocker trong bước tạo                                | Không tạo ledger giả                | Bị chặn                    |
| Bàn giao     | Snapshot từng version, dispute, xác nhận Tenant rồi Staff; file riêng             | Xem biên bản, ảnh, chỉ số, xác nhận, lịch sử | Staff lập/sửa; Tenant confirm/dispute; Staff hoàn tất | Handover/history, FK chỉ số, MinIO  | Có trên phòng demo mới     |
| Gia hạn      | Reuse service và kiểm tra hiện có                                                 | Action tạo/hủy gia hạn, mở hợp đồng trước    | Action theo role/state                                | Existing versioned contract         | Có, theo kỳ hiệu lực thật  |
| Move-out     | Reuse approve/schedule/final readings/inspection/settlement                       | Theo trạng thái thực                         | Tenant yêu cầu, Staff kiểm tra                        | Existing records                    | Phần tài chính còn Pending |

Đây chưa phải tuyên bố hoàn tất toàn bộ Contract Management production. Template production, MySign sandbox thật, Holding ledger/policy và settlement ledger vẫn là dependencies còn thiếu.

## Persistence và bảo vệ dữ liệu

- `Resident.TenantUserId` là liên kết tài khoản nullable. `OwnerUserId` hiện có vẫn là người tạo hồ sơ. Chỉ Owner liên kết hồ sơ đã verified với tài khoản Tenant active; không đổi liên kết sang tài khoản khác hoặc trái lịch sử đại diện. Draft mới có liên kết phải khớp Tenant signer. Dữ liệu cũ chưa liên kết vẫn đọc được.
- GET Contract bổ sung `roomNumber`, `locationName`, `occupants` (ID/nhãn workspace/vai trò đại diện) cho chi tiết dễ đọc. Không trả identity envelope, CCCD hoặc thông tin riêng của tài khoản. Link account và tạo Contract dùng cùng Room lock để tránh race giữa liên kết và signer.
- `Contract.IsDevelopmentDemo` là trạng thái mode bất biến tại lúc tạo; renewal kế thừa mode. Không thêm thuộc tính vào `ContractDocument` được dùng băm sealed snapshot, nên giữ định dạng hash cũ.
- `SignatureStatus.Simulated` nối cuối enum, giữ các giá trị cũ. PDF mô phỏng có dòng **SIMULATED SIGNING - NOT LEGALLY SIGNED** và metadata. Không có digital signature/certificate/private key do BHOME phát hành. Contract demo không được ký bằng adapter thật; khi tắt mode demo, readiness chặn activation demo.
- Preview có template/version, snapshot hash, file hash, length, actor/time. File private; Owner/Tenant qua API có kiểm tra scope và hash. Staff không tải PDF hay lịch sử cọc chi tiết. Upload intent và cleanup hiện có nhận biết file preview/handover đã liên kết.
- Handover giữ snapshot phòng/assets/readings/evidence, confirmation actor/time/version và history append-only. Save sau sửa tăng version và xóa xác nhận Tenant cũ. Tranh chấp cần Staff sửa trước khi Tenant xác nhận lại. Staff chỉ hoàn tất đúng version Tenant đã xác nhận. Room lock hiện có tuần tự hóa các mutation; `Version` cũng là concurrency token. Confirmed baseline bất biến.
- Điện/nước lấy từ readings đã human-confirmed, có ảnh, đúng Room/ngày bàn giao, meter còn active lúc lập biên bản. Chọn Initial hoặc Periodic đã được xác nhận làm baseline; không reset meter, không dùng Final, không tự nhập số tại biên bản. Snapshot và history có FK Restrict tới các reading để giữ bằng chứng. Ảnh điện/nước của biên bản được tải qua endpoint scoped theo Contract.
- Mỗi biên bản chọn 1–5 ảnh; từng ảnh PNG/JPEG tối đa 5 MB, validate nội dung. Tối đa 50 file nhận phòng trên một Contract để hỗ trợ sửa; không cho sửa/xóa metadata evidence. Asset inventory quá 200 mục bị chặn rõ, không âm thầm bỏ asset. History UI hiện đọc 100 sự kiện gần nhất; chưa có phân trang lịch sử sâu hơn.

Các migration mới:

1. `20261101101629_ContractWorkflowDocuments`: liên kết account, mode demo, file metadata và triggers bảo vệ.
2. `20261101103049_ContractMoveInHandover`: handover/history, unique Contract, version và triggers append-only/confirmed.
3. `20261101105753_ContractHandoverReadingReferences`: FK tới meter readings. Backfill **chỉ cột tham chiếu** từ snapshot đã có trong cùng transaction/locks; khôi phục evidence triggers trước khi commit. Snapshot, actor, thời gian và xác nhận không đổi.
4. `20261101110658_ContractHandoverConfirmationInvariant`: CHECK yêu cầu TenantConfirmedVersion không NULL và đúng version khi hoàn tất, tránh ngữ nghĩa NULL của PostgreSQL bỏ qua kiểm tra.

Không sửa migration `20261029170352_ContractActivationLifecycle`. Unique index một Active Contract/Room giữ nguyên. Down của hai migration đầu từ chối khi có dữ liệu mới để tránh mất bằng chứng; rollback có dữ liệu phải được review riêng. Chỉ migrate tự động database demo có tên/host được seed guard cho phép.

## API mới

Root `/api/v1/contracts`, giữ nguyên các endpoint cũ.

| Method / suffix                                                | Role                      | Mục đích                                                             |
| -------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| GET `configuration`                                            | Owner/Staff/Tenant        | Template hợp lệ và blockers                                          |
| GET `preparation?locationId=`                                  | Owner/Staff               | Location/Room/verified residents/Owner signer trong scope            |
| GET `preparation/accounts`                                     | Owner                     | Tài khoản Tenant active để liên kết                                  |
| POST `preparation/residents/{residentId}/account`              | Owner                     | `{ tenantUserId }`, liên kết bất biến, audit                         |
| GET `{id}/history`                                             | Scoped Owner/Staff/Tenant | Event/actor/time an toàn                                             |
| GET `{id}/deposit-verifications`                               | Scoped Owner/Tenant       | Lịch sử xác minh cọc                                                 |
| GET/POST `{id}/previews`                                       | Scoped Owner/Tenant       | List / generate-or-reuse snapshot PDF; POST có Idempotency-Key       |
| GET `{id}/previews/{fileId}`                                   | Scoped Owner/Tenant       | PDF private, verify hash                                             |
| GET `{id}/handover`, `/handover/history`                       | Scoped Owner/Staff/Tenant | Biên bản/lịch sử                                                     |
| GET `{id}/handover/choices`                                    | Scoped Staff              | Assets, confirmed readings, ảnh đã tải                               |
| POST `{id}/handover`                                           | Scoped Staff              | Lập/sửa với expected `version`, Idempotency-Key                      |
| POST `{id}/handover/tenant-confirmation`, `/handover/disputes` | Đúng Tenant               | `{ version, note }`, Idempotency-Key                                 |
| POST `{id}/handover/staff-confirmation`                        | Scoped Staff              | `{ version, note }`, Idempotency-Key                                 |
| POST `{id}/handover/evidence`                                  | Scoped Staff              | Binary PNG/JPEG                                                      |
| GET `{id}/handover/evidence/{fileId}`                          | Scoped Owner/Staff/Tenant | Ảnh nằm trong biên bản; uploader đọc được ảnh chưa liên kết của mình |
| GET `{id}/handover/meter-evidence/{readingId}`                 | Scoped Owner/Staff/Tenant | Ảnh chỉ số thuộc baseline, verify hash                               |

## Chạy demo trên máy hiện tại

Yêu cầu .NET 8, Node 22, dependencies của repo đã cài, Docker daemon chạy. Script `Use-LocalTools.ps1` dùng tool Node 22 local nếu có. MinIO dùng Dockerfile pinned source đã có của repo. Đây là môi trường loopback, không dùng production.

Tại repository root, build trước khi chạy API:

```powershell
dotnet build src/backend/BHome.sln --no-restore --no-incremental
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1
```

Initializer tạo project Compose `bhome-contract-demo`, PostgreSQL `127.0.0.1:56432`, database **bhome_contract_demo**, MinIO `127.0.0.1:59000`/console `59001`, bucket **contract-demo**. Có thể chạy lại; không reset, không đổi mật khẩu/role hiện có. Seed từ chối database `bhome`, host remote, môi trường Production/Staging và bucket không đúng fixture.

Secrets ngẫu nhiên chỉ ghi tại `.tools/contract-demo/runtime.json`, được Git ignore; trên Windows chỉ tài khoản local hiện tại được đọc file. Không gửi/chụp/commit file đó. Các script không in mật khẩu/token. Không thay `.env`, user-secrets hoặc mật khẩu tài khoản có sẵn.

Mở ba terminal riêng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 Api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 OwnerWeb
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 MobileWeb
```

- Owner Web: **http://localhost:5517**; API web **http://localhost:5540** (loopback Development).
- Mobile Web: **http://localhost:5581**; API mobile **https://localhost:7540**. Giữ yêu cầu HTTPS của mobile; dùng certificate Development local đã được tin cậy. Không tắt kiểm tra TLS. Launcher chỉ đặt env cho process, ghi đè các listener Mobile thành loopback của demo.
- Launcher MobileWeb dùng Expo/React Native app thật, không phải HTML mock. Web mobile giữ token trong memory: reload toàn trang cần đăng nhập lại. Trong app, dùng navigation/nút tải lại để tiếp tục phiên.
- Native iOS/Android dùng cùng source; thao tác camera/chia sẻ file và TLS trên thiết bị thật còn cần Tester xác minh. Launcher này phục vụ demo trình duyệt local; không tự mở firewall hay cấu hình chứng chỉ LAN trên điện thoại.

Sau khi API sẵn sàng, tạo sample Active/evidence qua API thật:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-ContractDemo.ps1 -BootstrapOnly
```

Seed base tạo 1 Owner, 1 Staff, 3 Tenant; Location/RoomType/giá thuê demo; P101 Available, P102 được ký mô phỏng/xác minh cọc/kích hoạt **qua API**, bản gia hạn P102 ở Draft, P103 Unavailable theo enum thật (không tự thêm Maintenance), P104-UI dành riêng cho browser smoke. Các resident là nhãn tổng hợp, không có CCCD thật. Cung cấp asset/meters và ảnh PNG ghi rõ SYNTHETIC; bootstrap liên kết ảnh và human-confirmed Initial readings qua endpoint capture hiện có. Không ghi trực tiếp Contract Active/Room Occupied hoặc bỏ payment/signing guards.

Email đăng nhập:

| Role               | Email                                   |
| ------------------ | --------------------------------------- |
| Owner              | `owner.contract.demo@example.invalid`   |
| Staff              | `staff.contract.demo@example.invalid`   |
| Tenant cho P101    | `tenant1.contract.demo@example.invalid` |
| Tenant cho P104-UI | `tenant2.contract.demo@example.invalid` |
| Tenant cho P102    | `tenant3.contract.demo@example.invalid` |

Mật khẩu dùng trường **BHOME_DEV_TEST_PASSWORD** trong file local `runtime.json`. Dùng email đầy đủ; backend login hiện validate Email. Không có mật khẩu mặc định được commit.

Để dừng API/Web/Mobile dùng Ctrl+C ở đúng terminal. Data services thuộc project Compose riêng `bhome-contract-demo`; có thể dừng project này trong Docker Desktop và giữ nguyên volumes. Compose file ở `deploy/docker/compose.contract-demo.yml`.

Không cung cấp lệnh reset chung hoặc xóa volume `bhome` của developer. Integration tests tự tạo/hủy container Postgres/MinIO thuộc fixture Testcontainers; dùng chúng khi cần database test sạch. Demo initializer luôn bảo toàn dữ liệu đã có.

## Kịch bản thao tác

1. Owner đăng nhập Web → Hợp đồng → đọc template version, fields và nhãn simulation → Tạo hợp đồng thuê.
2. Tiếp theo → Location BHOME CONTRACT DEMO → P101 → chọn người ở verified, đại diện đã liên kết và Owner ký. Nếu hồ sơ onboarding khác chưa liên kết, Owner chọn tài khoản Tenant đúng và xác nhận liên kết; Staff không có quyền này.
3. Tiếp theo → ngày bắt đầu hôm nay, ngày kết thúc tương lai, tiền thuê/cọc đã thống nhất và điều khoản **tổng hợp thử nghiệm** → Lưu nháp. Đóng/mở lại từ danh sách để kiểm tra persistence.
4. Trong chi tiết → Tạo/lấy PDF xem trước → Xem PDF / tải PDF. Tài liệu có version/hash và notice Development.
5. Owner chọn Mô phỏng ký → xác nhận → Kiểm tra kết quả ký → xác nhận. Chờ trạng thái Simulated. Đây không phải electronic signature production.
6. Tenant1 đăng nhập Mobile → Xem hợp đồng & trạng thái ký → mở/lưu PDF → Mô phỏng ký → kiểm tra nội dung/checkbox → xác nhận → Kiểm tra kết quả ký. Backend lưu Simulated riêng cho từng signer.
7. Owner tải lại trạng thái. Thiếu cọc thì nút Activate bị chặn. Owner nhập tham chiếu sao kê **tổng hợp**, số tiền và căn cứ đối chiếu vào Xác minh cọc. Không dùng ảnh chuyển khoản hoặc `paid=true`.
8. Readiness đủ → Owner xác nhận kích hoạt. Contract Active, Room Occupied; Tenant tải lại thấy Active. P102 đã có sẵn trạng thái này để kiểm tra mà không cần tạo mới.
9. Staff đăng nhập Mobile → Bàn giao nhận phòng → chọn Contract Active → lập biên bản. Ghi hiện trạng, kiểm tra từng asset, chìa khóa/quyền truy cập, chọn confirmed readings đúng ngày, chụp/chọn ảnh phòng không chứa giấy tờ cá nhân → lưu.
10. Tenant đọc biên bản/ảnh/chỉ số → xác nhận đúng version hoặc gửi nội dung cần sửa. Nếu dispute, Staff sửa/lưu version mới, Tenant xác nhận lại. Sau đó Staff kiểm tra và xác nhận hoàn tất. Owner xem biên bản và history trên Web → Bàn giao phòng hoặc chi tiết Contract.
11. Gia hạn: dùng action hiện có để tạo version mới, hai bên ký và Owner kích hoạt đúng kỳ thật; không đổi ngày máy để ép activation. Trả phòng: Tenant gửi yêu cầu → Owner duyệt → schedule/Final reading/Staff inspection. Settlement ledger production chưa có nên giữ Pending, không Complete/Available giả.

Browser smoke tự động trên ứng dụng/DB/MinIO đang chạy, không intercept/mock API:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-ContractDemo.ps1
```

Script dùng Playwright đã có trong `.tools/contract-browser/node_modules` hoặc dependency local; dùng Edge đã cài. Có thể đặt `BHOME_TEST_BROWSER` tới Chromium tương thích. Không thêm browser runtime vào production. Artifacts/screenshot và fixture IDs ở `.tools/contract-demo/`; không lưu token/mật khẩu vào kết quả. Chạy lại mở Contract P104-UI hiện có và giữ lịch sử, không xóa/reset. P101 vẫn sẵn sàng cho tester tạo thủ công.

## Kiểm thử và bàn giao Tester

Kết quả triển khai trước khi tổ chức commit được ghi dưới đây, evidence TRX ở `.tools/contract-workflow/`. Đây là kết quả trên working tree lúc triển khai, không thay thế kiểm tra từng snapshot commit. Không suy ra System/Acceptance coverage từ template Report 5. Không tính chạy export là chạy app trên thiết bị thật.

- Đã chạy backend build, Application UT, Contract API với PostgreSQL/MinIO thật, renderer/signing composition và production simulation guards.
- Đã chạy Owner Web build/typecheck, Mobile typecheck, contract client/UI tests và browser smoke luồng signing/activation với API thật.
- Còn dành cho Tester: thiết bị iOS/Android, camera/permissions/share, provider thật, outage/recovery, accessibility, load/performance, checklist/acceptance mở rộng và review migration/rollback.

| Kiểm tra đã thực thi                                                                        | Kết quả                                                                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln --no-restore --no-incremental`                          | PASS, 0 warnings/errors                                                                                         |
| Application UnitTests                                                                       | 173 PASS                                                                                                        |
| IntegrationTests filter `FullyQualifiedName~Contracts.`                                     | 71 PASS: 21 API cases trên PostgreSQL/MinIO thật + renderer/composition/guards                                  |
| Owner Web contract/certificate tests                                                        | 14 PASS                                                                                                         |
| Mobile toàn bộ Vitest suite                                                                 | 231 PASS / 19 files                                                                                             |
| Owner Web build và oxlint                                                                   | PASS                                                                                                            |
| Mobile typecheck; ESLint trên các file Mobile/shared sửa trong task                         | PASS                                                                                                            |
| `dotnet ef migrations has-pending-model-changes`                                            | Không có model change ngoài migration                                                                           |
| Isolated initializer/bootstrap chạy lặp lại                                                 | PASS, không reset dữ liệu; P101 vẫn Available; P102 Active + Renewal Draft; P104-UI Active                      |
| Browser smoke ứng dụng thật                                                                 | PASS Owner Web/Staff Mobile/Tenant Mobile, PDF/signing/deposit/activation và UC-17; không mock API              |
| PostgreSQL kiểm tra sau browser smoke                                                       | Mỗi Room tối đa một Active Contract; P104-UI handover Confirmed v1, TenantConfirmedVersion=1, đủ hai timestamps |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Export-ContractDemoMobile.ps1` | Export iOS + Android PASS trên Node 22; không phải native device test                                           |

Các lệnh test backend dùng project paths `tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj` và `tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj`, `--no-build`, kết quả TRX tại `.tools/contract-workflow`. Owner tests chạy `npm.cmd --prefix src/owner-web test -- Contracts.test.tsx SigningCertificates.test.tsx`; Mobile chạy `npm.cmd --prefix src/mobile test`.

Trong quá trình kiểm tra đã sửa: mock test cũ thiếu response cho endpoint mới; seed thiếu Chain singleton; giá trị Amount cần đọc decimal string; selector test trùng Drawer/dialog và screen cũ của Expo Router; cảnh báo View nhận chuỗi rỗng ở Staff home. Lần build đầu có file DLL bị API demo giữ, đã dừng đúng process demo rồi build lại. Một lệnh dot-source PowerShell bị execution policy chặn, đã thay bằng các wrapper `-ExecutionPolicy Bypass -File` theo từng process. Các kiểm tra cuối trong bảng đều đã chạy lại đạt. Không đổi policy Windows toàn máy.

Browser smoke được chạy lần đầu qua từng bước còn thiếu, các lần sau đọc lại trạng thái đã lưu và không ký/kích hoạt/xác nhận lại một bản ghi hoàn tất. Khi xem ảnh UI phát hiện cảnh báo render chuỗi rỗng ở trang Staff; đã sửa và thêm kiểm tra console render errors cho smoke. Camera preview dùng nhãn tải bằng chứng riêng cho nhận/trả phòng, không gọi đó là OCR. Chưa thực hiện chụp camera thật hoặc chia sẻ file trên điện thoại.

## Remaining items

- **Implemented / UI Ready:** cấu hình Development, chọn Room/residents/account, Main draft, preview, signing adapter integration, deposit/readiness/activation, scoped list/detail/history, handover version/dispute/dual confirmation, tích hợp lifecycle đã có.
- **Demo Ready:** bắt buộc dùng simulation được gắn nhãn, synthetic verification và DB/MinIO riêng. Không dùng demo làm bằng chứng ký/ngân hàng pháp lý.
- **Blocked by Business Decision:** OQ-03 Holding expiry/cancel/refund và phân bổ cọc; OQ-01/02/05 quyết toán/khấu trừ/hoàn cọc; template production và checklist/notifications bổ sung.
- **Blocked by External Provider / Module:** MySign sandbox/certificate/template production; real bank reconciliation; Holding/settlement financial ledgers. Giữ adapters Unconfigured hiện có.
- **Not Implemented:** legal-template approval/editor CRUD cho production; Holding lifecycle tài chính/convert thực; settlement/refund thực; notification quyết định thiệt hại từ bàn giao. Không claim các phần này Done.
- **Giới hạn readings:** không tạo lại Initial cho meter đã có Initial, không tự đặt lại số/nhân bản Periodic. Nếu chưa có confirmed reading phù hợp ngày bàn giao, biên bản bị chặn cho tới khi module meter cung cấp reading hợp lệ; cần tích hợp loại tác vụ turnover nếu nghiệp vụ yêu cầu.

## Nhóm file thay đổi và commit local

| Nhóm                    | Files / chức năng                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application / Domain    | `ContractWorkflowContracts/Service`, `ContractHandoverContracts/Service`, Contract mode/status/view, Resident account association, document file và handover/history entities |
| Infrastructure / schema | Workflow/handover repositories/configurations, adapter simulation, renderer configuration read, DI, private-file cleanup, bốn migration và model snapshot                     |
| API                     | `ContractsController`: configuration/preparation/link/history/deposit GET/preview/handover/evidence                                                                           |
| Shared client           | `contracts.ts`, `useContractPreparation`, `useContractHandover`: DTO/transport/state/actions                                                                                  |
| Owner Web               | Wizard, configuration/preview/deposit/audit/handover panels, action dialog, detail/list và handover route                                                                     |
| Mobile                  | Draft/action/evidence/detail/workflow/handover, route live move-in/checklist, Staff navigation link                                                                           |
| Demo / verification     | `ContractDemoSeed`, CLI command, isolated Compose, environment/init/start/bootstrap/browser-smoke scripts, API/guard/client/UI tests, tài liệu này                            |

BH-16 đã nằm trong `766d9b6` (`feat(contract): implement PDF renderer and signing integration`); không tạo lại commit renderer cho phần đã có. Phần backend preparation/preview và simulation dùng chung migration, mode bất biến và guards, nên đi cùng một commit. EF migrations và model snapshot được giữ cùng schema tương ứng. Các hunk dùng chung được tách theo dependency trước khi kiểm tra.

Thứ tự commit local:

1. `feat(contract): add preparation preview and development signing`
2. `feat(handover): implement versioned handover workflow`
3. `feat(contract): add draft creation and preview UI`
4. `feat(contract): connect signing and activation UI`
5. `feat(handover): integrate handover screens`
6. `chore(demo): add contract workflow demo data`
7. `docs(contract): add workflow and demo guide`

Đợt tổ chức commit ngày 01/11/2026 xuất riêng nội dung Git index ra thư mục tạm để kiểm tra, dùng dependencies đã cài. Không lấy code của các thay đổi chưa stage để chứng minh snapshot trung gian build được. Kết quả TRX bổ sung nằm tại `.tools/contract-commit-review/results/` (local, không commit).

| Snapshot              | Kiểm tra thực thi trong đợt commit                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend Contract      | Solution build: 0 warnings/errors; Application UT: 173 PASS; Contract tests: 67 PASS; EF không có pending model changes                                                     |
| Backend Handover      | Solution build: 0 warnings/errors; Contract tests: 68 PASS, gồm UC-17 trên PostgreSQL/MinIO thật; EF không có pending model changes                                         |
| Draft/preview UI      | Owner Web build; 13 contract/certificate tests PASS; Mobile typecheck PASS                                                                                                  |
| Signing/activation UI | Owner Web build; 14 contract/certificate tests PASS; Mobile typecheck PASS                                                                                                  |
| Handover UI           | Owner Web build và oxlint; 14 Owner tests PASS; Mobile typecheck, 231 tests/19 files PASS; ESLint các file Mobile/shared liên quan PASS; helper smoke qua Node syntax check |
| Demo                  | Solution build: 0 warnings/errors; Contract tests: 71 PASS; syntax 5 PowerShell và 3 Node scripts PASS; Compose config PASS với giá trị giả, không khởi động services       |

Initializer/bootstrap, browser smoke và Expo exports trong bảng triển khai phía trên **không chạy lại trong đợt commit**. Không dùng chúng làm bằng chứng đã kiểm thử từng commit. Native device, provider thật, CI và review của thành viên khác vẫn cần thực hiện trước khi merge. Bản local sẵn sàng gửi PR review theo luồng `member/QHuy` → PR → review/test → `develop`.

Mỗi commit được kiểm tra staged diff/stat/name list và `git diff --cached --check`. Không stage `.env*`, `.tools`, passwords/credentials hoặc dữ liệu test riêng tư. Không tìm thấy file `Quy-tắc-làm-việc-Git.txt` trong checkout ở đợt commit; áp dụng quy tắc personal branch/PR tại `AGENTS.md`. Không thay đổi các báo cáo audit/BH-16 trước đó.

Danh sách đầy đủ: [CONTRACT_WORKFLOW_CHANGED_FILES.md](CONTRACT_WORKFLOW_CHANGED_FILES.md).
