# Billing automation

SRS BF-05/UC-20/21/JOB-09/10, yêu cầu Owner opt-in ngày 02/11/2026.
Các endpoint `/api/v1/billing-automation` dùng `locations.manage` (Owner), service rechecks
permission với Location từ server. Không cho Staff/Tenant cấu hình hoặc ủy quyền Final.

* PUT root: `{locationId,effectiveFrom,enabled,authorizeAutomaticFinalization,meterDay,
  meterDueDay,meterDueMonthOffset,timeZone,expectedVersion,expectedBillingScheduleVersion}`.
  Các trường bắt buộc; effectiveFrom là ngày đầu kỳ; timezone đúng Asia/Ho_Chi_Minh;
  ngày 29–31 clamp giống BillingSchedule; hạn meter không trước ngày đọc.
* GET `{locationId}?period=yyyy-MM-01`: plan có EffectiveFrom lớn nhất không vượt kỳ;
  cùng EffectiveFrom lấy Version mới nhất. Chưa có plan trả null/204.
* GET `{locationId}/history`: tối đa 100 version gần nhất.

Lưu financial calendar qua `/api/v1/billing-schedules` hiện có rồi lưu automation plan với
ExpectedBillingScheduleVersion. Plan snapshot toàn bộ BillingSchedule trong transaction
Location lock chung với cấu hình giá/lịch, append-only và có actor/time. Version stale 409.
Không có plan thì manual invoice vẫn dùng calendar hiện có; có plan cho kỳ thì manual và
scheduled Generate cùng dùng snapshot của kỳ đó. Invoice đã tạo giữ ScheduleSnapshot riêng.
Tự động Final mặc định chưa được ủy quyền ở dữ liệu cũ; phải Owner chọn rõ trong plan.
