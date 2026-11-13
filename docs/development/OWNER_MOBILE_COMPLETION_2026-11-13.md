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

Giai đoạn 1: `a0ef9bf` — dashboard cache theo session, 8 nhóm hồ sơ chờ duyệt có deep link từng ID. Lint, typecheck, format:check PASS; Mobile 93 files / 1.031 tests PASS. Fixture connectivity được cập nhật để kiểm tra cache dùng chung khi remount và abort khi đóng session.

Giai đoạn 2: thêm OwnerHoldingSigning bằng internalSigning client hiện có; chọn hạn lời mời theo giờ Việt Nam và giới hạn 24 giờ đúng backend; trạng thái email/OTP/thu hồi; Owner confirm chỉ sau tenantAcceptedAt + documentHash. Không lưu/hiển thị token, không đánh dấu signed khi gửi invitation. Bốn component tests kiểm tra role/method/approval, payload giờ Việt Nam, chống gửi lặp, refresh và provider failure.

Giới hạn API hiện tại: InternalSigningStatus không trả recipient email; chỉ hiển thị người đại diện theo contract và trạng thái máy chủ. Không bịa email, không truy vấn thêm identity sâu để lấy email. Gửi lại là tạo lời mời thay thế đúng endpoint hiện có; API không có retry SMTP riêng. Recipient signing và việc thư thực sự đến hộp thư chưa được kiểm tra E2E.
