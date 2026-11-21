# Owner Mobile — triển khai và bằng chứng 13/11/2026

## Phạm vi và nguồn quyết định

Yêu cầu trực tiếp “Complete Owner Mobile Implementation & End-to-End Demo Integration” ngày 13/11/2026 cho phép bổ sung quyết định nhanh trên Mobile, thay giới hạn chỉ theo dõi trong BR-26 ngày 10/11. Quản trị phức tạp, thực chi hoàn tiền và cấu hình vẫn trên Owner Web. Không thay backend, Owner Web, màn hình Staff/Tenant hoặc policy tài chính.

Đã đối chiếu SRS hiện có trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, quy tắc AGENTS và quyết định `BHOME_NQH_BUSINESS_DECISIONS_2026-11-10.md`. BR-07 cho phép ký nội bộ; không mô tả OTP/vẽ là chữ ký số CA. BR-23 về physical release vẫn do backend quyết định; Mobile không tự suy điều kiện giải phóng phòng.

## Truy vết trước triển khai

| Yêu cầu                      | Nguồn                                     | Thành phần                                                          | Tiêu chí kiểm tra                                                          |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Dashboard, hồ sơ chờ duyệt   | BF-01/02/03/06/07, GBR-01/02              | OwnerOverviewScreen, OwnerApprovalQueue, navigation                 | Số đếm từ totalCount; chi tiết đúng ID; lỗi từng hàng; cache và phân quyền |
| Holding, email và xác nhận   | UC-14..16, GBR-04, BR-07/09               | OwnerHoldingSigning, ContractScreen, internalSigning client hiện có | Không xác nhận trước Tenant; không lộ token; chống bấm lặp; reload         |
| Main và trả phòng            | BF-04, UC-16/19, BR-20/23/24              | contractSections, Owner lifecycle review                            | Dùng version/idempotency; không bỏ blocker; không mở quyền Staff/Tenant    |
| Thanh toán, điều chỉnh       | UC-22..25, GBR-10/18, DBR-07, BR-16/17/18 | OwnerDecisionScreens, Owner financial actions                       | Version tài chính hiện tại; lý do và xác nhận; backend là nguồn trạng thái |
| Thông báo, vận hành, tạm trú | UC-09..12/18/26..30, GBR-06/11/12, JOB-04 | notificationInbox, Owner residence                                  | Điều hướng đúng đối tượng; Owner xác nhận; không nộp VNeID                 |

## Audit source ban đầu

| Chức năng                           | Trạng thái ban đầu | Bằng chứng source                                                                      |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| Dashboard cơ sở/phòng/hợp đồng      | PARTIAL            | ownerOverview dùng API scoped, chưa có hồ sơ quyết định, chưa dùng cache               |
| Approval center                     | PARTIAL            | Có 7 API đếm, chỉ mở danh sách chung, thiếu hồ sơ Draft                                |
| Holding tạo/duyệt/cọc/kích hoạt     | PARTIAL            | ContractDraftForm, ContractActionForm, HoldingDepositAllocation đã nối API và có tests |
| Email invitation/Owner confirmation | MISSING            | Có API và client internalSigning, Mobile chưa có panel Owner                           |
| Main/PDF/MySign                     | PARTIAL            | RentalContractFlow đã có API ký; mobileContractActions chặn Main Owner ngoài flow      |
| Gia hạn/trả phòng/quyết toán        | PARTIAL            | Có dữ liệu và blocker; Owner lifecycle chỉ đọc và Web notice                           |
| SePay/giao dịch                     | PARTIAL            | Đọc giao dịch thật; Owner payment review chỉ đọc                                       |
| Điều chỉnh hóa đơn                  | PARTIAL            | Có list/evidence; chưa gọi decide trên Mobile                                          |
| Finance tháng                       | COMPLETE           | FinancialReport từ backend, không tính ledger ở UI                                     |
| Incident/maintenance/emergency      | COMPLETE           | IncidentScreens/IncidentActions dùng API, kiểm trạng thái/version, tests hiện có       |
| Operational tasks                   | COMPLETE           | OwnerTaskList/OperationalTaskDetail có verify/rework và evidence                       |
| Notification inbox                  | PARTIAL            | Có read/unread, target API và cache; thiếu Owner Residence target                      |
| Owner residence                     | MISSING            | Chưa có Owner route/screen                                                             |
| Provider E2E                        | NOT RUN            | Cần môi trường tổng hợp và synthetic accounts; không coi component tests là E2E        |

OwnerScreens là màn hình preview được cách ly bởi `preview`; luồng đăng nhập thực dùng OwnerOverviewScreen/OwnerApprovalCenterScreen/OwnerOperationsScreen. Không đưa sampleApprovals vào luồng thật.

## Ghi chú hợp đồng API

Endpoint lời mời thực tế: `POST /api/v1/contracts/{id}/signing-invitations` (AnonymousContractSigningController). Không có endpoint root `/api/v1/signing-invitations` trong source. SMTP do backend thực hiện; trạng thái provider acceptance không chứng minh thư đã tới hộp thư. Backend hỗ trợ tạo lời mời thay thế/thu hồi, không có API retry-delivery riêng. Không lưu/hiển thị raw invitation token trên Owner Mobile.

## Thực thi và kết quả

Giai đoạn 1: `a0ef9bf` — dashboard cache theo session, 8 nhóm hồ sơ chờ duyệt có deep link từng ID. Lint, typecheck, format:check PASS; 98 files / 1.062 tests

Giai đoạn 2: thêm OwnerHoldingSigning bằng internalSigning client hiện có; chọn hạn lời mời theo giờ Việt Nam và giới hạn 24 giờ đúng backend; trạng thái email/OTP/thu hồi; Owner confirm chỉ sau tenantAcceptedAt + documentHash. Không lưu/hiển thị token, không đánh dấu signed khi gửi invitation. Bốn component tests kiểm tra role/method/approval, payload giờ Việt Nam, chống gửi lặp, refresh và provider failure.

InternalSigningStatus không trả recipient email. Giai đoạn 6 bổ sung email và trạng thái xác minh hiện tại qua metadata có quyền Owner `/residents/{id}` (không có raw OCR identity). Chỉ mở gửi lời mời khi hồ sơ đại diện đã Verified và có email; backend vẫn kiểm tra toàn bộ người ở. Email lịch sử theo từng invitation không có trong DTO, không suy từ email hiện tại. Gửi lại là tạo lời mời thay thế đúng endpoint hiện có; API không có retry SMTP riêng. Recipient signing và việc thư thực sự đến hộp thư chưa được kiểm tra E2E.

Giai đoạn 2: `99fad07`; lint, typecheck, format PASS; Mobile 94 files / 1.035 tests PASS; AnonymousSigningSecurityTests 11/11 PASS (unit, không phải SMTP/MySign E2E).

Giai đoạn 3: Owner Main dùng chi tiết/PDF/readiness và ContractActionForm hiện có; mở các thao tác theo contractActions (ký MySign, xác minh cọc, activate, gia hạn, duyệt/đặt lịch và hoàn tất bàn giao). Tái sử dụng MainDraftScreen/SigningReview cho hồ sơ đã có, không tạo quy trình nháp thứ hai. Owner có thể xác nhận/yêu cầu kiểm tra lại biên bản với inspection.version, ghi nhận xem xét quyết toán bằng summary.reference. Cấn trừ, khoản thu và thực chi hoàn tiền giữ Web handoff. Điều kiện giải phóng vật lý theo BR-23, do endpoint backend kiểm tra; không tự cập nhật phòng trong UI.

Giai đoạn 3: `7475501`; lint/typecheck/format PASS; Mobile 95 files / 1.041 tests PASS; toàn bộ Owner Web 78 files / 442 tests PASS, riêng contracts 15 files / 56 tests PASS. Client-core không có script test riêng; các test contracts/finance của Web và Mobile kiểm tra client hiện có. Không thay client-core hoặc Owner Web.

Giai đoạn 4: Owner điều chỉnh approve/reject bằng version hiện hành (request, invoice, financial), số tiền nguyên VND, lý do, xác nhận và dialog. Thanh toán dùng invoice/payer lookup thật, allocate/reject với idempotency; không sửa invoice Final trực tiếp. Các lỗi tài chính chặn gửi tiếp đến khi tải lại hồ sơ. Danh sách/chi tiết dùng cache chung để trở về từ quyết định có dữ liệu mới. Thể hiện phân bổ/chưa phân bổ do server trả, trạng thái thử nghiệm SePay, nợ quá hạn; lợi nhuận âm dùng formatter tài chính. Khoản hoàn/người trả bên ngoài giữ Web handoff; cọc qua luồng hợp đồng có sẵn. SePaySecurityTests 19/19, PaymentRules/AdjustmentBalance 14/14 PASS (unit).

Giai đoạn 4: `8f4c019`; lint/typecheck/format PASS; Mobile 96 files / 1.047 tests PASS. Sáu test form mới kiểm tra versions, approve/reject, invalid VND, conflict, double submit, payer, Paid/lookup failure/role guard; ba test màn hình kiểm tra ghép chi tiết và form/handoff.

Giai đoạn 5: thêm OwnerResidenceScreen, danh sách phân trang theo trạng thái và xem minh chứng riêng tư; xác nhận chỉ khi Completed, có minh chứng đọc được, lý do và human review. Tái sử dụng residenceClient/useResidenceRecord; không upload hoặc nộp VNeID cho Tenant. Notification Residence dùng Resident ID; resolve qua metadata `/residents/{id}` có quyền Owner rồi mở compound Contract/Resident, yêu cầu chọn kỳ nếu nhiều hợp đồng. Không tự chọn hồ sơ đầu trang. Deep links hợp đồng, task, incident, work order, bank transfer có regression tests. Owner task list thêm isOverdue filter đúng TaskQuery và cache tasks; StaffTaskList/Detail không thay đổi. IncidentActions đã có plan-decision/verify/rework/direct-resolution; không tạo lại.

Giai đoạn 5: `e92d425`; lint/typecheck/format PASS; Mobile 97 files / 1.057 tests PASS.

Giai đoạn 6: nút nhanh gọn hơn, dashboard ưu tiên số liệu/cảnh báo khẩn cấp và công nợ; hàng chờ dạng tóm tắt trên dashboard và phân trang tại approval center. Pull-to-refresh Owner làm mới các nguồn qua cache hiện có; ký nội bộ revalidate khi focus/foreground, không thêm polling. Bổ sung email/xác minh đại diện qua Owner metadata. MainDraftSigningReview cho Owner chọn nhánh khách mới với `tenantUserId: null` đúng MainDraftReleaseInput/ReleaseAsync, bên cạnh Tenant đã có tài khoản; bắt buộc PDF review và human confirmation ở cả hai nhánh. Không sửa nhánh hiển thị Staff.

## Trạng thái cuối theo chức năng Owner

COMPLETE dưới đây là phần Mobile/API trong phạm vi được giao; không phải chứng nhận chạy provider thật hoặc toàn bộ sản phẩm.

| Chức năng                   | Trước           | Sau      | Thay đổi chính                                                                                  |
| --------------------------- | --------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Dashboard                   | PARTIAL         | COMPLETE | API thật, cache scoped, số phòng, khẩn cấp, nợ, pull-to-refresh                                 |
| Approval center             | PARTIAL         | COMPLETE | 8 nhóm, hồ sơ cụ thể, phân trang, trạng thái lỗi/rỗng                                           |
| Holding/signing             | PARTIAL/MISSING | COMPLETE | Email, verify status, thu hồi/thay lời mời, Owner consent, cọc/readiness hiện có                |
| Main/renewal/move-out       | PARTIAL         | COMPLETE | Mở hồ sơ có sẵn, MySign tách biệt, activate, renewal, inspection review và settlement reference |
| Payment/adjustment          | PARTIAL         | COMPLETE | Allocate/reject, approve/reject, payer, versions, idempotency, refresh                          |
| Finance                     | COMPLETE        | COMPLETE | Nợ quá hạn, lợi nhuận âm hiển thị đúng từ server                                                |
| Emergency/maintenance/tasks | COMPLETE        | COMPLETE | Tái sử dụng actions; deep link, overdue filter, cache khi trở về                                |
| Residence                   | MISSING         | COMPLETE | Danh sách, resolve notification, private evidence, Owner confirmation                           |
| Provider và đa ứng dụng     | NOT RUN         | PARTIAL  | API fixtures + UI synthetic transport; chưa chạy 6 journey thật trên thiết bị                   |

## Bằng chứng validation

Chạy bằng Node 22.23.5 qua PATH tạm; không sửa package/lockfile hoặc dependencies. Lệnh đúng package scripts và `.github/workflows/ci.yml`.

| Kiểm tra                                     | Kết quả thực chạy                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                               | PASS, toàn repository                                                                                                                                                |
| `npm run typecheck --workspace ./src/mobile` | PASS                                                                                                                                                                 |
| `npm test --workspace ./src/mobile`          | PASS; số cuối ghi trong báo cáo bàn giao                                                                                                                             |
| `npm run format:check`                       | PASS                                                                                                                                                                 |
| Owner Web suite                              | 78 files / 442 tests PASS (chạy lại đủ suite với 4 workers)                                                                                                          |
| Owner Web contract regression                | 15 files / 56 tests PASS                                                                                                                                             |
| Backend unit                                 | 44 PASS: AnonymousSigningSecurity 11, SePaySecurity 19, PaymentRules/AdjustmentBalance 14                                                                            |
| Backend integration PostgreSQL               | 56 PASS: AnonymousSigning/Residence 4, SePay/HoldingCancellation/DigitalSigning 18, IncidentApi 19, selected ledger/adjustment/closure/tasks 14, MainDraft release 1 |
| `npm run build`                              | PASS: client-core, Owner Web, Public Web; có warning chunk size của Web, không sửa cấu hình để che warning                                                           |
| Expo web export                              | PASS, API origin tổng hợp, EXPO_NO_DOTENV=1; output ignored `src/mobile/dist`                                                                                        |
| Docker compose config                        | PASS cả `.env.example` và SePay compose example                                                                                                                      |
| Browser UI smoke                             | PASS trên Chrome headless 320×740 và 390×844; không tràn ngang, không page errors/unexpected API requests; approve điều chỉnh chỉ POST một lần và trạng thái tải lại |
| Android/iOS native và remote CI              | NOT RUN                                                                                                                                                              |

Lần đầu chạy integration không có `BHOME_COMPACT24_TEST_ADMIN` nên 4 test SKIP. Sau đó dựng PostgreSQL 16 container dùng credentials tổng hợp, chỉ bind loopback, để fixture tạo/xóa DB ngẫu nhiên; chạy lại đủ 4 PASS. Không dùng DB phát triển/production. Các suite ledger dùng PostgreSQL/MinIO Testcontainers riêng và tự dọn. Provider boundary trong test là synthetic, không phải Gmail/SePay/MySign thật.

Một lần root `npm test -- --maxWorkers=2` có 1/442 Owner Web test SMS countdown thất bại (`SmsRecoveryPage.test.tsx`, tìm nút “Gửi lại sau”). Test này không nằm trong diff. Chạy riêng 2/2 PASS và chạy lại toàn Owner Web 442/442 PASS. Ghi nhận dấu hiệu flakiness, không sửa Owner Web hoặc nới assertion. Các lỗi fixture Mobile khi thêm cache/native wrapper đã sửa; không còn lỗi Mobile trong lần chạy cuối.

Ảnh và script UI smoke nằm ở `.tools/owner-mobile-validation/` (ignored). Đây là kiểm tra layout/navigation/form với transport tổng hợp, không phải E2E business/provider. Đã xem ảnh dashboard và adjustment 320px. Không có dữ liệu cá nhân thật trong ảnh.

## Sáu demo journey

| Workflow                    | Owner Mobile                                    | Backend integration                             | E2E đa ứng dụng/provider                                    |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| E2E-01 Holding              | PASS component/API client                       | PASS anonymous Holding → deposit → Main tests   | PARTIAL; recipient email/OTP trên hộp thư thật NOT RUN      |
| E2E-02 Main                 | PASS component/API client                       | PASS signing/account activation fixtures        | PARTIAL; MySign thật và Tenant app NOT RUN                  |
| E2E-03 Billing/payment      | PASS payment form/guard                         | PASS SePay callbacks + ledger tests             | PARTIAL; Staff meter → Tenant QR → SePay bên ngoài NOT RUN  |
| E2E-04 Incident/maintenance | PASS regression hiện có                         | PASS 19 IncidentApi tests, gồm rework/emergency | PARTIAL; hai ứng dụng/thiết bị thật NOT RUN                 |
| E2E-05 Termination          | PASS version/reference/blocked-state tests      | PASS ledger/closure fixtures                    | PARTIAL; inspection và settlement qua các app thật NOT RUN  |
| E2E-06 Adjustment           | PASS browser UI synthetic transport + component | PASS final adjustment/rejection/concurrency     | PARTIAL; Tenant app nhận kết quả từ môi trường demo NOT RUN |

Không ghi PASS cho email chỉ vì provider tiếp nhận, ký chỉ vì gửi invitation hoặc payment chỉ vì đã POST allocate. Không có chỉnh DB trực tiếp để giả chuyển trạng thái demo.

## Phần còn cần xác minh

- Chạy sáu journey trên môi trường demo đã xác nhận với tài khoản tổng hợp Owner/Staff/Tenant; kiểm tra email đến hộp thư, OTP, callback/provider và trạng thái sau reload trên thiết bị. Không suy rằng credentials thiếu; phiên này chưa kiểm tra nhà cung cấp bên ngoài.
- InternalSigningStatus không trả email snapshot từng lời mời hoặc API retry SMTP riêng. Mobile hiển thị email hồ sơ hiện tại và trạng thái gửi do backend trả; thay lời mời/thu hồi dùng API được hỗ trợ. Nếu cần xem email lịch sử hoặc retry cùng lời mời, cần backend mở rộng được phê duyệt.
- Thực chi hoàn tiền, người trả bên ngoài, cấu hình và quản trị tài chính phức tạp tiếp tục Owner Web theo phạm vi. Không bypass blocker hoặc tạo ledger khác.
- Theo dõi test countdown SMS Owner Web không ổn định; không thuộc phạm vi sửa UI Owner Web của nhiệm vụ này.

## Tệp thay đổi

- Owner screens: `OwnerOverviewScreen.tsx`, `OwnerDecisionScreens.tsx`, `OwnerResidenceScreen.tsx`.
- Owner feature modules mới: `OwnerApprovalQueue.tsx`, `OwnerAttentionSummary.tsx`, `OwnerHoldingSigning.tsx`, `OwnerMoveOutDecisions.tsx`, `OwnerFinancialActions.tsx`, `ownerQueryPolicy.ts` trong `src/mobile/src/features/owner/`.
- Nhánh Owner trong thành phần chung: `ContractScreen.tsx`, `ContractLifecyclePanel.tsx`, `contractSections.ts`, `MainDraftSigningReview.tsx`, `OperationalTaskScreens.tsx`, `WorkspaceShell.tsx`, `WorkspaceScreenView.tsx`, `navigation.ts`, `notificationInbox.ts`.
- Tests Owner mới: `owner-approval-queue`, `owner-attention-summary`, `owner-holding-signing`, `owner-moveout-decisions`, `owner-financial-actions`, `owner-residence` trong `src/mobile/src/__tests__/`.
- Regression được cập nhật: `contract-sections`, `moveout-settlement`, `owner-mobile-decisions`, `owner-finance-monitoring`, `rental-contract-flow` và `tests/mobile/ocr/connectivity-ui.test.tsx`.
- Tài liệu này. Không sửa backend, migration, client-core, Owner Web hoặc các màn hình Staff/Tenant.
