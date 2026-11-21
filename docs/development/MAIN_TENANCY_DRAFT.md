# Tạo hợp đồng thuê chính ở trạng thái Draft

## Phạm vi và nguồn yêu cầu

Triển khai luồng Staff hoàn tất onboarding → tự điền dữ liệu → xem DOCX/PDF → lưu và mở lại Draft.
Đối chiếu UC-15/BF-03B trong `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
và yêu cầu triển khai của người dùng ngày 02/11/2026. Ngày cấp lấy từ dữ liệu đã xác nhận,
không lấy từ OCR proposal hoặc gán ngày hiện tại. Giữ các bước OCR/onboarding trước đó.

Người dùng đã chấp thuận thay đơn vị tiền nước trong bản nội bộ từ đ/người thành đ/m³
theo cấu hình đồng hồ. File `docs/mau-hop-dong-thue-nha-tro-ngan-gon.docx` giữ nguyên.

Luồng này không ký, cấp tài khoản Tenant, áp dụng/chuyển cọc, tạo QR hoặc kích hoạt.
Không đổi trạng thái phòng khi lưu Draft. Các tính năng vòng đời cũ của hợp đồng khác giữ nguyên.

## Kiến trúc và lưu trữ

- `MainDraftsController` → `MainDraftService` → `IContractRepository` và `IMainDraftData`.
- Tái sử dụng Contract, ContractResident, ContractOperation, ContractDocumentFile, SecurityAudit,
  Room/Location, BillingPolicy, IIdentityProtection, IContractFileStore và MinIO hiện có.
- Không thêm bảng. Migration `20261102101139_MainTenancyDraftPreparation` bổ sung
  `Locations.ContractSettings`, `Contracts.DraftMetadata`, `Contracts.DraftVersion`.
- `Contract.TenantUserId` nullable để Draft chỉ tham chiếu Resident đã xác minh; không tạo tài khoản giả.
  Constraint `CK_Contract_TenantForLifecycle` vẫn bắt buộc tài khoản ở các trạng thái sau Draft
  (ngoại trừ Cancelled). Luồng ký/vòng đời cũ có guard không nhận hợp đồng chưa liên kết tài khoản.
- ContractSettings lưu các phiên bản cấu hình theo thời gian, dữ liệu Owner được mã hóa bằng
  cơ chế hiện có, với scope riêng theo cơ sở. Chỉ Owner được cấu hình thông tin của chính mình.
- DraftMetadata mã hóa input bổ sung, snapshot các mức phí/phiên bản, hash cấu hình và hash mẫu gốc.
  Không lưu nội dung DOCX/PDF thành blob trong Contract. File riêng tư ở MinIO, DB giữ metadata/hash/key.
- Operation fingerprint và khóa Room trong transaction xử lý retry/double-click. DraftVersion xử lý sửa
  đồng thời. Chặn trùng Resident trong khoảng thuê với Draft/Pending/Active, tái sử dụng kiểm tra sức chứa
  và xung đột hợp đồng đang hiệu lực. Người ở/đại diện không thay đổi ngầm khi sửa Draft.
- Phiên bản/tệp cũ vẫn lưu riêng, không ghi đè tài liệu đã có. API tải từ workflow này từ chối tệp không
  thuộc snapshot hiện tại, kiểm tra hash trước trả dữ liệu; chặn sửa khi không còn Draft.

Luồng cũ yêu cầu tài khoản Tenant và gọi holding allocation khi tạo. Endpoint mới dùng repository/storage
chung, tách phần chuẩn bị nháp khỏi những tác động đó để không thay đổi các workflow cũ ngoài phạm vi.

## API và DTO

Prefix: `/api/v1/contracts/main-drafts`. Staff phải đang được phân công tại Location; Owner có quyền
theo mô hình hiện có. Tenant không được vào các endpoint chuẩn bị nháp này. Response không cache.

- `GET /preparation?roomId=...&representativeResidentId=...&residentIds=...&effectiveOn=yyyy-MM-dd`:
  `MainDraftPreparation` trả phòng/cơ sở/địa chỉ, tên người ở, CCCD che bớt, Ngày cấp, điện thoại có sẵn,
  giá/biểu phí, tiền cọc, chính sách thanh toán, tên Owner và blocker. Lặp `residentIds` cho nhiều thành viên.
- `POST /` và `PUT /{id}`: `MainDraftInput`, header `Idempotency-Key` là UUID. Trả `MainDraftView`.
  Input gồm RoomId, RepresentativeResidentId, ResidentIds, StartDate, EndDate, Notes, TenantPhone,
  TenantPlaceOfIssue, ExpectedVersion. Backend tự lấy Owner/giá/cọc, không nhận các mức tiền do Staff gửi.
- `GET /{id}`: tải đúng input và snapshot của bản nháp đã lưu; trả Version và trạng thái thật.
- `POST /{id}/documents`: trả `MainDraftFiles` gồm metadata Docx, Pdf và PreviewError nếu chưa có PDF.
  Cache theo snapshot, khóa Room chống tạo trùng. DOCX đã lưu được giữ khi converter không sẵn sàng.
- `GET /{id}/documents/{fileId}`: tải DOCX/PDF có xác thực và kiểm tra phạm vi, snapshot, file hash.
- `GET /settings/{locationId}` và `PUT /settings/{locationId}`: chỉ Owner. PUT nhận
  `MainContractSettingsInput`: OwnerSignerId, Owner profile, EffectiveFrom/To, SecurityDeposit,
  PaymentTerms, AdditionalTerms, ExpectedVersion. Không cho ghi đè cấu hình bằng phiên bản cũ.
- Danh sách/chi tiết hợp đồng chung vẫn dùng `/api/v1/contracts`; có cờ `onboardingDraft` để client mở
  giao diện nháp riêng và không gọi readiness/ký/QR/kích hoạt cho workflow mới.

Các mức tiền đi qua client dưới dạng chuỗi thập phân. Input ngày dùng ISO; mobile hiển thị dd/MM/yyyy.
Hiển thị tiền tái sử dụng `formatBillingDecimal`, xử lý cả giá PostgreSQL dạng `3100000.0000`.
Trên summary chỉ trả CCCD đã che; dữ liệu định danh đầy đủ chỉ được đọc server-side khi sinh tài liệu.

## Mapping dữ liệu

- Bên A: hồ sơ Owner được cấu hình cho Location và ngày áp dụng. Không sử dụng UserName hoặc thông tin
  của Staff làm thông tin người cho thuê. OwnerSignerId phải là tài khoản Owner còn hiệu lực khi lưu Draft.
- Bên B: giải mã `Resident.IdentityData` đã Verified, dùng FullName, DateOfBirth,
  CitizenIdentityNumber, DateOfIssue và ResidentialAddress. Thành viên khác liên kết bằng ContractResident.
- `Resident.OwnerUserId` dùng cho scope mã hóa hiện hữu; không được coi là Owner pháp lý của hợp đồng.
- Điện thoại: tự điền từ tài khoản đã liên kết nếu có. Khi chưa có dữ liệu, Staff bổ sung vào bản nháp.
- Nơi cấp: contract xác nhận CCCD cũ chưa lưu trường này, nên Staff bổ sung riêng ở hợp đồng;
  không sửa payload OCR/xác nhận hoặc âm thầm coi đề xuất OCR chưa lưu là dữ liệu đã xác minh.
- Giá thuê, điện, nước, phí dịch vụ: `PropertyService.ResolvePricesAsync` chọn BillingPolicy hiệu lực
  tại ngày bắt đầu, giữ quy tắc ưu tiên Room/RoomType/Location hiện có. Snapshot ID/Version/Rate.
- Tiền cọc và thanh toán: cấu hình Owner có thời gian hiệu lực. Không suy ra từ giá thuê hoặc gán mặc định.
- Thiếu Owner, ngày cấp/địa chỉ đại diện, cấu hình giá hoặc phòng không hợp lệ: blocker rõ ràng,
  không tạo tài liệu có khoảng trống rồi thông báo thành công.
- Gia đình: một hợp đồng theo đại diện và liên kết thành viên. Nhóm bạn từ onboarding có các nút tạo
  hợp đồng riêng theo từng Resident; không gom toàn bộ nhóm vào hợp đồng của người đầu tiên.

## DOCX và PDF

Mẫu gốc được embed vào assembly. `MainDraftRenderer` mở bản sao ZIP/OOXML trong bộ nhớ,
map 16 paragraph slot bằng XML nodes, giữ run/paragraph formatting, header/footer và các điều khoản.
Không replace chuỗi trên toàn bộ ZIP/XML. Đoạn ghi chú/phí/thành viên dùng style body của mẫu,
xử lý xuống dòng rõ ràng. Bản sinh có nhãn BẢN NHÁP, chưa có chữ ký.

SHA-256 của mẫu nằm trong snapshot để thay mẫu không âm thầm dùng tài liệu cũ. Giữ nguyên nội dung
trách nhiệm các bên/trách nhiệm chung, chỉnh riêng đơn vị nước theo quyết định của người dùng.
Nếu slot mẫu thay đổi thì trả lỗi template, không sinh tài liệu thiếu trường.

PDF chuyển trực tiếp từ DOCX bằng LibreOffice, không dựng lại bằng layout mobile hoặc iText.
Hai cách cấu hình:

```powershell
# Development: image này đã được build trên máy trong lượt triển khai.
docker build -t bhome/contract-converter:local -f deploy/docker/ContractConverter.Dockerfile .
# appsettings.Development.json: MainDraft:LibreOfficeContainerImage = bhome/contract-converter:local

# Hoặc cấu hình executable LibreOffice có sẵn trên server.
# MainDraft__LibreOfficePath=C:\Program Files\LibreOffice\program\soffice.exe
# Xóa/để trống LibreOfficeContainerImage nếu chọn executable.
```

Converter container chạy không mạng, filesystem chỉ đọc, giới hạn CPU/RAM/PID;
Windows dùng user 10001 của image; Linux dùng UID/GID của process API để ghi vào workspace riêng quyền 0700.
Chỉ mount thư mục tạm của một request. Timeout/cancel dọn container và thư mục tạm.
Chưa có converter hoặc chuyển đổi lỗi: trả PreviewError, giữ Draft và DOCX; không giả báo đã có PDF.
Không public bucket hoặc tạo URL chứa token/CCCD. Mở/tải file qua API đã xác thực.

CI phải build image `bhome/contract-converter:local` từ Dockerfile này trước `dotnet test`,
tương tự image MinIO; runner mới không có image local từ máy phát triển. Test tích hợp vẫn yêu cầu
PDF thật, không skip hoặc thay bằng PDF mock khi thiếu converter. Đã kiểm tra quyền ghi trên Linux:
UID khác chủ workspace 0700 không ghi được; UID trùng tạo PDF thành công và file thuộc đúng user.

## Mobile và Owner Web

- Bước 4 onboarding → Tiếp tục tạo hợp đồng, truyền các ID tham chiếu, không truyền dữ liệu CCCD trong URL.
- Staff mở tạo hợp đồng trực tiếp cũng chọn được Room/Resident đã xác minh, không cần liên kết tài khoản.
- Form riêng với summary chỉ đọc, ngày thuê có lịch chọn, input bổ sung và lỗi tại trường; footer ở ngoài
  ScrollView và trong Safe Area/KeyboardAvoidingView. Giữ form khi preview lỗi hoặc quay lại chỉnh sửa.
- Xem trước tự lưu Draft trước để gắn tài liệu với ID; nút hoàn tất sau xem trước kiểm tra lại trạng thái/
  phiên bản từ server. Không tạo thêm bản nháp khi bấm nhiều lần.
  ID đã lưu được giữ khi đóng/mở form trực tiếp. Khi cập nhật route bằng ID mới, tránh tải lại ghi đè
  form đang chỉnh sửa. Replay của bản đã hủy không được báo lưu Draft thành công.
  Lịch dùng Portal.Host bên trong modal; nút Back Android đóng lịch trước khi đóng form.
- Expo Go dùng `expo-sharing` đã có để mở PDF trong trình xem của thiết bị (zoom/cuộn do trình xem hỗ trợ),
  không thêm native PDF library/development build. Tệp tải nằm trong cache riêng và xóa sau thao tác.
  Đây không phải PDF viewer nhúng trong React Native. Web tải tệp có xác thực để xem bằng trình duyệt.
  Cập nhật theo yêu cầu xem trước trong app: màn Draft hiện có preview trang đầu và fullscreen nhiều trang
  bằng các trang render từ PDF thật, có JWT và snapshot check. Không cần native PDF module;
  xem [CONTRACT_INLINE_PREVIEW.md](CONTRACT_INLINE_PREVIEW.md) để biết API, kiểm tra và giới hạn.
- Owner Web → Hợp đồng → Cấu hình bên cho thuê & tiền cọc. Chọn cơ sở, nhập hồ sơ pháp lý của Owner,
  thời gian hiệu lực, tiền cọc và thanh toán. Giá điện/nước/thuê vẫn cấu hình trong Giá & Biểu phí hiện có.
- Bản nháp mới mở panel riêng ở mobile/Owner Web, bao gồm khi truy cập deep link; không hiện hành động
  ký, thanh toán hoặc kích hoạt. Các bản nháp/hợp đồng từ workflow cũ tiếp tục dùng UI cũ.

## Giới hạn dữ liệu hiện hữu

Source chưa có Holding Contract repository/ledger đọc được; implementation hiện tại là
`UnconfiguredContractHoldingLedger`. Vì vậy luồng mới không giả dữ liệu holding/cọc đã xác minh,
không gọi ApplyAsync và không nhận phòng OnHold như phòng đủ điều kiện. Cần module holding thực
trước khi hỗ trợ nhánh chuyển từ holding. Luồng lập trực tiếp cho phòng hợp lệ hoạt động đầy đủ.

Khi sử dụng thực tế, Owner phải cung cấp hồ sơ/chính sách thật trong UI cấu hình.
Hồ sơ Tenant thiếu trường đã xác nhận sẽ bị chặn rõ ràng, không lấy lại OCR proposal.

### Cấu hình test local đã tạo theo yêu cầu ngày 02/11/2026

Người dùng đã yêu cầu tạo sẵn cấu hình database để test trên điện thoại. Chạy lại bằng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-LocalMainDraftSettings.ps1
```

Script gọi `tools/BHome.LocalDevelopment/MainDraftSettingsSeed.cs`, chỉ chấp nhận Development,
database `bhome` trên loopback, cơ sở có tên chính xác `BHOME TEST - Cơ sở Staff`, tài khoản
`owner.dev`/`staff.dev` đúng role và Staff đang có phân công. Không tạo/thay mật khẩu, quyền hoặc CCCD.
Chỉ bổ sung cấu hình còn thiếu qua các service hiện có, có mã hóa và audit. Chạy lại không tạo trùng
hoặc ghi đè cấu hình đã có. Có backup trước lần seed đầu trong `.tools/private-backups`.

- Hiệu lực từ 02/11/2026, chưa đặt ngày kết thúc.
- Giá thuê loại `TEST - Tiêu chuẩn`: 3.000.000đ/phòng/tháng; `TEST - Gia đình`: 4.500.000đ/phòng/tháng.
- Điện: 3.500đ/kWh; nước: 15.000đ/m³; dịch vụ: 100.000đ/phòng/tháng.
- Cọc test: 3.000.000đ; điều khoản có nhãn DỮ LIỆU TEST, chưa ghi nhận thu tiền.
- Bên cho thuê `CHỦ NHÀ TEST BHOME`: hồ sơ tổng hợp có nhãn TEST; phải thay thông tin thật trước sử dụng thực tế.
- `appsettings.Development.json` bật `ContractPdf:TemplateId=main-contract-development-v1`
  riêng cho luồng PDF cũ. Đây vẫn là mẫu thử, không phê duyệt production và không bật ký mô phỏng.

Kiểm tra thực tế: 6 cấu hình được thêm (1 bên cho thuê, 5 biểu phí); chạy lại thêm 0 bản ghi;
resolver trả đủ giá cho cả 6 phòng; 5/5 người đại diện đã xác minh qua được preparation dưới role Staff.
Không tạo Contract, không đổi trạng thái phòng hoặc dữ liệu định danh.

## File triển khai

- Backend mới: `BHome.Application/Contracts/MainDraftContracts.cs`, `MainDraftService.cs`;
  `BHome.Infrastructure/Contracts/MainDraftData.cs`, `MainDraftRenderer.cs`;
  `BHome.Api/Controllers/MainDraftsController.cs`.
- Domain/schema: `TenantContracts/Contract.cs`, `ContractDocumentFile.cs`, `Locations/Location.cs`,
  `Persistence/ContractConfiguration.cs`, migration/Designer `20261102101139_MainTenancyDraftPreparation`,
  `BHomeDbContextModelSnapshot.cs`.
- Tích hợp backend: `ContractContracts.cs`, `ContractWorkflowContracts.cs`, `ContractWorkflowRepository.cs`, `ContractService.cs`, `ContractLifecycleService.cs`,
  `ContractRepository.cs`, `ContractSettlementLedger.cs`, `InvoiceService.cs`, `InvoiceRepository.cs`.
  Các guard ngoài draft bảo vệ invariant tài khoản Tenant sau khi đổi cột nullable.
- Đăng ký/tài nguyên: `DependencyInjection.cs`, `BHome.Infrastructure.csproj`,
  `BHome.Api/appsettings.Development.json`, `deploy/docker/ContractConverter.Dockerfile`.
- Client chung: `packages/client-core/src/mainDrafts.ts`, `contracts.ts`, `useContractDetail.ts`.
- Mobile: `MainDraftScreen.tsx`, `MainDraftStart.tsx`, `ContractDateField.tsx`, `ContractScreen.tsx`,
  `ContractProgress.tsx`, `OnboardingScreen.tsx`; test `main-draft-screen.test.tsx`,
  `main-draft-start.test.tsx`, `contract-date-field.test.tsx`, cập nhật handoff trong `onboarding-ui.test.tsx`.
- Owner Web: `MainDraftSettingsPanel.tsx`, `MainDraftDetailPanel.tsx`, `useContractsApi.ts`,
  `ContractDetailPanel.tsx`, `pages/ContractsPage.tsx`, `Contracts.test.tsx`.
- Test backend: `Contracts/MainDraftApiTests.cs`, cập nhật fixture nullable trong `ContractServiceTests.cs`.
- Launcher: `scripts/Start-Api.ps1`, `scripts/Start-OcrMobile.ps1` đọc thêm cấu hình MainDraft từ .env.

## Kết quả kiểm tra và local

- Backend build PASS, không warning/error. Application unit: 177 PASS; Domain unit: 83 PASS.
- Nhóm integration/hồi quy hợp đồng và renderer: 60 PASS. Trong đó 10 test mới dùng PostgreSQL/MinIO
  thật, gồm PDF LibreOffice thật, idempotency đồng thời, truy cập khác phân công, ngày giá/cấu hình tương lai,
  dữ liệu thiếu, phòng không hợp lệ, sửa/mở lại Draft, file cũ và trạng thái phòng/tài khoản giữ nguyên.
- Mobile: 307 PASS, 1 FAIL cũ tại `tests/mobile/ocr/workspace.test.ts` yêu cầu Staff chỉ hai tab;
  kỳ vọng này mâu thuẫn giao diện bốn tab từ lượt trước. Không bỏ qua hoặc sửa test đó trong lượt này.
  Sau đó bổ sung test replay trạng thái đã hủy: nhóm form/lịch/khởi tạo mới 12/12 PASS.
  TypeScript/lint và Android export PASS.
- Owner Web: 94 test PASS; nhóm hợp đồng sau bổ sung guard deep link 11/11 PASS.
  TypeScript/build/lint PASS. Build production thành công.
- DOCX/PDF mẫu tổng hợp được render bằng `render_docx.py`, đã xem cả ba trang và kiểm tra tiếng Việt,
  ngày cấp, tiền thuê, tiền nước, điều khoản gốc; sửa xuống dòng/căn trái ghi chú sau kiểm tra trực quan.
  Mẫu gốc không bị sửa. Không dùng dữ liệu định danh thật trong tài liệu kiểm thử.
- Đã tạo/kiểm tra backup database local trong `.tools/private-backups`, quyền thư mục chỉ tài khoản hiện tại.
  Đã áp dụng migration bằng `Update-LocalDatabase.ps1`, không còn migration pending; API HTTPS local đã
  khởi động lại và readiness 200 với xác minh CA/hostname. Không bỏ qua TLS.
- Chưa kiểm thử UI, bàn phím, notch, thao tác mở PDF trên điện thoại iPhone/Android thực tế.
  Android export và DOM/native mocks không thay thế kiểm tra thiết bị.
