# Billing automation

SRS BF-05/UC-20/21/JOB-09/10, yêu cầu Owner opt-in ngày 02/11/2026.
Các endpoint `/api/v1/billing-automation` dùng `locations.manage` (Owner), service rechecks
permission với Location từ server. Không cho Staff/Tenant cấu hình hoặc ủy quyền Final.

- PUT root: `{locationId,effectiveFrom,enabled,authorizeAutomaticFinalization,meterDay,
meterDueDay,meterDueMonthOffset,timeZone,expectedVersion,expectedBillingScheduleVersion}`.
  Các trường bắt buộc; effectiveFrom là ngày đầu kỳ; timezone đúng Asia/Ho_Chi_Minh;
  ngày 29–31 clamp giống BillingSchedule; hạn meter không trước ngày đọc.
- GET `{locationId}?period=yyyy-MM-01`: plan có EffectiveFrom lớn nhất không vượt kỳ;
  cùng EffectiveFrom lấy Version mới nhất. Chưa có plan trả null/204.
- GET `{locationId}/history`: tối đa 100 version gần nhất.

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

JOB-10 Draft handler `billing-draft`, phase `Draft`, gọi InvoiceService.Generate với Owner
delegation từ plan đã lưu; Owner active/role và plan hiệu lực được revalidate trong Location/
Room transaction hiện có. Financial calculation không sao chép sang job. Invoice.AutomationPlanId
trace nguồn tạo; Room/period unique hiện có dùng chung manual/scheduled/race.
GET/PUT `representative` dùng `{roomId,billingPeriod,contractId,expectedVersion}` khi lưu,
GET query roomId/period. Owner chọn eligible Contract; snapshot selection append-only.
Đã có Invoice không đổi selection. Nhiều Contracts nhưng thiếu selection giữ execution PendingInputs;
không tự chọn GUID/tiền thuê. Draft đã có không refresh/overwrite, giữ approved corrections,
Final và viewer snapshots. Thiếu giá/chỉ số lưu MissingInputs, không dùng OCR proposal.

JOB-10 Final handler `billing-final`, phase `Final`. Chỉ Owner-enabled plan đã ủy quyền,
đúng ngày và Owner còn active/role mới chạy. InvoiceService kiểm tra lại authority/calendar
trong financial lock; pending adjustment chặn. Approved Draft corrections không bị job refresh;
Finalize revalidates correction fingerprint như BH-41. Nguồn thay đổi cần Owner review.
Draft không correction được refresh bằng confirmed sources; nguồn không đổi không tăng version
hoặc thay line IDs khi retry. Missing/conflict giữ Draft và execution PendingInputs.
Manual/auto Final dùng cùng lock/constraints. `InvoiceIssuedEvents` append-only một row/Invoice,
lưu trong cùng transaction Final; replay không tạo event mới. External notification không nằm
trong transaction này. Final ghi AutomationFinalizationPlanId để trace delegation.
Timezone tests dùng BusinessDate chung với scheduler tại biên UTC17:00, năm mới và leap day.

Owner dashboard `/billing-automation` dùng GET `preview?locationId=&period=` trả
`{developerActionsEnabled,timeZone,businessDate,phases:[{phase,scheduledDate,eligible}]}`.
Eligible là điều kiện lịch/ủy quyền sơ bộ; handler luôn revalidate quyền và dữ liệu thực tế.
GET `attempts?locationId=&period=` trả tối đa 100 attempts mới nhất của cơ sở/kỳ;
không trả queue payload/provider credentials. Hai API dùng cùng Owner permission như settings.
Web liên kết cấu hình lịch tài chính hiện có `/pricing`, hiển thị version history, execution
counts, exception codes, delivery retry status và chọn hợp đồng đại diện theo phòng/kỳ.

GET `queue?locationId=&period=` trả tối đa 30 lượt queue billing mới nhất đã liên kết với
plan thuộc cơ sở/kỳ: `{id,name,state,attempts,availableAt,lockedUntil,lastErrorCode}`.
Không trả PayloadJson hoặc khóa provider. Preview thêm `workerEnabled` phản ánh Jobs:Enabled
của máy chủ đang phục vụ. UI phân biệt worker tắt với Developer Run Now, hiển thị lần thử lại
thực tế của queue; execution PendingInputs vẫn hiển thị từng missing input bằng tiếng Việt.
Worker nhận job theo danh sách IBackgroundJobHandler.Name đã đăng ký (`Name = ANY(...)`),
giữ job của module chưa được triển khai ở Pending thay vì nhận rồi làm cạn retry.
Trước khi nâng cấp demo phải dừng các binary worker cũ dùng chung database; binary trước thay đổi
này chưa có bộ lọc handler. Lịch sử Failed do binary demo cũ nhận nhầm job được giữ nguyên.
