# Chỉ số đã xác nhận trước Draft

Nguồn: BR-06/12/19, BF-05, UC-20/21, GBR-07/09. Backend là nguồn chính thức; không chuyển OCR proposal thành dữ liệu Tenant.

GET /api/v1/tenant/meter-readings?page=1&pageSize=20&roomId=…&billingPeriod=yyyy-MM-01 trả items, page, pageSize, totalCount. roomId và billingPeriod là filter tùy chọn. Chỉ role Tenant. Pagination 1–100 rows, filter/quyền áp dụng trước count/page.

Mỗi item có id, roomId, roomNumber, locationName, meterCode, utilityType, purpose, readingDate, billingPeriod, previousValue, confirmedValue, consumption, confirmedAt, status. Số đo là decimal strings; previousValue/consumption có thể null cho baseline. Không trả OCR proposal, identity, object key, token hoặc thông tin Staff.

GET /api/v1/tenant/meter-readings/{id}/evidence tải ảnh riêng, NoStore. Cùng kiểm tra object-level scope; 404 khi không thuộc Tenant, không tiết lộ tồn tại file.

Điều kiện:

- MeterReading Confirmed/Corrected, ConfirmedAt có giá trị; task Completed, meter/task/evidence liên kết khớp; evidence đã upload và link.
- Tenant là Resident trong Contract đã kích hoạt Main/Renewal, khoảng ở giao với ngày đo hoặc billing period; Contract Active/Terminated/Superseded. Hoặc có InvoiceRecipient lịch sử cho InvoiceLine dùng reading.
- Không yêu cầu Invoice tồn tại. Lịch sử không phụ thuộc Room hiện tại trong hồ sơ Resident.
- METER_READING_CONFIRMED tạo in-app bền vững và yêu cầu kênh EMAIL cấu hình sẵn, mỗi reading/recipient một lần; target MeterReading kiểm tra quyền lại. Provider/email lỗi không sửa reading hay rollback nghiệp vụ.

Tenant Mobile → Điện nước theo kỳ dùng nguồn trên, hiển thị chỉ số/tiêu thụ/ngày xác nhận, mở ảnh bằng request có xác thực và chỉ giữ ảnh trong memory. Notification dẫn về màn hình này; liên kết hóa đơn/thanh toán vẫn có. Snapshot billing/draft/final hiện có không thay đổi bởi API đọc này.

Traceability: TenantMeterReadingService → TenantMeterReadingsRepository → MeterReading/OperationalTask/MeterEvidence/ContractResident/InvoiceRecipient; TenantPreInvoiceReadingsTests thực thi Staff upload/confirm thật, shared Tenant scope, chưa Invoice, proposal không lộ, ảnh riêng, notification dedupe/email intent, historical access; Mobile component và notification route tests.
