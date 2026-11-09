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

SRS DBR-06 ghi uniqueness theo Contract + period, request và backend hiện tại dùng Room + period. Không sửa chính sách/schema này trong việc cải thiện UI. Các quyết định JOB-08, chính sách tài chính OQ, tài liệu ký production và provider chưa cấu hình không được tự bổ sung. Test component dùng dữ liệu tổng hợp, không phải bằng chứng E2E với provider thật.

## Thực thi

Node hệ thống là 24; dùng Node 22.23.4 có sẵn trong `.tools`, đúng major CI. PowerShell chặn npm.ps1 nên gọi npm.cmd. CI chạy khi PR cập nhật hoặc workflow_dispatch; không có trigger push chung. GitHub REST đọc được, Git remote đọc được; CLI gh chưa cài. Mỗi phase sẽ ghi kết quả thực thi, commit, push và CI bên dưới.

### Phase 0 — Shared UX

Đã thay bộ chọn tìm kiếm + select + phân trang bằng autocomplete có tìm kiếm server, tải trang tiếp khi cuộn hoặc dùng bàn phím, giữ nhãn mục đã chọn và retry. Room chỉ tải sau khi chọn Location; query được scope theo tài khoản Owner. Bổ sung FilterToolbar, trạng thái bảng loading/error/empty có phân biệt, tên truy cập cho bảng/dialog/pagination, focus và skip-link, cải thiện độ tương phản và khoảng cách chung. Không thay business API/schema hoặc quyền backend.

Đã chạy: kiểm tra dependency Owner không có missing/invalid; typecheck PASS; root ESLint PASS; root production build PASS (API URL placeholder chỉ để build); toàn bộ Owner regression lúc đầu 264/264 PASS, sau khi thêm test trạng thái bảng và chỉnh khóa option chạy lại 12/12 test ảnh hưởng PASS. Prettier Owner và báo cáo này PASS; git diff --check PASS. Còn warning có sẵn trong fixture ký số, select ở workspace và duplicate key PublicContent/What-if; không coi chúng là bằng chứng runtime. Backend và browser E2E chưa chạy ở phase này vì không thay backend.
