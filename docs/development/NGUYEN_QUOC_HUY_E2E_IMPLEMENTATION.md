# Triển khai và kiểm chứng các nhiệm vụ Nguyễn Quốc Huy

Ngày bắt đầu: 05/11/2026. Nhánh `member/QHuy`; baseline `5357b39`. Working tree ban đầu sạch. Đây là báo cáo tiến độ thực thi; không phải xác nhận hoàn tất 22 nhiệm vụ. Không push/merge, không ghi vào database làm việc `bhome`.

## Nguồn và truy vết

Đã đọc AGENTS gốc và hai client, API_CONVENTIONS, thiết kế/DDL/báo cáo Compact24, source/DTO/DI/tests, nội dung SRS `(2)`, SDS `(5)` và Report 2 `(3)` trong `docs/reports`. SRS: BF-03/04, UC-14..19, GBR-01/02/04, DBR-02/03; BF-05/06, UC-20..25; FE-08, UC-31..34, GBR-15/16/18. Không tìm thấy workbook `BHOME_Checklist_Phan_Cong_Tich_Hop_Tien_Do.xlsx` hoặc Reports 5–7; chưa có căn cứ để sửa checklist hay công bố ST/AT theo các mẫu đó.

Người dùng xác nhận OQ-01/02/05 đã đóng trong phiên này. Chưa nhận được nội dung quyết định; các tài liệu đang lưu vẫn ghi mở. Cần tìm/đưa quyết định cụ thể vào nguồn truy vết trước khi thay công thức khấu trừ/hoàn tiền. Không suy ra một chính sách từ việc câu hỏi đã đóng.

## Ma trận 22 nhiệm vụ sau kiểm tra nguồn ban đầu

| ID | Đã có / dữ liệu / UI | Khoảng trống và nghiệm thu còn lại | Trạng thái |
| --- | --- | --- | --- |
| BE-X04 | DI mặc định Compact24, worker/Identity/readiness; 24/386/83 | Regression server riêng, SQL log không legacy đã đạt 1 test; cần toàn bộ regression | PARTIAL |
| BE-14 | Contract Holding boundary và test transfer | `UnconfiguredContractHoldingLedger` vẫn đăng ký; chưa có Holding E2E thật | BLOCKED |
| BE-15 | Owner settings/Main Draft/documents/signing/deposit/activation; Web/Mobile; contracts JSON | Sửa trạng thái UI cấu hình; provider staging, tenant document review và browser E2E chưa nghiệm thu | PARTIAL |
| BE-16 | Renewal API/client, giữ phiên bản và chữ ký | Test Compact24 đạt; provider thật và UI E2E chưa chạy | PARTIAL |
| BE-17 | Handover API/client, baseline, evidence, hai xác nhận | Test Compact24 đạt; native Staff/Tenant E2E chưa chạy | PARTIAL |
| BE-19 | Move-out/inspection/settlement state machine | Positive test dùng ledger test; policy cụ thể/refund và E2E thật chưa đủ | PARTIAL |
| BE-20 | Capture/OCR/confirmation, Web monitor/Mobile; meters/readings | Regression nguồn hiện có; chưa chạy lại detector/device acceptance trong lượt này | NOT RUN |
| BE-21 | Room/kỳ invoices/items/recipients, billing schedule/automation, Web/Mobile | Cần chạy regression Compact24 và E2E | NOT RUN |
| BE-22 | Verified transactions/allocation, receiving account; Web/Mobile | Cần regression thực và bank integration; không tự nới under/overpayment | NOT RUN |
| BE-23 | Debt/due date/reminders/inbox | Cần regression Compact24, UI | NOT RUN |
| BE-24 | Request/evidence/Owner decision và lịch sử, Web/Mobile | Cần regression Compact24, quyết định OQ cụ thể, UI | NOT RUN |
| BE-25 | Payment history và scope | Cần regression và UI | NOT RUN |
| BE-31 | Bảng `expenses`; UI Investments hiện demo | Chưa có service/repository/controller Finance trong DI; cần API và UI thật | PARTIAL |
| BE-32 | UI reports/demo | Chưa có backend reports thực được đăng ký | PARTIAL |
| BE-33 | UI demo tính recovery | Chưa có backend recovery từ ledger thực | PARTIAL |
| BE-34 | `financial_scenarios`; UI demo | Chưa có backend analyze/save/list/get và isolation tests | PARTIAL |
| BE-X05 | CLI/preflight/mapping/reconciliation tests và artifacts | Cần chạy lại populated synthetic migration, không dùng dữ liệu thật | NOT RUN |
| BE-X06 | MinIO adapter, PDF signer, MySign adapter native | Không thấy bằng chứng provider staging; PDF conversion baseline lỗi; storage test substitute không phải MinIO thật | PARTIAL |
| BE-X07 | Bank claim/exact reconciliation/deposit guards | Chưa có nội dung chính sách đã đóng; Holding/refund chưa nghiệm thu | PARTIAL |
| BE-X08 | Invoice/payment unit và integration tests | Chưa có finance/report regression thực | PARTIAL |
| DOC-01 | Reports 2/3/4 originals, docs kỹ thuật | Báo cáo này bổ sung discrepancy; không sửa bản gốc để biến giới hạn thành yêu cầu | PARTIAL |
| DOC-03 | Báo cáo bằng chứng này | Report 7 không có tại repository; chưa thể đóng final evidence | PARTIAL |

## Slice BE-15 cấu hình hợp đồng trên Owner Web

Nguồn: UC-15, GBR-01/02/04; API hiện hữu GET/PUT `/api/v1/contracts/main-drafts/settings/{locationId}`. Thành phần: `MainDraftSettingsPanel`, shared `mainDraftClient`, `MainDraftService`/`MainDraftData`; settings trong cấu hình Location Compact24. Không đổi DTO, endpoint, schema hoặc quyền.

Thay đổi: xóa dữ liệu cũ khi đổi cơ sở/đóng dialog; chặn lưu khi đang tải; bỏ qua response đã abort; reset thông báo khi mở lại; dùng form validation và khóa các trường trong lúc lưu; chỉ báo thành công sau GET đọc lại persisted settings. Owner Web reviewer: Vũ Xuân Trường, trạng thái `INITIAL_API_UI_READY`. Không sửa Mobile trong slice này (cấu hình thuộc Owner Web).

Acceptance tự động: lưu đúng expectedVersion và đọc lại dữ liệu; đổi Location khi response cũ chưa về không ghi đè dữ liệu mới; lỗi tải/lưu không hiển thị thành công hoặc cho lưu dữ liệu cũ. 3/3 component tests đạt. Owner Web build và lint đạt. Chưa có browser E2E cho slice.

## Bằng chứng kiểm thử thực thi

- `dotnet test src/backend/BHome.sln --no-restore --verbosity minimal`: Domain 83 đạt; Application 225 đạt; Integration 456 đạt, 1 lỗi, 127 skip (thiếu biến Compact24 và optional model). Lỗi: `ActualLibreOfficeConversionPersistsPrivatePdfWithVietnameseAndIssueDate`, trả `contract_pdf_conversion_failed`.
- `npm.cmd run test --workspace src/owner-web`: baseline 99 đạt, 12 timeout, 111 tổng; chạy đồng thời gây tải cao. Sẽ chạy lại giới hạn worker, không tăng timeout để che lỗi.
- `npm.cmd run test --workspace src/mobile`: baseline 358 đạt, 14 lỗi, 372 tổng; 12 startup tests bị runtime Node ngoài dải hỗ trợ, 2 onboarding timeout. Cần xác minh lại với Node 22 đã có trong `.tools`.
- PostgreSQL 18 riêng trong thư mục TEMP, loopback port 55439, chỉ dữ liệu tổng hợp, query logging không parameter. Các fixture tự tạo/xóa database `bhome_compact24_<uuid>`.
- `dotnet test tests/backend/BHome.IntegrationTests --no-build --filter 'FullyQualifiedName~Compact24MainDraftRegressionTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~Compact24IndependenceTests' --logger 'trx;LogFileName=huy-contract-baseline.trx' --verbosity quiet` với biến kết nối server riêng: **24/24 đạt, 0 skip**. Có settings/effective dates/onboarding/docx, signing/activation/replay/race/authorization/renewal/handover/move-out và runtime independence. Signing/storage/settlement dùng boundary test được ghi trong fixture; không chứng minh MySign/MinIO thật.
- `npm.cmd run test --workspace src/owner-web -- src/features/contracts/MainDraftSettingsPanel.test.tsx --maxWorkers=2`: **3/3 đạt**.
- `npm.cmd run build --workspace src/owner-web`: đạt (TypeScript và Vite).
- `npm.cmd run lint --workspace src/owner-web`: đạt, không warning sau sửa.

## Nhật ký commit

Commit được ghi ngay sau mỗi slice đã kiểm tra. Chỉ stage đường dẫn cụ thể; không push.
