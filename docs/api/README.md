# BHOME — tài liệu API cho team

Cập nhật **06/11/2026**, đối chiếu runtime `BHome.Api` trên Compact24 và mã client hiện có. Bắt đầu từ [trạng thái triển khai](API_IMPLEMENTATION_STATUS.md) để biết phần đã có, phần còn thiếu và mức kiểm chứng. [Danh mục runtime](API_RUNTIME_ROUTES.md) liệt kê đủ **216 controller routes**; đây không phải tuyên bố toàn bộ sản phẩm đã nghiệm thu.

| Tài liệu                                         | Dùng khi phát triển                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [API_CONVENTIONS.md](API_CONVENTIONS.md)         | Auth/session, lỗi, phân quyền, ngày/tiền, idempotency và upload                                         |
| [PROPERTY_MANAGEMENT.md](PROPERTY_MANAGEMENT.md) | Chain, Location, Room Type, Room, Asset, giá phí, readiness/history/occupancy                           |
| [OPERATIONAL_TASKS.md](OPERATIONAL_TASKS.md)     | Task vận hành, Staff thực hiện, Owner xác minh và chứng từ private                                      |
| [CONTRACT_LIFECYCLE.md](CONTRACT_LIFECYCLE.md)   | Main Draft, release PDF, ký, cọc, activation, handover, renewal, move-out và blockers                   |
| [INVOICES.md](INVOICES.md)                       | Lịch phí, Draft/Final, số tiền phát hành bất biến và hóa đơn dùng chung                                 |
| [BILLING_AUTOMATION.md](BILLING_AUTOMATION.md)   | JOB-09/10, Owner opt-in, meter tasks, draft/final và execution monitoring                               |
| [INVOICE_ADJUSTMENTS.md](INVOICE_ADJUSTMENTS.md) | Tenant request/evidence, Owner approve/reject, hiệu lực trước/sau Final                                 |
| [PAYMENTS.md](PAYMENTS.md)                       | QR từ backend, sao kê thủ công, phân bổ thiếu/thừa, debt/history và privacy                             |
| [REFUNDS.md](REFUNDS.md)                         | Receipt thừa và nguồn cọc riêng; Owner review/manual execution/private evidence, có hoặc không khấu trừ |
| [DEPOSIT_DEDUCTIONS.md](DEPOSIT_DEDUCTIONS.md)   | Owner quyết định thiệt hại có evidence, giới hạn cọc, UI review và hoàn phần còn lại đã chạy browser    |
| [FINANCE.md](FINANCE.md)                         | Đầu tư/OPEX, chứng từ, báo cáo, historical occupancy, hoàn vốn và What-if                               |
| [NOTIFICATIONS.md](NOTIFICATIONS.md)             | Inbox, business-event publisher và JOB-04 delivery/retry                                                |

Auth, capture/onboarding và OCR chưa có file API module riêng: đọc [quy ước](API_CONVENTIONS.md), [danh mục route](API_RUNTIME_ROUTES.md) và DTO/controller được liên kết ở đó. Schema JSON chi tiết lấy từ DTO source/Swagger Development `/swagger/v1/swagger.json`; một số route Development được ẩn khỏi Swagger nên không so số operations trực tiếp với descriptor audit.

`OPERATIONAL_TASKS_PROPOSAL.md` là lịch sử đề xuất, không phải contract hiện hành. Các delivery report cũ lưu bằng chứng theo thời điểm; khi đọc tên bảng/migration cũ phải đối chiếu runtime Compact24. Không chạy migration legacy từ tài liệu lịch sử để cập nhật database Compact24.

Khi thay đổi API, cập nhật file module và bản trạng thái, chạy audit rồi tái sinh danh mục theo [hướng dẫn](API_IMPLEMENTATION_STATUS.md#tái-tạo-và-kiểm-tra-tài-liệu). Ghi rõ kiểm thử đã chạy, dữ liệu tổng hợp và giới hạn; không đổi trạng thái “có endpoint” thành “E2E hoàn tất” chỉ vì build thành công.

[Gói evidence 06/11](../development/NGUYEN_QUOC_HUY_2026-11-06_EVIDENCE.md) ánh xạ kết quả hiện tại
sang Report 2/3/4/5/7, trách nhiệm review và những bước chưa nghiệm thu.
