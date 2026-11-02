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

JOB-09 handler `billing-meter` nhận `{planId,billingPeriod}` từ queue hiện có. Scheduler
JOB-02 được mở rộng bằng contributors, không thêm scheduler/queue thứ hai; expiry vẫn daily.
Contributor enqueue các kỳ hiện tại và hai kỳ trước (calendar hiện có cho offset tối đa 2),
không enqueue trước ngày cấu hình; pending được đánh giá lại theo phút, Completed không
tự enqueue lại. Task uniqueness là Room/type/period, kể cả task manual hoặc đã Cancelled;
thay meter giữ exception cần Owner review, không tự tạo consumption mới.

GET `executions?locationId=&period=`: Owner xem trạng thái/attempts/counts/exceptions.
POST `run-now` `{locationId,billingPeriod,phase:"Meter"}` chỉ Development/Testing + Owner,
gọi cùng engine/handler policy và không bỏ qua ngày/ủy quyền/uniqueness; chưa đến hạn trả 204.
POST `meter-tasks/{id}/assignment` `{staffUserId,expectedVersion}`: Owner chọn current Staff
assignment, không cho sửa task closed/stale. Task không có assignee vẫn tồn tại và chỉ Owner
xem; generated task chỉ Staff được giao trong Location hiện còn phụ trách mới đọc/confirm.
Capture DTO bổ sung dueAt, assignedStaffUserId, automationPlanId, version, locationId, roomId.
Schema mới snapshot Room/type được trigger derive từ Meter cho cả manual/scheduled inserts.
Migration dừng nếu dữ liệu cũ đã trùng; không xóa lịch sử để ép migration thành công.
