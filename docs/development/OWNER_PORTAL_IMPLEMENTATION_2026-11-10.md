# Hoàn thiện Owner Portal — 10/11/2026

Baseline `9a9ba18`, nhánh `member/QHuy`. Tệp audit chưa được theo dõi của người dùng được giữ nguyên. Nhánh local đang chứa 12 commit đã tích hợp so với remote; không reset hoặc sửa lịch sử.

## Đối chiếu trước triển khai

Đã đọc AGENTS.md, quy tắc Owner Web, router, shared UI, service/hooks, các component test, API conventions và workflow CI. Báo cáo gốc Report 1–4 có trong `docs/reports`; SRS ghi Version 1.3. Audit ngày 09/11 là thông tin lịch sử, không thay thế source hiện tại. Owner Web thực tế ở `src/owner-web`.

| Phase / trang           | Hiện có và API liên quan                                                     | Công việc và kiểm chứng dự kiến                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 0 / dùng chung          | MUI, PortalUI, OwnerWorkspace, OwnerSelectors; locations/rooms có phân trang | Bộ lọc gọn, lựa chọn tìm kiếm, trạng thái tải/lỗi, bảng và xác nhận truy cập được bằng bàn phím; component và route regression |
| 1 / tenants             | Residents list/detail/workspace-label, account linkage, co-occupants         | Giữ DTO tối thiểu, cải thiện chọn cơ sở/phòng và điều hướng; test lỗi/quyền/liên kết                                           |
| 1 / contracts           | Holding/Main draft, signing, deposit, activation, lifecycle, addendum        | Tách cấu hình khỏi danh sách, giữ readiness phía server và điều hướng hồ sơ                                                    |
| 1 / digital-signing     | MySign settings/certificate/signature image; ký tại Contract                 | Tách tác nghiệp ký khỏi cấu hình tích hợp; không trả thêm secret                                                               |
| 1 / handovers           | ContractHandoverPanel, occupancy-history                                     | Chọn hồ sơ qua phòng, hỗ trợ liên kết từ hợp đồng; giữ quyền Staff/Tenant xác nhận                                             |
| 1 / temporary-residence | Residence list/record/evidence/Owner decision                                | Bộ lọc gọn và điều hướng; không thêm quyền Staff/VNeID                                                                         |
| 2 / meters              | Capture task/detail/reading/evidence, meter assignment                       | Theo dõi xác nhận và điều hướng tác vụ; không tự xác nhận OCR                                                                  |
| 2 / invoices            | Draft/list/detail/finalize, payment panel                                    | Danh sách trước, tạo nháp qua dialog; giữ dữ liệu thiếu ở Draft                                                                |
| 2 / billing-automation  | History/preview/execution/attempt/calendar/queue                             | Tách cấu hình, theo dõi lỗi và đầu vào thiếu                                                                                   |
| 2 / invoice-adjustments | List/detail/financials/decision/evidence                                     | Giữ xác nhận Owner, điều hướng hóa đơn và hiển thị snapshot                                                                    |
| 3 / payments            | Invoice balances, transfers/reconcile, verified history, receiving account   | Tách tác nghiệp và cấu hình, trạng thái xác minh theo backend                                                                  |
| 3 / debts               | Đang dùng PaymentManagementPage với debtOnly                                 | Giao diện tập trung công nợ; không cộng tổng từ một trang rồi gọi là toàn hệ thống                                             |
| 4 / incidents           | IncidentWorkspace, review/classify/assign/direct close/history               | Ưu tiên khẩn cấp, điều hướng Work Order và lỗi/retry                                                                           |
| 4 / maintenance         | Work order plan/approval/progress/evidence/verify/rework/cost                | Giữ workflow server và lịch sử; kiểm tra negative/rework                                                                       |
| 5 / expenses            | Investment/OPEX, edit/evidence/history và lookup work item                   | Bộ lọc và liên kết nghiệp vụ; giữ decimal phía server                                                                          |
| 5 / reports             | Financial report/occupancy/payback/export                                    | Lựa chọn phòng thay nhập ID, phân biệt số thu/hóa đơn/nợ và ước tính                                                           |
| 5 / what-if             | Baseline/scenario/save/compare                                               | Tách kết quả và giả định, bảo toàn dữ liệu thực                                                                                |
| 6 / notifications       | Inbox, announcement draft/preview/send, delivery/policy                      | Tách hộp thư và soạn; không diễn giải sandbox thành push/email thật                                                            |
| 6 / public-content      | Location/room content, image upload/preview/publish                          | Bộ chọn và phản hồi lỗi, giữ Guest chỉ đọc                                                                                     |

## Truy vết và giới hạn chính sách

- Phase 0: NFR usability/accessibility, GBR-02; shared UI và hooks → tìm kiếm/phân trang, lỗi so với rỗng, bàn phím, chống xác nhận lặp.
- Phase 1: BF-03/04, UC-13..19, GBR-03..07/13, DBR-02..04 → Contract/Resident/Residence/Handover; kiểm tra liên kết, pending/error, không mở rộng quyền hoặc ký nội bộ.
- Phase 2: BF-05, UC-20/21/24, GBR-07..09/18, DBR-06/07, JOB-09/10 → UI billing; finalization và uniqueness tiếp tục do backend thực thi.
- Phase 3: BF-06, UC-22..25, GBR-10/13/18 → Payment/Debt; xác minh/phân bổ và số dư từ server.
- Phase 4: BF-07, UC-26..30, GBR-11/12/13 → Incident/WorkOrder; approval, rework, evidence và lỗi state.
- Phase 5: FE-08, GBR-15/16 → expense/report/scenario; baseline và actual tách biệt.
- Phase 6: FE-07/09, UC-31..38, GBR-14/17, JOB-04 → inbox/announcement/public content; scoped lookup, lỗi, preview, không Guest capture.

SRS DBR-06 ghi uniqueness theo Contract + period. Đã tìm thấy quyết định Room + tháng ghi trong `docs/development/BH21_TRACEABILITY.md` ngày 01/11/2026, phù hợp yêu cầu hiện tại; giữ chính sách/schema hiện có. Các quyết định JOB-08, chính sách tài chính OQ, tài liệu ký production và provider chưa cấu hình không được tự bổ sung. Test component dùng dữ liệu tổng hợp, không phải bằng chứng E2E với provider thật.

## Thực thi

Node hệ thống là 24; dùng Node 22.23.4 có sẵn trong `.tools`, đúng major CI. PowerShell chặn npm.ps1 nên gọi npm.cmd. CI chạy khi PR cập nhật hoặc workflow_dispatch; không có trigger push chung. GitHub REST đọc được, Git remote đọc được; CLI gh chưa cài. Mỗi phase sẽ ghi kết quả thực thi, commit, push và CI bên dưới.

### Phase 0 — Shared UX

Đã thay bộ chọn tìm kiếm + select + phân trang bằng autocomplete có tìm kiếm server, tải trang tiếp khi cuộn hoặc dùng bàn phím, giữ nhãn mục đã chọn và retry. Room chỉ tải sau khi chọn Location; query được scope theo tài khoản Owner. Bổ sung FilterToolbar, trạng thái bảng loading/error/empty có phân biệt, tên truy cập cho bảng/dialog/pagination, focus và skip-link, cải thiện độ tương phản và khoảng cách chung. Không thay business API/schema hoặc quyền backend.

Đã chạy: kiểm tra dependency Owner không có missing/invalid; typecheck PASS; root ESLint PASS; root production build PASS (API URL placeholder chỉ để build); toàn bộ Owner regression lúc đầu 264/264 PASS, sau khi thêm test trạng thái bảng và chỉnh khóa option chạy lại 12/12 test ảnh hưởng PASS. Prettier Owner và báo cáo này PASS; git diff --check PASS. Còn warning có sẵn trong fixture ký số, select ở workspace và duplicate key PublicContent/What-if; không coi chúng là bằng chứng runtime. Backend và browser E2E chưa chạy ở phase này vì không thay backend.

Commit Phase 0: `fb7666d`, push thành công. [CI 42662375970](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42662375970) PASS frontend/backend sau khi chạy lại job backend: lần đầu tải Go dependency từ proxy.golang.org lỗi HTTP/2 INTERNAL_ERROR khi build MinIO, không thay code/gate để xử lý lỗi mạng. Root npm test trên snapshot cuối PASS Owner 265/265, Mobile 854/854; Compose config PASS. Chrome headless với API fixture tổng hợp: 18/18 route render, không pageerror; đã xem ảnh desktop 1440 và mobile 390. Đây là kiểm tra layout/client, không phải E2E thật. Log/ảnh ở `.tools/owner-portal-20261110` (không commit).

### Phase 1 — Tenant và hợp đồng

Đưa danh sách ký đang chờ lên trang Digital Signing, giữ tiến độ/evidence/actions trong ContractDetailPanel hiện có; tách cấu hình MySign vào tab Owner. Cấu hình mẫu/quy trình hợp đồng chuyển vào dialog. Bộ lọc Tenant và residence dùng toolbar. Bàn giao nhận contractId từ liên kết, chọn theo lịch sử phòng, không yêu cầu nhập UUID; liên kết hai chiều tới hợp đồng và kiểm tra trả phòng. Tenant list phân biệt lỗi/tải/rỗng và hỗ trợ residentId khi mở trực tiếp. Không thay activation/deposit/signing/residence policy hoặc quyền Staff.

Validation local: typecheck, root ESLint và root production build PASS; regression contracts/tenants/residence/router 86/86 PASS. Sau thay đổi cuối chạy thêm signing/handover/tenant 6/6 PASS, gồm đọc lỗi/retry, cấu hình không có ở tab tác nghiệp và mở bàn giao từ liên kết. Prettier và diff check PASS. Production MySign/VNeID/bank không được thực hiện; không có thay đổi backend.

Commit Phase 1 `77f4503`, push thành công; [CI 42665108498](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42665108498) PASS frontend/backend. Chrome fixture 18/18 route PASS, không pageerror.

### Phase 2 — Meter và hóa đơn

GET invoices bổ sung Location/kỳ/trạng thái, giữ response, authorization và tham số cũ. Service kiểm tra bộ lọc, repository lọc sau scope và trước count/page; không đổi tiền/schema/uniqueness. Web dùng bộ lọc server này và chuyển lập nháp vào dialog hai bước; chọn hợp đồng bằng tên/ngày từ occupancy-history thay UUID/100 kết quả đầu. Meter tasks có bảng theo phòng/loại/kỳ/baseline/trạng thái/phân công, giữ panel bằng chứng và Staff xác nhận. Lịch automation tách cấu hình ra dialog, chọn đại diện bằng lịch sử phòng. Adjustment dùng toolbar gọn. Sửa kích thước con của FilterToolbar để TextField fullWidth không chiếm trọn hàng desktop.

Truy vết cụ thể: UC-21, GBR-02/09 → InvoicesController/InvoiceService/InvoiceRepository, shared invoice client và InvoicesPage → filter hợp lệ/không hợp lệ, scope Tenant/Staff/anonymous, count trước page và tương thích cũ. Không thêm endpoint, provider hoặc field response. Giữ workflow adjustment/finalization và OCR do backend xác nhận.

Đã chạy: .NET restore và build PASS (0 warning/error); regression Invoice legacy + Compact24 16/16 PASS, không SKIP, trên database tạm. Lượt chạy filter đầu có 1 PASS/1 FAIL khi PostgreSQL vừa khởi động (lỗi kết nối stream); sau pg_isready chạy lại Compact24 PASS rồi toàn regression PASS. Không sửa database làm việc. Owner và Mobile typecheck PASS; root ESLint/build PASS; frontend billing/meter/adjustment 24/24 PASS, wizard 6/6 PASS. Lượt format .NET đầu phát hiện xuống dòng attribute tại controller; đã sửa, verify-no-changes cho các file backend thay đổi PASS. Prettier và git diff --check PASS. Chrome API fixture render 18/18 không pageerror; đã xem ảnh toolbar desktop sau sửa kích thước. API contract cập nhật tại `docs/api/INVOICES.md`; Postman skill hướng dẫn việc chọn contract và bằng chứng, assertion nghiệp vụ thực thi bằng xUnit/HTTP và PostgreSQL hiện có. `postman status` chạy thành công: CLI 1.80.0, chưa init/bind hoặc đăng nhập workspace; không cần tạo tài khoản/workspace hay cập nhật skill để thực hiện các test local này. Không publish artifact ra Postman.

Commit Phase 2 `ebbb92e`, push thành công; [CI 42668161384](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42668161384) PASS frontend/backend.

### Phase 3 — Thanh toán và công nợ

Payment workspace chia tab hóa đơn/số dư, đối soát, lịch sử xác minh và tài khoản nhận tiền. Transfer query dùng bộ lọc Location/Room/kỳ/trạng thái backend đã có. Đối soát mở dialog chọn hóa đơn còn dư nợ theo tên phòng/kỳ và phân trang; không yêu cầu UUID. Hiển thị ngày giao dịch, nguồn, nội dung và tham chiếu sao kê thực tế. Giữ human review, confirmation, idempotency và lịch sử của backend.

Debt view có bảng dư nợ/ngày đến hạn/quá hạn, lịch sử thu tiền độc lập và KPI từ GET `/api/v1/debts/summary`. Endpoint mới theo UC-23/BF-06/GBR-02/10, policy finance.view chỉ Owner và service Owner; cùng projection và bộ lọc của debt list trước pagination. Response được mô tả trong `PAYMENTS.md`: outstandingAmount/overdueAmount decimal strings và hai count. Chỉ đọc, không schema/state transition, không thêm công thức phân bổ. Các mutation allocation/adjustment invalidate summary. Snapshot route inventory cũ được đánh dấu delta, không sửa số liệu bằng chứng cũ.

Validation: frontend payment + adjustment/shared table 26/26 PASS; backend summary/debt/reconciliation/partial/overpayment 6/6 PASS, không SKIP (legacy và Compact24 cô lập). Test tổng hợp có hai hóa đơn với pageSize=1, kiểm tra quyền Staff/Tenant/anonymous, số tiền quá hạn, empty/invalid filter và loại invoice đã tất toán. Test frontend kiểm tra số tiền lớn không mất chính xác, lỗi summary/retry, picker và refresh sau allocation. Các assertion đầu dùng format decimal quá chặt và mô tả UI cũ đã được sửa để kiểm tra decimal string theo giá trị, đúng tab và đợi dialog đóng; không bỏ kiểm tra tiền/quyền/refresh. .NET build, Owner/Mobile typecheck và root build PASS. Còn xác minh format/lint cuối trước commit. Chưa có API status nhắc nợ theo từng hóa đơn nên không suy diễn từ số ngày quá hạn; production bank ingestion và provider thật chưa được nghiệm thu.

Kiểm tra cuối Phase 3: root ESLint, Prettier, .NET verify-no-changes cho các file thay đổi và git diff --check PASS. Chrome fixture 18/18 route PASS, không pageerror. Chỉ test dữ liệu tổng hợp; chưa có bằng chứng chuyển khoản/provider thật.

Commit Phase 3 `5b41e18` đã push. Các lượt trước bị GitHub Internal server error trước khi tạo job; tiếp tục phiên sau, [CI 42732910964](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42732910964) PASS frontend/backend trên đúng commit, không đổi workflow hoặc gate.

### Phase 4 — Incident và bảo trì

Truy vết BF-07, UC-26..30, GBR-11/12/13 → IncidentWorkspace/IncidentCommandDialog và DTO GET đã có → lọc Emergency trên server, deep link Incident/WorkOrder, rework bắt buộc lý do, giữ version/idempotency và không mở thao tác Staff cho Owner. Toolbar gọn, bảng phân biệt tải/lỗi/rỗng, badge trạng thái, ngày báo cáo, duyệt plan và chi phí. Chi tiết giải tên cơ sở/phòng/Staff qua GET được phân quyền, liên kết phòng/sự cố/Work Order/chi phí; không thêm lookup cho mỗi hàng bảng. Hiển thị canStart từ backend; không tự tính điều kiện chuyển trạng thái.

API Incident dùng JSON number decimal tới 18 chữ số theo contract hiện có. Owner nay báo cần đối chiếu chứng từ khi số vượt khả năng biểu diễn chính xác của JavaScript, tương tự Mobile; không định dạng số bị làm tròn như số chính thức. Không đổi API/money policy. Reporter identity không có trong DTO đã duyệt (Tenant DTO chủ động loại identity/actor), nên không tự bổ sung PII hoặc suy diễn người báo cáo. Giữ history actor theo API Owner hiện có.

Đánh dấu trùng mở danh sách sự cố gốc theo mã/nội dung, lọc cùng Location/Room/Asset và loại chính nó hoặc trạng thái không phù hợp; không nhập UUID. Server vẫn quyết định hợp lệ khi ghi. Validation: 14/14 test Incident/Live API pages PASS, gồm rework thiếu lý do/nhấp lặp, lookup trùng, lọc Emergency và deep link. Owner typecheck, root lint/build, Prettier, diff check PASS; Chrome fixture 18/18 route render không pageerror. Một fixture test mới ban đầu trả array cho endpoint Location phân trang đã được sửa đúng response shape, không thay API hoặc bỏ assertion. Backend không đổi nên không chạy lại backend local ở phase này; CI sẽ kiểm toàn solution.

Commit Phase 4 `023d608`, push thành công; [CI 42734571043](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42734571043) PASS frontend/backend.

### Phase 5 — Chi phí, báo cáo và What-if

Truy vết FE-08, UC-31..34, GBR-15/16 → finance client/Expense/Report/Scenario → kiểm tra lọc theo scope, số âm, baseline không thay sổ thực tế. Chi phí có tab đầu tư/OPEX lọc server, toolbar tìm cơ sở, tạo theo loại đang chọn, liên kết Work Order và invalidate báo cáo sau khi lưu. Báo cáo chọn phòng theo tên qua GET capture hiện hữu, xóa phòng khi đổi cơ sở, chặn ngày ngược; KPI và biểu đồ chỉ trình bày tổng server. Chiều dài thanh dùng tỷ lệ BigInt giới hạn trước khi đổi Number; không cộng/tính lại chỉ tiêu tài chính trên UI. API chưa có subtotal maintenance riêng nên không tự dựng tổng này.

Sửa lỗi số âm hiển thị dấu gạch: formatter tài chính riêng giữ nguyên chuỗi decimal chính xác cho điều chỉnh, lợi nhuận, dòng tiền và What-if; không thay validation số tiền đầu vào. What-if tách dữ liệu thực tế trong kỳ nền và dự báo tháng, form giả định hai cột, tên cột so sánh rõ ràng và retry danh sách lỗi. Giữ snapshot server, khóa mutation và idempotency key khi kết quả chưa rõ. Không sửa backend/schema/công thức hoặc dữ liệu tài chính thực tế.

Validation đã chạy: 30/30 test chi phí/báo cáo/What-if/export PASS; root lint và root build PASS. Lệnh thử trực tiếp root TypeScript 5.9 với Owner tsconfig báo DOM Iterable ở test Meter có sẵn; dùng script typecheck của workspace với TypeScript 7 đúng cấu hình CI để kiểm lại. Browser fixture và kiểm tra cuối ghi tiếp bên dưới. Provider/E2E thực tế chưa chạy.

Kiểm tra cuối Phase 5: workspace Owner typecheck (TypeScript của dự án) PASS, Prettier và diff check PASS. Chrome fixture 18/18 route render không pageerror; đã thao tác tải báo cáo có số âm và xem ảnh desktop/mobile. Đây là kiểm tra client/layout bằng dữ liệu tổng hợp, không phải E2E backend/provider. Không có thay đổi backend ở phase này.

Commit Phase 5 `947e4d7`, push thành công; [CI 42736072916](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42736072916) PASS frontend/backend.

### Phase 6 — Thông báo, nội dung công khai và tích hợp

Truy vết FE-07/09, UC-35..38, GBR-02/14/17/18, JOB-04 → inbox/announcement/public content → recipient preview, nháp phục hồi, xác nhận gửi/xuất bản và lỗi truy cập. Hộp thư là tab mặc định; tab soạn chỉ Owner và giữ bản soạn/idempotency intent khi chuyển tab. Nhóm thông báo Owner hiển thị đủ enum backend, giữ danh mục Mobile hiện hành. Target Incident đi qua GET target được phân quyền rồi mở deep link. Bảng nháp/đã gửi phân biệt loading/error/empty, retry; phục hồi scope/priority từ nháp và gửi đúng persisted ID. Chọn tài khoản người nhận theo người ở/phòng/cơ sở, tìm kiếm/phân trang; chỉ chọn tenantUserId có liên kết, deduplicate theo tài khoản và giữ giới hạn 500 của backend. Preview và send vẫn resolve cư trú hiện tại ở server. Không đổi chính sách JOB-08 hoặc tuyên bố email/push thật đã phát.

Public content dùng toolbar, có hướng dẫn chọn scope, retry lỗi đọc và không mở editor từ dữ liệu đọc lỗi; giữ whitelist, duyệt ảnh, preview, lưu trước publish và confirmation. AppShell chỉ hiện tìm kiếm/global Location ở những nơi có tác dụng; dùng biểu tượng tài khoản thay chữ viết tắt giả. Guest vẫn chỉ đọc thông tin Owner duyệt; không form/đặt phòng/thanh toán.

Validation cục bộ ban đầu: 20/20 test notification/public-content/live pages PASS; typecheck, root lint/build và Compose config PASS. Test mới được sửa để đợi dialog đóng; không bỏ assertion. Full regression lần đầu Owner 296/296 PASS, Mobile 853/854 do việc mở rộng constant nhóm chung làm thay đổi menu Mobile. Đã tách danh mục mở rộng dành cho Owner, giữ contract Mobile và chạy lại toàn suite. Fixture browser đầu tiên nhận sai shape capture locations vì matcher quá rộng; đã sửa fixture theo đúng endpoint, không sửa production để né lỗi. Kết quả cuối ghi tiếp bên dưới.

Kiểm tra cuối trên source cố định: root npm test PASS Owner **297/297** (55 files), Mobile **854/854** (68 files); 21/21 test notification/public-content/live pages PASS trước full run. Một lượt giữa chừng bị trộn snapshot do source còn thay đổi nên đã loại và chạy lại toàn bộ; không bỏ test. Root Prettier check ban đầu còn một test file chưa format, đã format và chạy lại PASS. Owner workspace typecheck, root lint, production build toàn workspace, root format:check, Compose config và git diff --check PASS. Backend không đổi ở Phase 6; CI vẫn chạy backend solution đầy đủ.

Chrome headless trên source cuối, API fixture tổng hợp: **18/18 route ở desktop 1440 và mobile 390** (36 lượt), không pageerror, console error hoặc tràn ngang document. Đã thao tác chọn người nhận → preview → tạo nháp → xác nhận gửi; giữ bản soạn khi chuyển tab; nội dung công khai → xem trước → xác nhận xuất bản. Đã xem ảnh inbox mobile và public-content desktop. Đây là bằng chứng client/layout và request wiring với fixture, không phải E2E backend/provider thật. Log/JSON/ảnh nằm trong `.tools/owner-portal-20261110` không commit.

Các regression routeGuards/PortalSessionScope, contract/deposit/signing/handover, meter/invoice/finalization/adjustment, payment/debt, incident/rework, expense/report/scenario và notification/public whitelist đều nằm trong suite đã chạy. Backend tests thực tế các phase trước và CI kiểm tra server permissions/state; browser fixture không chứng minh quyền hoặc giao dịch thật. Không sửa schema, ledger, activation/payment success, What-if actual data hoặc policy đang tranh chấp.

Giới hạn bàn giao: production bank/signing/email/push và nghiệm thu E2E với provider chưa chạy; reporter identity không có trong DTO Incident, số tiền Incident vượt JS safe integer cần đối chiếu chứng từ; chưa có reminder status theo từng Invoice hoặc subtotal maintenance riêng trong report DTO. Không tự tạo dữ liệu/chỉ tiêu thay thế. Nội dung Guest vẫn read-only, JOB-08 và các OQ giữ nguyên. Tệp audit chưa theo dõi của người dùng được giữ nguyên và không đưa vào commit. Kết quả commit/push/CI Phase 6 được xác nhận trong phản hồi bàn giao sau khi workflow kết thúc; tài liệu này ghi bằng chứng local trước commit cuối.
