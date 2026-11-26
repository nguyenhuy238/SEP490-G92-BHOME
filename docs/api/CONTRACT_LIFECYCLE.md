# Contract UI — bổ sung API D011/D012

Cập nhật **06/11/2026**, runtime Compact24. [Trạng thái và giới hạn](API_IMPLEMENTATION_STATUS.md),
[route/input/policy đầy đủ](API_RUNTIME_ROUTES.md). Main/Renewal có workflow; Holding ledger vẫn
Unconfigured. Cọc đã xác minh để activation không đồng nghĩa đã có quyết toán/hoàn cọc khi move-out.

## Main Draft → tài liệu xem xét → ký (05/11/2026)

**Cập nhật 19/11/2026.** Bước 5 cho phép Owner signer hoặc Staff đang được phân công tại cơ sở kiểm tra PDF và gọi `POST .../{id}/release` để đưa hồ sơ sang `PendingSigning`. Với Staff, `tenantUserId: null` yêu cầu máy chủ dùng liên kết đã xác minh của đại diện thuê. Nếu chưa liên kết tài khoản, hợp đồng dùng OTP. Owner và Tenant có thể ký theo bất kỳ thứ tự nào. Sandbox cũng cho mô phỏng theo cả hai thứ tự và chỉ mở bước thanh toán khi đã ghi nhận đủ hai bên.

Trong luồng tạo hợp đồng chính thức trên Staff Mobile, kỳ thuê mặc định là 6 tháng và có thể chọn 1 năm, tính từ ngày hiện tại theo giờ Việt Nam. Giá, cọc và điều khoản lấy từ cấu hình. Số điện thoại dùng dữ liệu đã lưu nếu có. Bước 4 gọi `signing-review` một lần để tạo PDF dùng để ký và phát hành chính tệp này với `emailSigning: true` khi chuyển tiếp. Bước 5 gửi lời mời OTP kèm liên kết xem bản PDF của hợp đồng và ghi sự kiện `MainSigningSubmitted` cho thông báo trên web và mobile của Owner. Bước 6 và 7 dùng luồng thanh toán và kích hoạt hiện có.

Khi gửi lại lời mời ký còn hiệu lực, backend áp dụng khoảng chờ 1 phút theo địa chỉ nhận trên cùng hợp đồng. Nội dung email mới thay thế link và OTP cũ, đồng thời giữ thời hạn của lời mời.

Email đã gắn với hồ sơ cư dân khác, kể cả hồ sơ chưa có hợp đồng, bị từ chối với HTTP 409 `signing_email_already_in_use` khi gửi lời mời hoặc chấp thuận ký.

UC-15 / UC-21 / GBR-10. Lệnh thanh toán ban đầu mới (calculation v2) thu cọc còn thiếu và tiền thuê tháng đầu; phí cố định và điện/nước được xử lý trong hóa đơn định kỳ. API trả khoản thuê, cọc và số dư sau các phân bổ đã xác minh. Tiền giữ chỗ đã cấn nằm trong tổng cọc đã ghi nhận. Lệnh v1 đã phát mã giữ nguyên mã, số tiền và các khoản phí đã chốt; API tiếp tục trả chi tiết phí và đơn giá điện/nước đã ký của lệnh lịch sử, không tính lại theo v2. Báo giá legacy chưa phát mã và chưa được phân bổ có thể tạo lệnh v2 theo nghĩa vụ chung của phòng, đồng thời giữ nguyên bản ghi báo giá cũ. Nội dung này mô tả triển khai `MainInitialPaymentNoFees` và khả năng tương thích lịch sử; không sửa chứng từ hoặc nghĩa vụ đã phát hành.

Khi SePay tắt, thanh toán ban đầu vẫn trả số dư và các khoản thu. Trạng thái `PaymentProviderDisabled` cho biết chưa thể cấp mã đối soát hoặc QR. Mobile chỉ hiển thị hướng dẫn chuyển khoản khi đã có mã đối soát.

Sau kích hoạt hợp đồng thuê ký OTP có thanh toán ban đầu, hàng đợi xác nhận gửi hợp đồng đã ký và biên nhận giao dịch đã xác minh đến email khớp lời mời đã chấp thuận. Email thiết lập tài khoản đi theo luồng riêng. Biên nhận lấy số tiền phân bổ từ PostgreSQL và ghi riêng khoản giữ chỗ cấn vào cọc. Hóa đơn định kỳ được phát hành theo UC-21.

UC-14. Sự kiện tạo bản nháp giữ chỗ phát một thông báo trong ứng dụng cho Owner được chỉ định ký, dùng khóa theo hợp đồng để tránh thông báo lặp. Trong luồng ký điện tử trên Owner Web, người ký vẽ hoặc chọn ảnh chữ ký cho hợp đồng đang mở trước khi xác nhận ký.

Email xác nhận giữ chỗ được gửi đến địa chỉ trong lời mời đã chấp thuận sau khi giữ chỗ có hiệu lực và cọc đã xác minh. Trong Development, tùy chọn cho phép gửi lời mời ký ngoài danh sách thử cũng áp dụng cho email xác nhận giữ chỗ theo luồng này.

UC-13 / UC-15. Danh sách phòng tiếp nhận khách thuê trả thêm `currentTenantLabels` cho phòng thuộc phạm vi được phân công. Mỗi mục hiển thị họ tên đã xác minh của người đại diện trên hợp đồng thuê đang có hiệu lực trong ngày, hoặc trạng thái chưa có tên xác minh. Staff xem thông tin này khi chọn phòng. Hồ sơ người thuê mới được nhập ở bước CCCD.

Phòng có hợp đồng thuê chính thức chờ chữ ký Owner được đánh dấu `waitingForOwnerSignature` và ẩn khỏi danh sách chọn phòng tiếp nhận. Backend kiểm tra lại khi lưu hoặc phát hành bản nháp khác cho phòng đó.

### Quyết định nghiệp vụ về cọc dùng chung

UC-15 / UC-19 / UC-22 / GBR-10 / GBR-18. Cọc thuộc chu kỳ thuê của phòng. Khi một Tenant kết thúc hợp đồng và vẫn còn Tenant ở lại, chu kỳ và khoản cọc tiếp tục tồn tại. BHOME không quyết toán riêng khoản cọc giữa các Tenant. Hết hạn hợp đồng chưa hoàn tất bàn giao không kết thúc chu kỳ.

Khi người thuê cuối cùng hoàn tất trả phòng, BHOME tính số dư cọc để Owner quyết định hoàn trả cho người đó. Việc chuyển tiền do Owner thực hiện bên ngoài BHOME. Chứng từ thu cọc ban đầu vẫn được lưu để đối soát. Quy tắc tự đối soát chỉ chấp nhận khoản chuyển đúng số tiền cần thu.

Trạng thái triển khai: đây là quyết định cho thay đổi sắp tới. Ledger hiện tại vẫn gắn cọc với hợp đồng nguồn.

UC-15 / GBR-04 / DBR-03. Các thay đổi trong controller Main Draft hiện hữu gồm các endpoint sau.

- `POST /api/v1/contracts/main-drafts/{id}/signing-review`: Owner hoặc Staff đang được phân công Location, trả `ContractDocumentView` với `kind=SigningReview`. Tái sử dụng file của snapshot và rendering revision hiện tại. PDF được chuyển đổi từ mẫu DOCX hiện hữu và lưu private, có hash/length. Theo yêu cầu demo ngày 24/11/2026, mẫu được phép tạo và đọc lại ở tất cả môi trường, kể cả Staging/Production. Theo yêu cầu tiếp theo cùng ngày, UI và tài liệu mới không hiện cảnh báo môi trường/mẫu thử; metadata `developmentOnly` giữ nguyên. Main renderer revision 2 tạo review mới thay vì tái sử dụng review unsigned revision cũ; không thay tài liệu đã phát hành/đã ký. Kiểm tra quyền, snapshot/hash, xác nhận xem xét, ký, thanh toán và Owner kích hoạt giữ nguyên.
- `GET .../{id}/documents/{fileId}`: dùng endpoint download hiện hữu, kiểm quyền/snapshot/hash trước khi trả bytes. Tài liệu phiên bản cũ trả 409.
- `POST .../{id}/release`: Owner signer hoặc Staff được phân công tại cơ sở. Bắt buộc `Idempotency-Key` UUID. Body `{ tenantUserId, expectedVersion, reviewedFileId, humanReviewed: true }`; trả `{ id }`. Máy chủ kiểm tra bản nháp, cấu hình/giá hiện hành, liên kết Resident, tài khoản Tenant hoạt động, xung đột phòng và PDF đã xem xét. Phương thức ký dựa trên liên kết đã xác minh. Lặp cùng key/payload trả cùng kết quả; khác payload trả 409.

Release ghi `PendingSigning`, liên kết Tenant đại diện và seal snapshot; giữ encrypted draft metadata và evidence cũ. Tạo Preview bất biến bằng đúng bytes/hash PDF đã xem xét, với object key riêng. `onboardingDraft` trong list/detail chỉ true khi vẫn là Draft; Owner Web chuyển sang workflow ký hiện hữu. Tenant dùng preview/private-download/signing/sync hiện hữu; cả adapter simulation và MySign lấy canonical PDF này thay vì dựng lại mẫu khác. Chưa ký/chưa cọc thì không tự Active hoặc Occupied.

Owner Web yêu cầu lưu hết thay đổi, chọn tài khoản, tải PDF và xác nhận xem xét trước release. Bản simulation luôn hiển thị nhãn thử nghiệm. Nghiệm thu nhà cung cấp thật vẫn BLOCKED vì chưa có MySign staging và mẫu production được duyệt. Các kiểm thử converter/MinIO cục bộ không thay thế nghiệm thu staging.

Kiểm chứng 06/11: `BHome.ContractVerification --finance --main-draft` dùng API thật, Compact24/MinIO tạm, Owner Web build thật và Staff/Tenant Mobile transport thật. Đạt review/release từ danh sách, bytes PDF giống nhau, scope âm, ký simulation/cọc tổng hợp/Owner activation. UI sau release chuyển khỏi editor; native device và MySign staging chưa nghiệm thu. Bằng chứng chi tiết ở [báo cáo triển khai](../development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md).

UC-17 regression tiếp theo: evidence/meter baseline → Staff record → Tenant dispute/correction → same-version Tenant/Staff confirmation → Owner Web monitor/download đã đạt qua API/Compact24/MinIO thật. Shared hook không giữ record từ context cũ; Mobile consent gắn Contract/version và reset khi server trả version mới. Không đổi endpoint/DTO; native camera/device vẫn chưa chạy.

### Khởi tạo chỉ số điện/nước khi nhận phòng theo từng hợp đồng (16/11/2026)

BF-03/BF-04 (UC-17) và BF-05 (UC-20), GBR-03/07/18. Sau khi **Main Contract lần đầu được kích hoạt** (không phải lúc tạo/lưu Draft), backend tạo một nhiệm vụ **Bàn giao vào phòng** theo Contract và thêm nhiệm vụ `ReadingPurpose.Initial` cho **mỗi công tơ điện/nước đang hoạt động** của phòng. Nhiệm vụ meter dùng `ContractId` của Main Contract, `MeterId` của thiết bị và khóa idempotency `contract + meter`; một Meter vật lý từng được dùng ở hợp đồng trước vẫn phải chụp ảnh mới và xác nhận số tại lần nhận phòng này. Gia hạn kế thừa biên bản trước nên không tạo mốc mới. Nếu chưa lắp đủ công tơ, không dựng dữ liệu hoặc số giả: Staff/Owner cần bổ sung thiết bị hợp lệ rồi xử lý nhiệm vụ còn thiếu theo quy trình được duyệt.

Staff Mobile mở **Bàn giao nhận phòng → Chỉ số khởi tạo hợp đồng** để thấy tác vụ điện/nước đúng Contract và Location được phân công, mở camera/OCR rồi xác nhận thủ công. OCR chỉ gợi ý; ảnh mỗi nhiệm vụ được lưu riêng có kiểm quyền. Chỉ số khởi tạo của hợp đồng mới vẫn phải không nhỏ hơn số đo đã xác nhận trước đó trên cùng thiết bị (nếu giảm phải xem xét thay/thay vòng công tơ), nhưng **không tính phần chênh giữa hợp đồng cũ và hợp đồng mới là tiêu thụ của hợp đồng mới** (`Consumption=null` cho Initial).

`GET /api/v1/contracts/{id}/handover/choices` chỉ trả chỉ số Initial `Completed` có ảnh hợp lệ và `ContractId` trùng hợp đồng đang bàn giao. Khi **lập/sửa** biên bản mới không được lấy lại ảnh hoặc chỉ số Periodic/Initial của hợp đồng khác hay mốc cũ của công tơ. Biên bản **đã lưu từ trước** vẫn được phép Staff hoàn tất trên đúng phiên bản Tenant đã xác nhận nếu đọc lại được bằng chứng cũ với hash và dữ liệu bất biến; điều này không mở lại quyền dùng ảnh cũ để lưu biên bản mới. Tenant vẫn xác nhận đúng phiên bản biên bản, sau đó Staff mới hoàn tất nhiệm vụ. Không có endpoint hay migration mới; `GET /api/v1/capture/meter-tasks` tiếp tục trả `contractId` để client lọc. Các hợp đồng đã Active trước khi thay đổi này không tự động backfill nhiệm vụ: cần phương án dữ liệu riêng được kiểm tra trước khi áp dụng cho dữ liệu lịch sử.

**Cập nhật 19/11/2026 — Draft bàn giao ngay khi tạo Main:** đối với hợp đồng Main **mới**, nhiệm vụ bàn giao và Initial meter được tạo ở transaction tạo hợp đồng (trước Active), cùng biên bản `handover.preparation`; activation gọi lại với khóa deterministic nên không tạo trùng. Nhiệm vụ không có nghĩa đã chụp/xác nhận thành công. Quy tắc xác minh payment/signature để Active và `RoomStatus=Occupied` vẫn giữ nguyên; Owner Ready và Tenant xác nhận theo quy trình riêng. Các hợp đồng lịch sử đã có `ContractHandover` dùng legacy workflow. Chi tiết: [Move-in Handover Draft](MOVE_IN_HANDOVER_DRAFT.md).

Truy vết: BF-03B/BF-04A, FE-03, UC-15/16/19, GBR-01/02/04/18, DBR-02/03.
Các mutation, state, idempotency và giới hạn provider/ledger giữ theo
[bàn giao backend](../development/CONTRACT_LIFECYCLE_DELIVERY.md).

## Danh sách phục vụ web/mobile

### Owner Mobile: bản nháp chờ duyệt (14/11/2026)

Truy vết: BF-03/BF-04, UC-15, GBR-01/02/04. Màn hình “Cần xử lý” tải thêm
`status=Draft` qua API danh sách hiện hữu, cùng các trạng thái chờ ký/chờ kích hoạt.
Bản Main onboarding đã lưu mở phần xem PDF và duyệt đưa đi ký; không mở form soạn/sửa
trên Owner Mobile. Tái sử dụng signing-review/release hiện hữu, giữ kiểm tra quyền,
phiên bản, tài liệu đã xem và xác nhận của Owner ở backend. Không tự phát hành, ký hoặc kích hoạt
khi mở bản nháp. Khi bản nháp đổi phiên bản, tải lại phần duyệt và yêu cầu xác nhận PDF mới.

Thành phần: `ownerAttention`, `useOwnerAttention`, `ContractScreen`, `MainDraftScreen`.
Kiểm thử hồi quy: danh sách Draft, điều hướng chế độ chỉ duyệt, chặn phát hành trước xác nhận,
phân quyền Owner/Staff/Tenant, cache/tải lại và trạng thái lỗi/rỗng.

`GET /api/v1/contracts?page=1&pageSize=20&locationId={uuid}&status=Draft`

- Bearer; Owner/Staff/Tenant. Anonymous 401, sai vai trò 403.
- `page` >= 1, `pageSize` 1..100; `locationId` và `status` tùy chọn. Sai phân trang/trạng thái/UUID: 400.
- Lọc phạm vi trước count/page: Owner toàn hệ thống; Staff chỉ assignment có hiệu lực tại
  ngày Việt Nam; Tenant chỉ `TenantUserId` của mình. ID Location ngoài phạm vi trả trang rỗng.
  Tài khoản nhiều vai trò có hợp các phạm vi được server cho phép.
- Thứ tự `startDate DESC, id ASC`; `Cache-Control: no-store`.
- Trả `{ items, page, pageSize, totalCount }`; item chỉ gồm `id`, `roomId`, `locationId`,
  `locationName`, `roomNumber`, `kind`, `status`, `startDate`, `endDate`, `monthlyRent`.
  Tiền là chuỗi số nguyên VND. Không trả CCCD, tài khoản Tenant, object key hoặc toàn bộ điều khoản.

## Metadata tương thích ngược

- `GET /api/v1/contracts/{id}` bổ sung `locationId` từ Room được server truy vấn.

### Giá và phí thỏa thuận theo hợp đồng (13/11/2026)

BF-01 / BF-03 / BF-05, UC-07/15/19/21, GBR-08/09: API detail bổ sung `agreedCharges` nullable,
gồm `policyId`, `chargeCode`, `name?`, `category`, `method`, `rate` (decimal string),
`effectiveFrom`, `effectiveTo`, `version`. Đây là giá thỏa thuận của hợp đồng, không phải biểu phí hiện tại của cơ sở.
`priceLockedAt` ghi thời điểm bắt đầu ký Main/Renewal hoặc kế thừa thời điểm khóa Holding khi chuyển đổi.
Holding vẫn chỉ đạt lock nghiệp vụ khi đủ chữ ký và cọc xác minh; Owner approval đã giữ nguyên toàn bộ phí.

Direct Main, Renewal và Holding draft lưu danh sách giá trong snapshot Compact24 hiện hữu; Main Draft release
dùng dữ liệu đã xem xét và bảo vệ, không tự lấy giá mới. Holding approval từ chối nếu danh sách/phiên bản giá đã đổi
kể từ lúc tạo draft. Conversion giữ nguyên tất cả khoản thu của Holding, kể cả điện/nước/dịch vụ và giá thuê.
Snapshot v1 đưa danh sách phí vào hash điều khoản ký, giữ hash tương thích với Holding lịch sử v0.
Hợp đồng cùng phòng có thời gian chồng lấn phải có cùng mã phí, loại, cách tính và đơn giá khi bắt đầu ký/duyệt;
renewal tiếp nối sau ngày kết thúc có snapshot mới, không cập nhật hợp đồng cũ.

Thiếu giá điện/nước, đơn vị không hỗ trợ hoặc snapshot bị thiếu/sai: backend trả blocker/409, không suy diễn 0
hoặc lấy biểu phí sống để bù. Cấu hình UtilityProfile có công thức nhiều bậc/định mức đang có hiệu lực trong kỳ
hợp đồng mới trả `contract_utility_profile_requires_review` cho đến khi có cơ chế snapshot tariff được duyệt.
Hợp đồng đã ràng buộc giá phẳng tiếp tục dùng snapshot. Legacy Main đã ký không có snapshot không được tự backfill
từ cấu hình hiện tại; cần đối chiếu dữ liệu thỏa thuận gốc trước khi phát hành hóa đơn/quyết toán.

- `GET /api/v1/capture/meter-tasks` bổ sung `contractId` và `confirmedReadingId` nullable,
  giữ nguyên scope Owner/Staff và giới hạn 100 tác vụ hiện có. UI Staff dùng để chọn reading
  Final (`purpose=2`) đúng hợp đồng, loại đồng hồ và ngày kiểm tra; backend kiểm tra lại tất cả.
  Tenant không được gọi API capture.
- UI Owner dùng API capture hiện có để tạo Final task, không tạo reading giả. Sau khi Staff
  chụp ảnh và xác nhận, reading ID được dùng trong inspection.

## Client

Mọi Contract mutation dùng `Idempotency-Key` UUID, kể cả request không có body; giữ lại key
cho cùng payload sau lỗi chưa rõ kết quả. Không tự retry lỗi mạng/409/503. Chỉ refresh token
và gửi lại một lần sau 401 theo transport hiện có. Sync ký là thao tác do người dùng yêu cầu.
Tải PDF/ảnh qua bearer, không đưa token vào URL; không có URL công khai cho file riêng tư.
Ngày date-only giữ nguyên ISO trên wire; giờ lịch nhập ở Việt Nam được đổi UTC.

## Chứng thư và bộ ký PDF — cập nhật 30/10/2026

- API chứng thư hiện có: `GET /api/v1/digital-signing/certificates`, `POST` cùng đường dẫn
  với `{ providerUserId, serialNumber? }`, `POST /api/v1/digital-signing/certificates/{id}/lock`
  với `{ locked: true|false }`. Không thêm endpoint ở lượt này.
- Chỉ Owner/Tenant đã đăng nhập; Staff 403. GET chỉ trả chứng thư của actor; khóa/mở khóa
  chứng thư người khác trả 404. Mutation được ghi `ContractCertificateLocked`/`Unlocked`
  vào SecurityAudit. Khóa áp dụng cho yêu cầu ký mới, không thu hồi chữ ký đã có hoặc hủy
  giao dịch đang chờ tại nhà cung cấp.
- Khóa/mở khóa là gán trạng thái đích, không phải toggle; lặp cùng body không đảo trạng thái.
  Client tải lại danh sách sau mutation, kể cả lỗi không xác định kết quả. Không tự gửi lại ký.
- Web/mobile hiển thị chứng thư, trạng thái và hạn dùng; chỉ cho chọn chứng thư server đánh dấu
  `usable`, không khóa và đang trong `[validFrom, validTo)`. Server vẫn kiểm tra lại trước ký.
- Backend chính đã đăng ký iText qua `AddContractPdfSigning()`, chỉ dùng bộ ký PDF,
  không đăng ký DbContext/controller/settings của sandbox. Chữ ký thứ hai là incremental revision.
- Đã có concrete renderer dùng snapshot sealed và mẫu Development/Testing có phiên bản; chưa có mẫu production được duyệt.
  Mặc định chưa chọn template vẫn trả 503 với code `contract_template_not_configured`.
  Chọn mẫu thử ngoài Development/Testing trả 503 `contract_template_not_approved`, kể cả khi tiếp tục ký PDF của bên thứ nhất.
  Cấu hình, dữ liệu PDF và kết quả kiểm chứng: [BH-16 PDF renderer](../development/BH16_CONTRACT_PDF_RENDERER.md).
  Client giải thích lỗi bằng tiếng Việt; không suy diễn thành Signed hoặc Active.
  `signing_certificate_not_valid` và `signing_certificate_no_longer_available` có thông báo riêng.
- Quyết định và giới hạn: [DIGITAL_SIGNING_COMPLETION.md](../development/DIGITAL_SIGNING_COMPLETION.md).

# BH-40 — Contract lifecycle

Tái sử dụng `/api/v1/contracts/{id}` renewal/signing/activation, termination-requests,
expiry-move-out, move-out/approve/schedule/inspection/settlement/complete hiện có.

Sau khi Tenant gửi yêu cầu kết thúc trước hạn (UC-19), hệ thống phát thông báo trong ứng dụng cho
Owner đang hoạt động và Staff đủ điều kiện đang được phân công tại cơ sở của phòng. Bộ phát thông
báo đọc audit đã lưu, chống gửi trùng theo hợp đồng và người nhận, và chỉ phát khi yêu cầu còn chờ
duyệt. Nội dung thông báo không chứa lý do trả phòng. Owner vẫn thực hiện bước phê duyệt theo
luồng hiện có.

Owner Web mở riêng trang **Yêu cầu kết thúc hợp đồng** từ thông báo hoặc chi tiết hợp đồng.
`GET /api/v1/contracts/{id}/move-out/review` chỉ dành cho Owner, trả thông tin đề nghị và
kết quả xét duyệt. Owner chấp nhận bằng endpoint `move-out/approve` hiện có hoặc từ chối
bằng `POST /api/v1/contracts/{id}/move-out/reject` với `{ "reason": "..." }` và
`Idempotency-Key`. Từ chối chỉ áp dụng cho hồ sơ `Requested` của hợp đồng `Active`,
lưu `Rejected` cùng lý do, người xử lý và thời điểm trong lịch sử. Gửi lại cùng khóa
không ghi thêm quyết định. Quyết định mới trên hồ sơ đã xử lý trả HTTP 409.
Owner Web gửi phiên bản đã xem qua `expectedVersion` (query của approve, body của reject);
phiên bản cũ trả HTTP 409. Một yêu cầu bị từ chối vẫn được lưu trong lịch sử khi Owner lập
hồ sơ trả phòng lúc hết hạn về sau. Trạng thái và lý do dùng dữ liệu hiện có, không cần migration.

Mutation JSON cần Idempotency-Key GUID. Auth ở service, object scope lấy từ DB.

- GET `{id}/versions`: Owner/Tenant sở hữu, Staff assigned; cùng chain previous/next;
  Staff chỉ dates/status, không rent/terms. Renewal chỉ Active khi ngày hiệu lực và đủ ký/cọc.
- POST `{id}/termination-requests`: Tenant đề nghị trả phòng sớm (`proposedDate` từ hôm nay đến trước ngày hết hạn), tạo `Requested`.
  Chỉ sau POST `{id}/move-out/approve` bởi Owner, hồ sơ mới chuyển `Approved` và xuất hiện trong danh sách công việc Staff tại cơ sở.
- POST `{id}/expiry-move-out`: Owner chủ động lập yêu cầu trả phòng cho hợp đồng Active, với
  `proposedDate >= hôm nay`, có thể trước, đúng hoặc sau ngày hết hạn. API giữ tên cũ để tương thích,
  tạo trực tiếp trạng thái `Approved` (ghi nhận Owner và lịch sử), mở việc ngay tại cơ sở.
  Không đổi trạng thái hợp đồng hoặc phòng khi lập yêu cầu. Một hợp đồng chỉ có một hồ sơ trả phòng;
  lặp cùng Idempotency-Key + payload trả về cùng hồ sơ, khóa khác khi đã mở trả 409.
- POST `{id}/move-out/schedule`: Owner hoặc Staff assigned, `{scheduledAt UTC,staffUserId?,
expectedVersion?}`. Staff không chỉ định người ngoài assignment Location. Owner để trống
  assignee sẽ giữ công việc chung cho cơ sở; nếu chỉ định Staff thì chỉ Staff đó thực hiện.
  Lịch hẹn tùy chọn để điều phối, không bắt buộc trước khi Staff kiểm tra. Không đóng Contract.
- GET `move-out-assignments`: Staff, tối đa 100 hồ sơ đã `Approved` và chưa `Completed`
  của các Location hiện được phân công. Hồ sơ chưa gán người xuất hiện cho mọi Staff đủ điều kiện
  tại cơ sở; hồ sơ gán đích danh chỉ xuất hiện cho người được gán. Có thể `scheduledAt=null`.
  `Requested` chờ duyệt không hiển thị. Trạng thái và quyền được kiểm tra từ dữ liệu hiện tại.
- POST `{id}/move-out/inspection`: Staff tại Location ghi kiểm tra khi `proposedDate <= hôm nay`,
  kể cả không có lịch hẹn. Vẫn bắt buộc confirmed Final readings, snapshot/bằng chứng và
  `expectedVersion` nếu gửi; không tự hoàn tất Contract hoặc quyết toán tài chính.
- GET `{id}/move-out/history`: Owner/Tenant của Contract hoặc Staff assigned; append-only.
  MoveOut response bổ sung inspectionStaffId/version. Version 1 request, tăng khi approve/schedule.
  Không thêm reject/cancel termination. Không dùng tenancy của người khác để mở evidence.

GET `{id}/move-out/inspection-preparation`: Owner/Staff lấy confirmed handover snapshot của
Contract hoặc ancestor renewal và danh sách confirmed Final readings hôm nay đúng Contract.
InspectionInput thêm assets `{id,condition}[]`, roomCondition, keysAndAccess, expectedVersion.
Snapshot baseline không lấy Asset condition hiện tại. Legacy inspection thiếu baseline giữ
blocker; không thể resolve production settlement. Final reading là observation của Contract,
không reset baseline hoặc tự tạo phí cho cả phòng khi co-Tenants vẫn ở.
GET `{id}/move-out/inspections`: so sánh baseline/observed và Owner review, scoped như Contract.
POST `{id}/move-out/inspection-review`: Owner `{version,confirmed,reason}`; confirmed=false
yêu cầu reinspection, giữ lần cũ. Mỗi version chỉ một review, không ghi đè snapshot/ảnh.

GET `{id}/move-out/settlement-summary`: Owner/Tenant của Contract, Staff 403. Cọc lấy từ
root Contract của renewal chain, không cộng lại từng phiên bản; shared invoices là context,
không liability cá nhân. Summary trả source financials BH-41, unresolvedItems, reference hash,
resolved, nullable deductions/refund/final charges. Owner inspection review có thêm
noAdditionalCharges để xác nhận không có khoản inspection riêng cần tính; nếu chưa xác nhận
giữ Pending, không tự tính damage fee. Kỳ chưa Final, usage chưa billed, pending disputes,
bank review, excess, deposit/holding chưa giải quyết đều chặn resolved.
POST settlement bổ sung expectedReference (bắt buộc khi resolved) chống xác nhận snapshot cũ.
History lưu FinancialSnapshot bất biến và source reference, không tạo allocation/refund mới.

JOB-02: `contract-expiry` dùng BackgroundJobs hiện có, scheduler chạy lúc khởi động và mỗi
ngày theo Asia/Ho_Chi_Minh khi `Jobs:Enabled=true`. Worker bounded retry/lease hiện có;
handler re-read dưới Room lock, unique Contract/enddate/stage/recipient. Upcoming30 áp dụng
0..30 ngày trước hạn; Expired khi ngày hiện tại vượt EndDate. Không tự đóng hoặc đổi Room.
GET `expiry-reminders`: Owner xem nhắc hợp đồng hiện hành (mỗi hợp đồng một nhắc), Tenant
chỉ nhận nhắc của mình; Staff 403. Tối đa 100 nhắc mới nhất, loại hợp đồng đã kết thúc/gia hạn.
Notices được lưu để xem trong Web/Mobile và đã được `notification-publish` đưa vào inbox theo
[NOTIFICATIONS.md](NOTIFICATIONS.md). JOB-04 retry có implementation; external email/push provider
vẫn Unconfigured, chưa nghiệm thu gửi thật.

[Receipt-excess refund](REFUNDS.md) chỉ hoàn phần receipt chưa phân bổ, không phải refund cọc.
Hoàn xong khoản dư đó không tự bỏ blocker `deposit_deduction_refund_policy_required` hoặc giải phóng Room.
Slice mới [hoàn cọc không khấu trừ](REFUNDS.md) đã có nguồn deposit riêng và manual execution/evidence;
chỉ hoàn đầy đủ, không reservation, source hợp lệ và mọi guard khác đạt mới bỏ blocker cọc. Nhánh
khấu trừ `TenantDamage` nay có [backend plan/evidence/remainder journal](DEPOSIT_DEDUCTIONS.md),
Owner Web editor/refund review và browser có phí đã chạy; nullable không được đổi thành 0 để giả
resolved. Final harness đạt 22 nhóm có phí và 21 nhóm không phí, gồm inbox explicit pump và Finance
report. Không suy thành native, bank-provider/MySign hoặc notification scheduling/delivery acceptance.
Chưa có MySign staging thật hoặc mẫu Production được duyệt.

## Settlement calculation — BE-19, 06/11/2026

GET `move-out/settlement-summary` bổ sung optional `calculation`; không thêm route/schema.
Tiền là chuỗi decimal nguyên: `issuedTotal`, `approvedAdjustmentTotal`, `payableTotal`,
`verifiedInvoicePayments`, `roomOutstanding`, nullable `contractSpecificOutstanding`,
`potentialInvoiceExcess`, nullable `depositAllocated`, `depositRefunded`, `depositReserved`,
`availableSecurityDeposit`; `depositPositionConsistent` là boolean.

Không cộng cọc vào tiền thu hóa đơn hoặc cộng Adjustment hai lần. Hóa đơn chung còn nợ giữ
nghĩa vụ cá nhân null. Available = received − net outgoing deposit allocations − Completed
deposit refunds − Requested/Approved deposit refunds, đọc ledger Compact24 cùng transaction/lock
của summary. Rejected/Cancelled không giữ chỗ. Chuỗi renewal đọc một lần theo ID, không cộng lặp
cọc root theo số phiên bản. Received phải khớp deposit verifications; position âm/sai nguồn trả
available null và blocker `deposit_ledger_reconciliation_required`.

Đây là số dư nguồn trước quyết định Owner, **không phải lệnh khấu trừ hoặc số hoàn đã duyệt**.
`refundAmount`/`approvedDeductions` vẫn null khi thiếu quyết định/verified completion; nhánh hoàn cọc
không khấu trừ có thể xác nhận 0 deduction sau khi trả đủ. Mọi thay đổi position đổi reference;
`financialReference` riêng giữ source obligations khi reservation/return thay đổi. Reader legacy
offline trả unknown, không truy cập database khác.

### Mức tiền giữ chỗ và tiền cọc với bản nháp mới

Theo quyết định nghiệp vụ cho BF-03A/BF-03B, UC-13–16, mức tiền giữ chỗ và tiền cọc thuê chính thức khi tạo mới đều bằng một tháng tiền thuê ghi trong bản nháp. Khi chuyển đổi hồ sơ cũ, BHOME giữ nguyên dữ liệu hợp đồng giữ chỗ và kế thừa đúng khoản đã xác minh. Hợp đồng chính ghi mức cọc ít nhất bằng một tháng tiền thuê đã chốt và giữ đủ khoản đã nộp nếu mức cọc cũ cao hơn. Phần chưa đủ được thể hiện trong số dư cọc và chặn kích hoạt cho đến khi được xác minh. Các trường cấu hình cọc cũ vẫn tồn tại trong API để tương thích.

Theo BF-06, giao dịch SePay chỉ được tự động phân bổ khi số tiền nhận khớp toàn bộ số dư của nghĩa vụ. Giao dịch lệch số tiền vẫn được lưu làm bằng chứng và chuyển sang đối soát, với số dư nghĩa vụ giữ nguyên.

### Thanh toán và hoàn cọc khi phòng có nhiều hợp đồng thuê

Khi lập nghĩa vụ ban đầu, backend khóa phòng và liên kết khoản cọc với nghĩa vụ của chu kỳ còn mở. Tiền thuê dùng kỳ tháng bắt đầu hợp đồng. Nếu đã có nghĩa vụ tiền thuê ban đầu hoặc hóa đơn phòng đã chốt cho kỳ đó, backend tái sử dụng nghĩa vụ có sẵn và mã chuyển khoản của nó. Các phí theo người vẫn được tính theo từng hợp đồng. Khi số dư phải trả bằng 0, API không phát hành QR.

Trong Sandbox đã được cấp phạm vi, hợp đồng chưa lưu chế độ thanh toán có thể đối chiếu khoản chung Sandbox của cùng phòng. Hợp đồng đã ghi rõ Live vẫn đối chiếu theo Live.

Khi một Tenant kết thúc trước, khoản cọc chung được giữ cho hồ sơ bàn giao cuối của chu kỳ. Owner xác nhận người nhận đã được xác minh từ hồ sơ của Tenant bàn giao cuối. Nguồn tiền hoàn vẫn tham chiếu đúng khoản cọc gốc và quy trình đối soát, bằng chứng chuyển tiền vẫn được áp dụng.

# Cập nhật danh sách và hồ sơ — 26/11/2026

- `GET /api/v1/contracts` bổ sung query `kind` (Main/Renewal/Holding/Addendum); lọc sau quyền truy cập và trước count/pagination. `pageSize` vẫn theo API hiện có, Owner Web chọn 10; các client khác giữ mặc định 20.
- Mỗi summary bổ sung `representativeName` từ hồ sơ đã xác nhận. Các occupant trong chi tiết cũng dùng đúng tên hồ sơ/hồ sơ rút gọn; không dùng tên phòng làm tên người.
- `GET /contracts/preparation` trả label người ở từ hồ sơ xác nhận. Owner có số định danh đầy đủ trong picker theo yêu cầu; Staff chỉ thấy số đã che (4 số cuối), không nhận CCCD đầy đủ. Không thay quyền của `/residents` hoặc thêm ảnh CCCD.
- DOCX renderer version 4 sửa căn chữ nội quy nhiều dòng và ghi rõ phí theo người tính theo sức chứa phòng. PDF đã đưa đi ký/đã ký tiếp tục dùng file snapshot bất biến.
