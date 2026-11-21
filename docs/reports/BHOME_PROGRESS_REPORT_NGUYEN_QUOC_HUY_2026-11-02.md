# Báo cáo tiến độ và thực trạng hệ thống BHOME

**Người báo cáo:** Nguyễn Quốc Huy  
**Dự án:** SEP490-G92 BHOME  
**Ngày kiểm tra:** 02/11/2026, múi giờ Asia/Ho_Chi_Minh  
**Người nhận:** Giảng viên hướng dẫn  
**Vai trò:** Team Leader, Product Owner proxy, Backend Developer và tích hợp kỹ thuật  
**Phạm vi mã nguồn:** nhánh `member/QHuy`, HEAD `da4aec2`; có thay đổi local sẵn từ trước ở `docs/development/MOBILE_READINESS_EXPIRY_FIX.md`.

## 1 Kết quả chính để báo cáo giảng viên

Em đã triển khai và tích hợp thêm các phần nghiệp vụ hợp đồng, hóa đơn, đối soát thanh toán, điều chỉnh hóa đơn, gia hạn và trả phòng, cùng lịch hóa đơn tự động và thông báo trong ứng dụng. Các phần này đã có service, lưu trữ, API, giao diện và kiểm thử ở những phạm vi cụ thể. Nhận định trong bản audit đầu ngày 01/11 rằng chưa có backend Invoice, Payment và Invoice Adjustment không còn đúng với mã nguồn hiện tại.

Trong lượt kiểm tra ngày 02/11, **889 automated tests đã chạy và đạt**, gồm 83 Domain, 177 Application, 181 tests không cần Docker trong project IntegrationTests, 41 Digital Signing, 97 Owner Web và 310 Mobile. Script kiểm tra môi trường Mobile đạt thêm **75 assertions**. Build frontend, lint, Mobile typecheck và kiểm tra định dạng trước khi bổ sung báo cáo đều đạt. Đây là kết quả kiểm thử mã nguồn và component, chưa phải tỷ lệ hoàn thành sản phẩm hay bằng chứng đạt nghiệm thu hệ thống.

**Chưa đủ cơ sở công bố toàn bộ BHOME hoàn thành.** Holding Contract còn thiếu ledger; ký MySign thật, lấy giao dịch ngân hàng và gửi push/email thật chưa được kiểm chứng. Nhiều màn hình quản trị vẫn là demo hoặc chưa nối API; Public Website vẫn là màn hình mẫu Vite. Chưa chạy lại integration PostgreSQL/MinIO trong lượt này vì Docker daemon không hoạt động; chưa có kết quả ST/AT, thiết bị thật, coverage hay hiệu năng mới.

**Môi trường đang mở chưa sẵn sàng demo nghiệp vụ ngay.** API local hoạt động và database đã theo kịp migration, nhưng database `bhome` hiện chỉ có ba tài khoản, chưa có Location, Room, Contract hay Invoice. Cần chuẩn bị môi trường demo riêng, dữ liệu tổng hợp và kết nối client trước buổi trình bày.

### Những nhận định cần sửa trong báo cáo cũ

| Nội dung trong bản cũ                        | Kết quả đối chiếu hiện tại                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BH-21 chưa có backend Invoice hoàn chỉnh     | Đã có `InvoiceService`, repository, Draft/Final, snapshot và giao diện Owner/Tenant; vẫn còn phạm vi chưa hỗ trợ và chưa nghiệm thu chính thức.            |
| BH-25 chưa hoàn chỉnh luồng đối soát hóa đơn | Đã có transfer, allocation, manual reconciliation, QR, debt/history; adapter ngân hàng thật còn Unconfigured.                                              |
| BH-41 chưa đủ backend điều chỉnh hóa đơn     | Đã có request, evidence, approve/reject, correction Draft và adjustment riêng cho Final.                                                                   |
| BH-40 chỉ có một số kiểm tra trạng thái      | Đã có inspection, settlement summary/review, đóng hợp đồng có revalidation và xử lý phòng chung; khấu trừ/hoàn cọc/credit còn chờ chính sách và ledger.    |
| BH-16 thiếu toàn bộ PDF                      | Đã có preview và renderer Development; có thêm DOCX/PDF cho Main Tenancy Draft. Mẫu production và ký thật vẫn chưa được nghiệm thu.                        |
| Readiness failed chưa rõ nguyên nhân         | Tài liệu khắc phục ghi nhận migration chưa áp dụng. Hiện API ready 200 và không còn migration pending; kết nối Mobile/CA vẫn cần kiểm tra đúng môi trường. |
| Chỉ có số test của audit ngày 01/11          | Thay bằng số thực chạy ngày 02/11 trong mục 5; không cộng các lượt test lịch sử vào kết quả mới.                                                           |

## 2 Căn cứ và cách xác định trạng thái

Đã đối chiếu nội dung người dùng cung cấp với mã nguồn thực tế, lịch sử Git local, Report 1–4 trong `docs/reports`, các tài liệu API/development, cấu hình chạy local và kết quả kiểm tra mới. Các báo cáo gốc được giữ nguyên. Trong thư mục `docs/reports` hiện có bốn báo cáo Word; chưa có bộ Report 5–7 hoặc workbook kiểm thử tại thư mục này để xác nhận bằng chứng nghiệm thu chính thức.

Các mức đánh giá được dùng trong báo cáo:

- **Đã triển khai:** đã tìm thấy implementation và thành phần liên quan trong repo. Không tự suy ra đã chạy đúng trên môi trường thật.
- **Đã kiểm chứng trong lượt này:** có lệnh đã thực thi, kết quả và log mới ngày 02/11.
- **Có bằng chứng demo trước đây:** có guide, manifest/kết quả/screenshot local của lượt trước; chưa có nghĩa đã replay thành công trên HEAD và môi trường hiện tại.
- **Còn chặn:** thiếu nghiệp vụ được duyệt, provider, dữ liệu hoặc hạ tầng cần thiết.
- **Đủ điều kiện Done:** cần thêm review, CI, integration và acceptance theo Definition of Done của nhóm. Không gắn nhãn này chỉ vì có code hoặc unit test xanh.

Truy vết chính: Auth và phân quyền theo UC-01/02, GBR-01/02; hợp đồng theo BF-03/BF-04, UC-14–19, GBR-04; ghi số và hóa đơn theo BF-05, UC-20/21, GBR-07–09, DBR-06/07; thanh toán và điều chỉnh theo BF-06, UC-22–25, GBR-10/18; lịch hóa đơn và thông báo theo JOB-02/04/09/10.

**Thay đổi nghiệp vụ cần đồng bộ lại tài liệu:** `BH21_TRACEABILITY.md` ghi nhận quyết định ngày 01/11 cho phép nhóm khách cùng phòng có hợp đồng riêng và dùng một hóa đơn chung Room + tháng. Quyết định này khác SRS gốc quy định Contract + kỳ. Implementation mới phải được báo cáo theo quyết định đã ghi nhận, đồng thời cập nhật SRS/SDS/ERD/test case; không coi khác biệt này là lỗi để quay lại mô hình cũ một cách tự động.

## 3 Công việc kỹ thuật của Nguyễn Quốc Huy

Theo Report 2, Quốc Huy chịu trách nhiệm Backend API, database, core business logic, tích hợp liên chức năng và tổng hợp sản phẩm. Nguyễn Quang Huy là Scrum Master và Testing Lead. Metadata Git local xác nhận Quốc Huy có các commit nghiệp vụ và tài liệu được nêu dưới đây; metadata không chứng minh số giờ làm việc hoặc nghiệm thu của từng task.

### 3.1 Nền tảng backend và phân quyền

**Đã có:** kiến trúc .NET 8 theo lớp; ASP.NET Core Identity, JWT, refresh session, thay/đặt lại mật khẩu, lockout, role Owner/Staff/Tenant, kiểm tra quyền và Location scope, các bản ghi audit. Backend có controller và service riêng cho Contract, Capture/OCR, Property, Operational Task, Billing, Payment, Notification.

**Đã kiểm chứng:** solution được restore/build trong output riêng khi chạy test; 83 Domain, 177 Application và 181 tests không Docker đạt. API đang chạy trả live/ready 200; Contracts không có token trả 401. Trong phiên hỗ trợ trước lượt audit này, ba tài khoản development đã được kiểm tra login 200, đúng role, `/auth/me` 200 và logout 204 sau khi mở khóa Owner/Staff.

**Còn phải làm:** regression với database/storage thật, kiểm tra phân quyền và cô lập dữ liệu trên staging. Luồng cấp/kích hoạt tài khoản Tenant đầy đủ không được suy ra từ công cụ tạo ba tài khoản local hoặc từ tính năng lập Main Draft.

### 3.2 BH-16 về hợp đồng và UC-17 về bàn giao

**Đã triển khai:** tạo Main Contract, preparation theo quyền, liên kết Resident–Tenant, preview PDF, metadata/hash và file private, trạng thái ký, readiness, xác minh cọc và Owner activation. Bàn giao có snapshot phòng/tài sản/chỉ số, evidence, version, xác nhận Tenant và Staff, tranh chấp và lịch sử. File và thao tác nhạy cảm có kiểm tra quyền; Staff không ký thay Owner/Tenant hoặc kích hoạt hợp đồng.

**Bằng chứng:** `ContractService`, `ContractWorkflowService`, `ContractHandoverService`, repository/EF configuration, `ContractsController`, Owner contract panels và Mobile contract screens; guide `CONTRACT_MANAGEMENT_WORKFLOW.md` cùng script seed/test Contract. Các kiểm thử không Docker về guard, PDF và ký tổng hợp được chạy trong lượt hiện tại; các nhánh persistence đầy đủ cần Docker.

**Chưa hoàn tất:** `UnconfiguredContractHoldingLedger.ApplyAsync` vẫn ném lỗi integration unavailable. Chưa đủ Holding Contract → verified Holding Deposit → On Hold → chuyển cọc sang Main → hết hạn JOB-05. Không được demo nhánh này như chức năng đã hoàn thành. MySign có adapter và phần ký PDF, nhưng chưa có bằng chứng ký hợp đồng thật với provider, xác minh chủ chứng thư và trust profile được duyệt. Demo hiện sử dụng Simulated khi bật cấu hình Development.

**Bổ sung của thành viên khác:** commit `acc19bd` của **Long** triển khai luồng Staff hoàn tất onboarding → preparation → DOCX/PDF → lưu/mở lại Main Tenancy Draft. Luồng này không tự cấp tài khoản Tenant, không ký, không chuyển cọc, không tạo QR và không kích hoạt phòng. PDF phụ thuộc converter LibreOffice hoặc container đã cấu hình. Đây là kết quả tích hợp của nhóm, không ghi toàn bộ là phần Quốc Huy trực tiếp lập trình.

### 3.3 BH-21 về ghi số và hóa đơn

**Đã triển khai:** Staff ghi số bằng OCR hoặc nhập tay, bắt buộc xác nhận; kiểm tra baseline/previous reading, ảnh và phạm vi tác nghiệp. Hóa đơn có Draft/Final, snapshot biểu phí, input theo kỳ, kiểm tra lại trước phát hành, lưu quyền xem theo `InvoiceRecipients`, giới hạn một hóa đơn phòng/kỳ theo quyết định mới và bảo vệ Final khỏi sửa trực tiếp. Owner có màn hình cấu hình/ghi số/hóa đơn; Tenant xem dữ liệu được phép.

**Điểm quan trọng khi trình bày:** OCR chỉ đề xuất. Không dùng số chưa xác nhận để tính hóa đơn chính thức. Thiếu dữ liệu bắt buộc phải giữ Draft hoặc báo blocker; Staff không được phát hành Final. Quyền xem hóa đơn cũ không mất chỉ vì Tenant đã rời phòng.

**Bằng chứng:** `InvoiceService`, `InvoiceRepository`, `Invoice`, `InvoicesController`, `CaptureService`, các migration, `BH21_TRACEABILITY.md`, `BILLING_WORKFLOW_GUIDE.md`, các test Invoice/Capture và client tương ứng. Đã có browser/DB demo từ lượt trước; chưa replay bộ này trong lượt audit hiện tại.

**Còn phải làm:** acceptance về biểu phí và mô hình phòng chung; trường hợp thay meter/thiếu baseline; nâng cấp dữ liệu cũ; đo OCR trên bộ ảnh được phép. Chưa chứng minh đạt mục tiêu OCR ≥90% trên ≥50 ảnh hoặc thời gian xử lý ≤10 giây.

### 3.4 BH-25 về thanh toán và công nợ

**Đã triển khai:** cấu hình tài khoản nhận, QR tạo tại hệ thống, hướng dẫn chuyển khoản từ dư nợ server; transfer, allocation và lịch sử đối soát; Owner xác minh giao dịch dựa trên sao kê; khóa và idempotency tránh ghi nhận tiền hai lần; Tenant xem trạng thái/chứng từ được phép; debt/history theo phạm vi.

**Ranh giới hiện tại:** QR hoặc ảnh chuyển khoản không làm Invoice thành Paid. Luồng đã có là đối soát thủ công được Owner xác minh. Giao dịch thiếu/thừa tiền, sai reference, chưa match hoặc đến sau khi đã Paid giữ trạng thái cần review theo implementation; không tự phân bổ, hoàn tiền hay tạo Tenant Credit khi chính sách chưa duyệt. `IBankTransactionProvider` vẫn có implementation Unconfigured.

**Bằng chứng:** `PaymentService`, `TransferInstructionsService`, Payment repositories/entities, `PaymentTransactionsController`, `DebtsController`, `ReceivingAccountsController`, `BH25_TRACEABILITY.md`, `PAYMENT_WORKFLOW_GUIDE.md`. Git có các commit của Quốc Huy cho feature và guide, ví dụ mốc tài liệu `133642a`.

**Còn phải làm:** chọn và cấu hình provider thật, xác thực callback hoặc cơ chế lấy giao dịch, retry JOB-03, test sandbox; chốt partial/excess/allocation/refund/credit và kiểm thử tài chính liên quan. Không báo cáo hệ thống đã tự động đối soát ngân hàng thật.

### 3.5 BH-41 về điều chỉnh hóa đơn

**Đã triển khai:** Tenant gửi yêu cầu và evidence private; Owner approve/reject có lý do và version; correction cho Draft; với Final tạo adjustment riêng, giữ nguyên hóa đơn và dòng tiền gốc. Balance/debt/QR dùng số hiệu lực phía backend. Nếu giảm sau khi đã trả đủ gây tiền thừa, giữ trạng thái review thay vì tự hoàn/credit.

**Quyền truy cập:** người cùng xem hóa đơn được biết balance; nội dung riêng của yêu cầu và evidence chỉ có requester/Owner theo quyền. Staff không có quyền quyết định điều chỉnh.

**Bằng chứng:** `AdjustmentService`, `AdjustmentDecisions`, `InvoiceAdjustment`, `InvoiceAdjustmentsController`, Owner review, Tenant request/history, `BH41_TRACEABILITY.md` và `INVOICE_ADJUSTMENT_WORKFLOW_GUIDE.md`; mốc guide của Quốc Huy `3983fc7`.

**Còn phải làm:** regression approve/reject đồng thời với payment, privacy và file access trên staging; tester xác nhận ST/AT; hoàn tất chính sách xử lý số dư thừa. Không còn phù hợp khi ghi BH-41 là “chưa có backend”.

### 3.6 BH-40 về gia hạn và trả phòng

**Đã triển khai:** renewal/version chain, yêu cầu và duyệt chấm dứt, xếp lịch/người kiểm tra, final inspection dựa trên bàn giao và số đã xác nhận, settlement summary/review, revalidation trước đóng và kiểm soát giải phóng phòng. Khi còn Tenant khác Active, đóng một hợp đồng không làm phòng Available. JOB-02 có xử lý thông báo hết hạn và chống tạo trùng.

**Ranh giới tài chính:** settlement có thể hoàn tất ở nhánh không phát sinh cọc/hoàn cọc và mọi nghĩa vụ đã xác minh đủ. Nếu còn nợ chung, cọc chưa xử lý, usage cuối chưa được lập hóa đơn, request/dispute/excess chưa giải quyết thì phải hiển thị blocker và giữ PendingSettlement. Không có công thức khấu trừ/hoàn cọc được duyệt thì không tự tạo bút toán hoặc giả số 0 để đóng.

**Bằng chứng:** `ContractLifecycleService`, `ContractFinalInspectionService`, `ContractSettlementLedger`, `ContractExpiryProcessor`, các record/history và giao diện Owner/Staff/Tenant; `BH40_TRACEABILITY.md`, `CONTRACT_RENEWAL_MOVEOUT_GUIDE.md`; mốc guide của Quốc Huy `65a8c33`.

**Còn phải làm:** chốt nợ chung khi rời phòng, phí hư hỏng, khấu trừ/refund/credit và final utility billing; bổ sung posting ledger theo quyết định được duyệt và regression đầy đủ. Không coi việc có endpoint settlement là đã hoàn thiện mọi trường hợp quyết toán.

### 3.7 Tự động hóa và thông báo

**Đã triển khai:** lịch Owner cấu hình theo cơ sở/kỳ; JOB-09 tạo task ghi số theo phòng/utility/kỳ; JOB-10 tạo Draft và Final với kiểm tra input. Automatic Final yêu cầu Owner ủy quyền opt-in, không mặc nhiên phát hành. Có queue/worker, execution history, xử lý retry/lease và lọc handler mà binary thực sự hỗ trợ.

Thông báo trong ứng dụng đã có inbox bền vững, read/unread, chống trùng theo recipient/event, target authorization và deep link. Có consumer cho các event hợp đồng/hóa đơn/thanh toán/điều chỉnh và nền tảng delivery retry JOB-04. Vì các phần này được bổ sung sau guide thanh toán cũ, không tiếp tục dùng nhận định cũ “chưa có notification consumer” cho toàn hệ thống.

**Bằng chứng:** `BillingAutomationJobs`, `NotificationDeliveryService`, `PostgresJobWorker`, các controller Billing/Notifications, `JOBS_TRACEABILITY.md`, `BILLING_AUTOMATION_NOTIFICATION_GUIDE.md`; các commit Quốc Huy từ `79a519f` đến `fc6a087`, mốc guide `86a3c81`.

**Còn phải làm:** push/email thật và delivery receipt; JOB-01 nhắc nợ và JOB-03 phụ thuộc policy/provider; không khẳng định toàn bộ JOB-01–10 đã hoàn tất. JOB-06/07 còn cần đối chiếu phạm vi và bổ sung bằng chứng theo backlog. JOB-08 có mâu thuẫn quyền/cadence trong nguồn yêu cầu, chưa tự quyết nhánh Staff; đăng ký tạm trú chính thức thực hiện ngoài BHOME qua VNeID.

## 4 Thực trạng các phần còn lại của hệ thống

| Nhóm chức năng                         | Tình trạng cụ thể                                                                                                                                                                                                                                                             | Việc cần hoàn thiện                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain, Location, Room, Asset, biểu phí | Có model/service/API và test backend. Các route Owner Locations/Rooms/Assets hiện đi vào `features/property`, sử dụng `PropertyBoundary` và repository portal; repository này chưa cung cấp dữ liệu thật ở API mode. Một số luồng giá phục vụ billing đã có client API riêng. | Nối đúng API cho từng trang quản trị; kiểm tra lại tạo/sửa và effective pricing trên staging. Không coi toàn bộ UI Property là đã tích hợp. |
| Staff và lịch làm việc                 | Có Staff Location assignment và Operational Task backend. Trang Staff và Schedules vẫn dùng `ResourcePage`; không có bằng chứng một luồng quản lý tài khoản/lịch ca đầy đủ qua API trong lượt này.                                                                            | Chốt chủ task, hoàn thiện management UI/API cần thiết và recurring/deadline acceptance.                                                     |
| Tác vụ vận hành                        | Có service/API, Staff Mobile và Owner task page dùng API ở chế độ thật.                                                                                                                                                                                                       | Test phân công hiện hành, tiến độ, Owner verification, rework và lịch lặp trong môi trường tích hợp.                                        |
| Onboarding Tenant                      | Có OCR/capture, human confirmation, hồ sơ Resident và luồng Main Draft mới. Trang danh sách Tenant của Owner còn generic `ResourcePage`.                                                                                                                                      | Hoàn thiện account provisioning/linking, quyền và quản lý hồ sơ; nghiệm thu dữ liệu thiếu/sai và ảnh định danh chỉ xử lý tạm.               |
| Incident và Maintenance                | Trang Incident/Maintenance còn theo luồng `ResourcePage`; chưa tìm thấy controller/domain/service chuyên biệt cho đầy đủ BF-07 trong inventory backend đã kiểm tra. Operational Task không thay thế toàn bộ Incident/Work Order.                                              | Triển khai hoặc tích hợp BF-07 theo Owner review, Emergency, plan/cost approval và verification; chốt người phụ trách.                      |
| Temporary residence                    | Màn hình Owner là `ResourcePage`; chưa có bằng chứng workflow backend đầy đủ.                                                                                                                                                                                                 | Đồng bộ UC-18/JOB-08 và quyền Owner/Tenant; không thêm Staff đăng ký hay tích hợp nộp VNeID.                                                |
| Finance, report, What-if               | Dashboard, Reports, What-if dùng `usePortalData` và dữ liệu portal; có logic/màn hình demo, chưa đủ backend tài chính thực để nghiệm thu FE-08.                                                                                                                               | Xây nguồn verified revenue/OPEX/investment, API báo cáo và What-if tách dữ liệu thực.                                                       |
| Public Website                         | `src/public-web/src/App.tsx` vẫn hiển thị Get started, bộ đếm và link React/Vite. Build đạt không chứng minh đã có sản phẩm website BHOME.                                                                                                                                    | Hoàn thiện FE-09/UC-37/38 theo phạm vi chỉ đọc; dữ liệu Owner duyệt, không form thu thập Guest/booking/payment.                             |
| CI, review, ST/AT                      | Có workflow CI local và commit merge PR #28/#32 trong lịch sử Git. Chưa truy vấn trạng thái CI/review/Jira từ dịch vụ từ xa trong lượt này.                                                                                                                                   | Lấy bằng chứng CI và review trực tiếp; Testing Lead chạy/ghi nhận ST/AT. Không suy ra CI pass từ việc có merge commit.                      |

## 5 Kết quả kiểm chứng mới ngày 02 tháng 11

### 5.1 Những lệnh đã thực thi

| Kiểm tra                                                                   | Kết quả mới                                                                   | Ý nghĩa và giới hạn                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet test src/backend/BHome.sln` với `Category!=Docker` và output riêng | PASS: Domain 83, Application 177, IntegrationTests không Docker 181; tổng 441 | Restore/build thành công và test đã chạy. Không xác nhận PostgreSQL/MinIO hay provider thật.                                                                                                    |
| Digital Signing UnitTests                                                  | PASS 41                                                                       | Dữ liệu, chứng thư và provider tổng hợp/mô phỏng trong test; chưa chứng minh MySign thật.                                                                                                       |
| `npm test` với Node 22.23.4                                                | PASS: Owner Web 97, Mobile 310                                                | 14 file Owner và 32 file Mobile; component/logic test, không phải native E2E.                                                                                                                   |
| Tổng automated tests của các lệnh trên                                     | **889 PASS, 0 FAIL trong tập đã chạy**                                        | Không gồm các test Docker chưa chạy và không phải tỷ lệ ST/AT hoặc coverage.                                                                                                                    |
| `MobileDevelopment.Tests.ps1`                                              | PASS 75 assertions                                                            | Kiểm tra network/launcher; tách riêng, không cộng thành 75 test case nghiệp vụ.                                                                                                                 |
| `npm run build`                                                            | PASS                                                                          | Build client-core, Owner Web và Public Web; root build không chạy export Mobile native.                                                                                                         |
| `npm run lint` và Mobile typecheck                                         | PASS                                                                          | Kiểm tra static; không thay thế integration.                                                                                                                                                    |
| `npm run format:check` trước khi thêm báo cáo                              | PASS                                                                          | Tình trạng định dạng trước phần tài liệu mới.                                                                                                                                                   |
| PostgreSQL local và migration history                                      | Truy vấn thành công; 0 migration nguồn còn pending                            | 34 migration nguồn đã có trong history, cùng một migration legacy được compatibility tool hỗ trợ; mới nhất `20261102101139_MainTenancyDraftPreparation`. Không chạy migration/seed trong audit. |
| API live, ready và Swagger                                                 | HTTP 200                                                                      | Endpoint đang phục vụ; health không chứng minh các provider/storage đều sẵn sàng.                                                                                                               |
| Contracts vô danh                                                          | HTTP 401                                                                      | Kiểm tra âm cơ bản; không thay thế toàn bộ cross-Tenant/Location security suite.                                                                                                                |
| HTTPS localhost qua trust store Windows                                    | HTTP 200, curl exit 0, không bỏ xác minh TLS                                  | Localhost được máy này tin cậy; chưa chứng minh điện thoại tin cậy hoặc LAN đúng.                                                                                                               |
| `Diagnose-MobileApi.cjs` dùng CA `root-ca.cer` hiện có                     | FAIL: `DEPTH_ZERO_SELF_SIGNED_CERT`                                           | CA riêng không khớp chứng chỉ API đang chạy. Đây là kết quả khác với kiểm tra trust store Windows, không kết luận backend down.                                                                 |

Probe đầu dùng curl với CA riêng cũng thất bại do chain không tin cậy. Một số probe chẩn đoán HTTP qua HTTPS đã tạm bỏ xác minh chứng chỉ trong tiến trình test local để phân biệt dịch vụ và TLS; các probe đó không được dùng làm bằng chứng TLS hợp lệ. Kết luận trust store Windows ở bảng trên đến từ một lệnh riêng không bỏ xác minh.

### 5.2 Dữ liệu và tiến trình hiện tại

Đã truy vấn trực tiếp PostgreSQL local, database `bhome`, phiên bản **18.6**. Đây là môi trường máy hiện tại; thiết kế Report 4 nêu PostgreSQL 16. Cần xác nhận phiên bản môi trường chung, không tự hạ/nâng phiên bản chỉ để khớp báo cáo.

| Nhóm dữ liệu                                         | Số bản ghi đang có |
| ---------------------------------------------------- | -----------------: |
| User / Role                                          |              3 / 3 |
| User theo role Owner / Staff / Tenant                |          1 / 1 / 1 |
| Tài khoản đang bị khóa                               |                  0 |
| Location / RoomType / Room / Resident                |      0 / 0 / 0 / 0 |
| Contract / ContractHandover                          |              0 / 0 |
| MeterReading / OperationalTask                       |              0 / 0 |
| Invoice / PaymentTransfer / InvoiceAdjustmentRequest |          0 / 0 / 0 |
| BillingAutomationPlan / UserNotification             |              0 / 0 |

API đang nghe ở 5240/7240; PostgreSQL ở 5432. Tại lúc kiểm tra không có listener tại bộ cổng demo 5517/5581, API demo 5540/7540, PostgreSQL demo 56432 hoặc MinIO 59000. Docker CLI báo không kết nối được Docker Desktop Linux engine. Vì vậy không chạy lại bộ integration Docker hay browser smoke của môi trường demo riêng.

Mobile `.env.local` còn trỏ `https://10.33.59.31:7240`, trong khi Wi-Fi máy hiện tại là `192.168.0.106`. Launcher có logic chọn host nhưng cần kiểm tra URL thực dùng trên thiết bị. Chưa chạy Metro hoặc thao tác trên điện thoại trong audit này. Owner Web chưa có `.env.local`; khi không đặt `VITE_API_MODE=api`, cấu hình code mặc định vào mock.

Một số guide của lượt trước ghi nhận đã có dữ liệu test, nhưng số lượng trong bảng trên là kết quả truy vấn cluster hiện tại. Chưa xác định nguyên nhân chênh lệch; không suy ra dữ liệu cũ vẫn còn. API đang chạy cũng chưa công bố build SHA để đối chiếu trực tiếp với HEAD; cần build và khởi động đúng binary cho buổi demo.

### 5.3 Những việc chưa thực thi hoặc chưa có bằng chứng mới

- **NOT RUN:** integration Testcontainers PostgreSQL/MinIO, replay browser Contract/Invoice/Payment/Adjustment/Lifecycle/Automation trên HEAD hiện tại.
- **NOT RUN:** native iOS/Android, camera/permission/upload failure trên thiết bị, mở PDF thực tế trên điện thoại và kiểm tra push.
- **NOT RUN:** MySign thật, giao dịch hoặc webhook ngân hàng thật, gửi email/push thật.
- **NOT RUN:** formal ST/AT, coverage, load/performance, security scan và backup/restore rehearsal của môi trường nghiệm thu.
- **CHƯA XÁC NHẬN:** trạng thái Jira, giờ thực hiện, phần trăm hoàn thành backlog, reviewer và kết quả CI live trên GitHub.

Không dùng 889 tests đạt để tuyên bố đạt coverage ≥70%, ST/AT ≥95%, p95 ≤2 giây, 100 concurrent sessions hoặc không còn lỗi Critical/Major.

## 6 Kịch bản demo với giảng viên

### 6.1 Điều kiện trước khi demo

1. Dùng môi trường **Development/Testing riêng** với database `bhome_contract_demo`, bucket `contract-demo` và dữ liệu tổng hợp. Không dùng database `bhome` trống hiện tại để giả định các fixture đã có.
2. Khởi động được Docker Linux engine, PostgreSQL/MinIO và converter cần cho luồng PDF mới. Kiểm tra API, certificate và CORS phù hợp với client chạy demo.
3. Chọn đúng API mode cho Owner Web, đúng URL HTTPS cho Mobile; mở thẳng `/contracts`, `/invoices`, `/payments`, `/invoice-adjustments` hoặc `/billing-automation`. `/dashboard` hiện vẫn dùng portal demo, không chọn làm điểm chứng minh báo cáo tài chính thật.
4. Dùng đúng tài khoản của database demo. Owner/Staff/Tenant development của `bhome` không tự có trong `bhome_contract_demo`, và ngược lại.
5. Kiểm tra manifest của từng bộ fixture, ngày nghiệp vụ và trạng thái đã chạy. Một số seed/replay dừng khi khác ngày để bảo vệ lịch sử. Không xóa volume, sửa Status trực tiếp hoặc reset tiền chỉ để làm lại demo.
6. Chạy thử trước và lưu ảnh/kết quả/log an toàn. Nếu môi trường chưa đạt, chỉ trình bày code/test và artifact cũ có ghi ngày; không nói đó là demo live vừa thực hiện.

**Tài khoản demo riêng:** `owner.contract.demo@example.invalid`, `staff.contract.demo@example.invalid`, `tenant1.contract.demo@example.invalid` đến `tenant3.contract.demo@example.invalid`. Mật khẩu lấy local từ `BHOME_DEV_TEST_PASSWORD` trong `.tools/contract-demo/runtime.json`; báo cáo không chứa mật khẩu, token hoặc cấu hình kết nối.

### 6.2 Nội dung trình diễn đề xuất trong khoảng 20 đến 25 phút

Thời lượng dưới đây là đề xuất trình bày. Các bộ script tạo những fixture chuyên biệt; chưa xác minh một buổi chạy liên tục toàn bộ bằng một Contract duy nhất. Khi chuyển fixture phải nói rõ cho giảng viên.

| Phần                   | Thao tác và vai trò                                                                                             | Kết quả cần chứng minh                                                                                                 | Giới hạn phải nói rõ                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 Môi trường và quyền  | Mở health/Swagger; đăng nhập đúng role; minh họa request không token                                            | Backend hoạt động, API bảo vệ truy cập; role lấy từ server                                                             | Một test 401 không chứng minh toàn bộ bảo mật đã nghiệm thu.                                                            |
| 2 Lập hợp đồng         | Owner/Staff mở preparation và Draft; xem preview; với fixture cũ dùng hai tài khoản signer rồi Owner activation | Lưu Draft không chiếm phòng; activation đi qua readiness và quyền Owner                                                | Phân biệt Main Draft mới của Long với luồng ký Development cũ; ký Simulated, không có hiệu lực pháp lý được chứng minh. |
| 3 Bàn giao             | Staff lập biên bản; Tenant xác nhận hoặc dispute; Staff hoàn tất đúng version                                   | Snapshot tài sản/chỉ số và lịch sử; sửa version phải xác nhận lại                                                      | Camera native chưa được chứng minh bằng Mobile Web.                                                                     |
| 4 Ghi số và hóa đơn    | Staff mở task, nhập/xác nhận số; Owner xem Draft thiếu input rồi Final khi đủ; Tenant mở hóa đơn                | OCR không tự quyết số; thiếu dữ liệu không phát hành; Tenant chỉ xem đúng entitlement                                  | Không demo thay meter hoặc estimate consumption như nhánh đã hoàn tất.                                                  |
| 5 Thanh toán và nợ     | Tenant xem QR; Owner nhập/xem statement synthetic và đối soát đúng reference/amount; refresh Tenant A/B/C       | Trước xác minh vẫn chưa Paid; xác minh một lần mới giảm dư nợ; replay không double-credit                              | Đây là manual reconciliation với dữ liệu tổng hợp, không phải callback ngân hàng thật.                                  |
| 6 Điều chỉnh           | Tenant gửi yêu cầu; Owner approve/reject; so sánh original/effective amount                                     | Final gốc giữ nguyên, adjustment riêng; quyền evidence đúng; tiền thừa giữ review                                      | Chưa có hoàn tiền/credit tự động theo chính sách chưa duyệt.                                                            |
| 7 Trả phòng            | Tenant yêu cầu; Owner phân công; Staff inspection; Owner đọc settlement blockers                                | Có nợ/cọc chưa xử lý thì Pending; một Tenant rời thì người còn lại vẫn Occupied; nhánh cuối đủ điều kiện mới Available | Chỉ nhánh zero-deposit và nghĩa vụ resolved mới đủ demo đóng; không tuyên bố đã giải quyết mọi quyết toán.              |
| 8 Tự động và thông báo | Owner mở lịch/monitor/inbox; chạy lại job/đọc trạng thái có sẵn; Staff/Tenant mở thông báo                      | Không trùng task/invoice/inbox; missing input có lý do; read/unread lưu được                                           | Push/email provider có thể Unconfigured; inbox hoạt động không có nghĩa notification đã gửi ra ngoài.                   |

**Fixture có tài liệu từ lượt trước:** `AUTO101-SHARED` minh họa Final gốc 3.117.500 VND và ba Tenant; `AUTO102` thiếu input giữ Draft. Nhóm Lifecycle có `LC103-SHARED` giữ phòng Occupied khi còn người ở, `LC104-PENDING` có blocker và `LC105-LAST` là nhánh cuối đủ điều kiện. Các con số/trạng thái này là của fixture đã ghi trong guide ngày 01–02/11, không phải số liệu thu được từ database `bhome` hiện tại.

### 6.3 Các script đã có để chuẩn bị và kiểm tra

Chạy từ root repo bằng PowerShell. Đây là hướng dẫn cho lần chuẩn bị demo tiếp theo; các lệnh seed dưới đây **chưa được chạy trong audit báo cáo này**.

```powershell
# Chỉ thực hiện sau khi Docker Linux engine đã hoạt động.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1

# Build output riêng cho demo có scheduler/worker.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '. ./scripts/Use-LocalTools.ps1; . ./scripts/ContractDemoEnvironment.ps1; $null = Import-ContractDemoEnvironment; dotnet build tools/BHome.LocalDevelopment --artifacts-path .tools/jobs-build; dotnet build src/backend/BHome.Api --artifacts-path .tools/jobs-run'
```

Với Billing Automation, dùng quy trình setup có pause worker trong `BILLING_AUTOMATION_NOTIFICATION_GUIDE.md` mục 8 trước khi mở chạy thường. Không rút gọn việc tạo precondition retry hoặc tự chỉnh ngày hệ thống.

Mỗi lệnh server sau chạy ở một terminal riêng, sau khi setup tương ứng hoàn tất:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-BillingAutomationDemo.ps1 -Component Api
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-BillingAutomationDemo.ps1 -Component OwnerWeb
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-BillingAutomationDemo.ps1 -Component MobileWeb
```

Mặc định: API HTTP 5540 / HTTPS 7540; Owner Web 5517; Mobile Web 5581. Theo các guide, script kiểm chứng gồm:

| Phạm vi                     | Chuẩn bị qua API                                                                                       | Script kiểm chứng                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Main Contract và bàn giao   | `scripts/Seed-ContractDemoWorkflow.cjs`                                                                | `scripts/Test-ContractDemo.cjs`, `scripts/ContractDemoHandoverSmoke.cjs`             |
| Invoice                     | `scripts/Seed-InvoiceDemoWorkflow.cjs`                                                                 | `scripts/Test-InvoiceDemo.cjs`                                                       |
| Payment và debt             | `scripts/Seed-PaymentDemoWorkflow.cjs`                                                                 | `scripts/Test-PaymentDemo.cjs`                                                       |
| Adjustment                  | `scripts/Seed-AdjustmentDemoWorkflow.cjs`                                                              | `scripts/Test-AdjustmentDemo.cjs`                                                    |
| Renewal và move-out         | `scripts/Seed-ContractLifecycleDemoWorkflow.cjs`                                                       | `scripts/Test-ContractLifecycleDemo.cjs`                                             |
| Billing Automation và inbox | CLI `seed-billing-automation-demo`, sau đó `scripts/Seed-BillingAutomationDemoWorkflow.cjs` theo guide | `scripts/Test-BillingAutomationDemo.cjs`, `scripts/Test-BillingAutomationDemoDb.ps1` |

Script `.cjs` chạy bằng Node 22; các browser smoke cần Playwright/Chrome hoặc Edge như guide. Không đổi cổng của tiến trình khác hoặc chạy hai binary cũ/mới cùng claim queue. Mobile Web giữ session trong bộ nhớ; reload trang có thể kết thúc phiên, không nhầm hành vi này với mật khẩu sai.

## 7 Đánh giá trách nhiệm Team Leader

| Trách nhiệm của Quốc Huy    | Bằng chứng hiện có                                                                                                                | Phần cần bổ sung để báo cáo đầy đủ                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ưu tiên sản phẩm và phạm vi | Report 2 có RACI; repo có kế hoạch, traceability và các quyết định triển khai                                                     | Chốt backlog P0 hiện tại và scope được duyệt; không dùng lại danh sách “chưa làm” đã lỗi thời.                                                          |
| Backend và tích hợp         | Có nhiều commit feature/guide của Quốc Huy; Contract, Billing, Payment, Adjustment, Lifecycle, Jobs và Inbox đã có implementation | Tổ chức tích hợp trên môi trường chung; không dừng ở việc từng module tự chạy.                                                                          |
| Phân công                   | Phân biệt được Quốc Huy, Quang Huy, Long và các vai trò trong Report 2                                                            | Xác nhận người chịu trách nhiệm BH-25, UC-17, BF-07, Finance và Public Web trên board thực tế; tránh hai người cùng sửa migration/DTO mà chưa phối hợp. |
| Kiểm soát chất lượng        | Có test suite và workflow CI; kiểm tra local mới đã chạy                                                                          | Lấy CI/reviewer thật, giao Testing Lead thực hiện IT/ST/AT và tập hợp defect/evidence.                                                                  |
| Quản lý tài liệu            | Có Report 1–4 và nhiều guide kỹ thuật                                                                                             | Đồng bộ Report 2/3/4 với mô hình hóa đơn chung, Main Draft, Expo, notification và schema thực; xử lý `table_name3` còn trong Report 4.                  |
| Quản lý môi trường và demo  | Có initializer, seed, manifest, smoke scripts; có bản ghi sửa readiness                                                           | Phải chạy preflight trên đúng máy trước báo cáo; chỉ định người giữ môi trường demo và dự phòng dữ liệu tổng hợp.                                       |
| Theo dõi nhóm               | Có kế hoạch trong repo                                                                                                            | Chưa có bằng chứng Jira/burndown/daily/giờ thực hiện trong lượt kiểm tra; cần xuất board và biên bản phân công.                                         |

Khối lượng 126 giờ/tháng và ước lượng 196–276 giờ còn lại trong bản cũ thuộc các phạm vi và thời điểm khác nhau. Không dùng hai con số đó làm giờ đã thực hiện hoặc ước lượng còn lại hiện tại. Cần lập lại estimate theo backlog sau khi loại các phần đã triển khai và tách phần chờ quyết định/provider.

## 8 Việc cần làm tiếp theo và tiêu chí hoàn tất

Các mốc dưới đây là **đề xuất để nhóm chốt**, không phải deadline đã được các thành viên cam kết. Quốc Huy chịu trách nhiệm điều phối; tên người thực hiện từng nhánh phải được xác nhận trên board.

| Ưu tiên và mốc đề xuất             | Công việc cụ thể                                                                            | Người điều phối hoặc vai trò thực hiện                                    | Tiêu chí hoàn tất                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0 trước buổi báo cáo              | Khôi phục môi trường demo riêng, đúng host/CA/API mode; chuẩn bị fixture và tài khoản       | Quốc Huy cùng người phụ trách môi trường theo RACI là Thiên Huy           | PG/MinIO/converter cần thiết hoạt động; health và TLS đúng; client mở được dữ liệu thật; một lượt smoke được lưu bằng chứng.            |
| P0 trước buổi báo cáo              | Chốt một kịch bản chính và các nhánh bị chặn; tập dượt Owner/Staff/Tenant                   | Quốc Huy, Long và Testing Lead                                            | Có checklist bước, dữ liệu đầu vào, expected state và người thao tác; không chuyển sang mock mà không nói rõ.                           |
| P0 ngày 03/11                      | Chốt backlog mới, owner BH-25/UC-17/BF-07/Finance/Public Web và phụ thuộc chung             | Quốc Huy chốt với nhóm; Quang Huy cập nhật tracking/Scrum                 | Mỗi task có một owner, acceptance, dependency và thời hạn; không dùng phần trăm hoàn thành suy đoán.                                    |
| P0 ngày 03–04/11                   | Nối Property/Staff/Schedules/Tenant UI và xác định phạm vi bắt buộc                         | Frontend/Backend phụ trách; Quốc Huy điều phối                            | Màn hình MVP gọi API thật, lưu và đọc lại đúng; lỗi quyền/validation/empty state rõ ràng.                                               |
| P0 ngày 03–04/11                   | Chạy full integration trên Docker/staging và lấy kết quả CI/review                          | Quang Huy chủ trì chất lượng; Backend/DevOps hỗ trợ                       | Toàn bộ test bắt buộc chạy; có TRX/log và defect; không bỏ qua test Docker để tuyên bố integration hoàn tất.                            |
| P0 sau khi chốt policy             | Hoàn thiện Holding Contract và JOB-05                                                       | Backend owner cần xác nhận                                                | Chỉ On Hold sau ký và verified deposit; retry/cancel/expire không sai tiền hoặc occupancy; chuyển cọc Main có ledger và negative tests. |
| P0 sau khi có môi trường provider  | Ký MySign thật, bank provider/JOB-03, push/email                                            | Backend và chủ tích hợp provider                                          | Có specification, cấu hình bảo mật, sandbox được phép, failure/idempotency tests và bằng chứng provider; không dùng fake success.       |
| P0 sau khi có quyết định nghiệp vụ | Partial/excess, chia nghĩa vụ khi rời phòng, cọc/refund/credit và final utilities           | Quốc Huy xin quyết định; BA chuẩn hóa; Backend triển khai                 | Có quyết định ghi nhận, ledger đối chiếu được và test payment–adjustment–settlement đồng thời.                                          |
| P1 sau các blocker tích hợp        | Incident/Work Order, Finance/What-if và Public Website theo phạm vi đã chốt                 | Thành viên được phân công                                                 | Từng lát cắt có UI/API/data và acceptance; Guest site chỉ thông tin công khai được duyệt. Không tự giảm phạm vi SRS.                    |
| P0 trước nghiệm thu milestone      | ST/AT, thiết bị thật, security/performance, backup/restore; cập nhật Report 5 và user guide | Quang Huy điều phối kiểm thử; Quốc Huy phối hợp UAT; Thiên Huy môi trường | Evidence có ngày/build/test case, số thực đo và defect; kiểm tra mục tiêu NFR thay vì chép target thành kết quả.                        |

Ưu tiên kỹ thuật tiếp theo sau khi có môi trường demo ổn định là Holding Contract, các nhánh provider và settlement còn chặn. Việc JOB-09/JOB-10/inbox đã triển khai không còn là đầu việc “chưa bắt đầu”; phần cần làm là integration, acceptance và các nhánh chưa bao phủ.

### Ba nội dung xin ý kiến giảng viên

1. Xác nhận thứ tự ưu tiên các workflow bắt buộc cho milestone tiếp theo và mức độ bằng chứng cần đạt: demo Development, provider sandbox hay đầy đủ nghiệm thu.
2. Cho ý kiến về cách ghi nhận các quyết định còn mở liên quan Holding, nghĩa vụ phòng chung, khấu trừ/hoàn cọc, partial/excess và nhắc nợ; nhóm sẽ cập nhật thành quyết định có truy vết trước khi triển khai nhánh tranh chấp.
3. Thống nhất đầu ra tích hợp và kiểm thử: một môi trường chung, một người phụ trách mỗi task, lịch kiểm tra lại với Testing Lead và bộ evidence dùng để đánh giá Done.

## 9 Nội dung trình bày ngắn trong cuộc họp

“Từ đợt audit đầu ngày 01/11 đến hiện tại, em đã bổ sung backend và các luồng giao diện cho hóa đơn, thanh toán, điều chỉnh hóa đơn, gia hạn–trả phòng và tự động hóa hóa đơn/thông báo. Vì vậy các phần này đã vượt giai đoạn chỉ có giao diện mẫu. Kiểm tra mới đạt 889 tests và 75 assertions môi trường Mobile; build và các kiểm tra static đã đạt.

Tuy nhiên em chưa báo cáo toàn bộ hệ thống Done. Holding Contract, các nhánh cọc/hoàn tiền và tích hợp provider thật còn thiếu; một số trang quản trị và website công khai chưa tích hợp đầy đủ. Môi trường local hiện chưa có dữ liệu nghiệp vụ để demo ngay, nên nhóm cần chuẩn bị lại môi trường demo riêng và chạy thử trước.

Em sẽ trình diễn các luồng đã có bằng dữ liệu tổng hợp, phân biệt rõ ký mô phỏng, đối soát thủ công và phần còn Pending. Sau buổi này em cần cùng nhóm chốt owner, backlog ưu tiên và tiêu chí nghiệm thu; Testing Lead sẽ phối hợp chạy full integration, ST/AT và kiểm tra thiết bị thật.”

## 10 Phụ lục bằng chứng và nguồn đối chiếu

### 10.1 Các nguồn trong repo

| Mã  | Nguồn                                                                                                                                                                                                                                         | Nội dung được dùng                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| E01 | `docs/reports/BHOME_Report-2_Project_Management_Plan (3).docx`                                                                                                                                                                                | RACI, phân biệt Leader/PO proxy và Scrum Master/Testing Lead, quality gates.                               |
| E02 | `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx` và Report 1/4 cùng thư mục                                                                                                                                          | BF/UC/GBR/DBR/JOB/NFR, phạm vi, design baseline và điểm cần đồng bộ.                                       |
| E03 | `HUY_SOURCE_CODE_AUDIT.md`, `HUY_IMPLEMENTATION_PLAN.md`                                                                                                                                                                                      | Baseline audit 01/11 tại HEAD `9c68c89`; dùng để so sánh lịch sử, không dùng làm trạng thái mới.           |
| E04 | `docs/development/BH21_TRACEABILITY.md`, `BH25_TRACEABILITY.md`, `BH40_TRACEABILITY.md`, `BH41_TRACEABILITY.md`, `JOBS_TRACEABILITY.md`                                                                                                       | Quyết định triển khai, ranh giới policy và mapping acceptance.                                             |
| E05 | `CONTRACT_MANAGEMENT_WORKFLOW.md`, `BILLING_WORKFLOW_GUIDE.md`, `PAYMENT_WORKFLOW_GUIDE.md`, `INVOICE_ADJUSTMENT_WORKFLOW_GUIDE.md`, `CONTRACT_RENEWAL_MOVEOUT_GUIDE.md`, `BILLING_AUTOMATION_NOTIFICATION_GUIDE.md` trong `docs/development` | Phạm vi triển khai, fixture, cách chạy demo, kết quả developer của các lượt trước.                         |
| E06 | `docs/development/MAIN_TENANCY_DRAFT.md`, `DIGITAL_SIGNING_COMPLETION.md`, `MOBILE_READINESS_EXPIRY_FIX.md`                                                                                                                                   | Luồng Draft mới, giới hạn ký thật và các lần sửa môi trường. Đọc theo thứ tự thời gian cùng code hiện tại. |
| E07 | `src/backend/BHome.Application`, `BHome.Infrastructure`, `BHome.Api/Controllers`; client tương ứng                                                                                                                                            | Xác nhận implementation thực có, không chỉ dựa tên file báo cáo.                                           |
| E08 | `src/owner-web/src/app/PortalProvider.tsx`, các page Property/Staff/Schedules/Reports/What-if; `src/public-web/src/App.tsx`                                                                                                                   | Xác nhận ranh giới demo, API mode và Public Website còn scaffold.                                          |
| E09 | Lịch sử Git local tại `da4aec2`, gồm `133642a`, `3983fc7`, `65a8c33`, `86a3c81`, `eaaeb38`, `acc19bd`                                                                                                                                         | Mốc công việc, attribution Quốc Huy/Long; không thay bằng chứng peer review/CI live.                       |

### 10.2 Artifact kiểm tra mới

Artifact audit được lưu local tại `.tools/progress-audit-20261102/`, được Git ignore. Chúng có trên máy kiểm tra, không tự được gửi kèm khi push báo cáo hoặc chia sẻ repo. Khi gửi giảng viên cần chọn và xuất log an toàn cần thiết.

- `backend-tests.log` và `test-results/*.trx`: 83 Domain, 177 Application, 181 non-Docker IntegrationTests.
- `signing-tests.log`: 41 Digital Signing tests.
- `frontend-tests.log`: 97 Owner, 310 Mobile.
- `frontend-build.log`, `frontend-lint.log`, `mobile-typecheck.log`, `format-check-before-report.log`, `format-check-final.log`.
- `mobile-development-tests.log`: 75 assertions.
- `live-db.log`, `migration-status.json`, `extra-migrations.json`: số lượng bản ghi, migration và dấu vết legacy đã hỗ trợ.
- `live-api.log`: probe với CA riêng bị lỗi; không sửa kết quả thất bại thành pass. `live-api-os-trust.log` ghi lượt kiểm tra riêng với trust store Windows, không bỏ xác minh TLS: live/ready 200 và Contracts vô danh 401.
- `evidence-summary.json`: tổng hợp số test từ TRX và log Vitest, xác nhận tổng 889; `report-layout-check.json` ghi kiểm tra bản HTML ở desktop và Mobile.

Các JSON/screenshot demo cũ còn trong `.tools/contract-demo/`, gồm Invoice, Payment, Adjustment, Lifecycle và Automation. Đây là evidence developer trước lượt audit; cần ghi rõ ngày và fixture khi sử dụng, không thay thế buổi demo live hoặc biên bản nghiệm thu.

**Giới hạn báo cáo:** đánh giá này xác nhận phạm vi đã kiểm tra và kết quả lệnh thực chạy. Không xác nhận tiến độ Jira, giờ công, tỷ lệ toàn dự án, provider production hoặc kết quả nghiệm thu chưa được thực hiện.
