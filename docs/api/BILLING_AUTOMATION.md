# Billing automation

## Quyết định tích hợp 26/11/2026

Khi chuẩn bị PR #174, người dùng xác nhận giữ quy tắc THuy: hóa đơn kỳ N thu
tiền thuê N+1 và điện/nước/dịch vụ kỳ N; phí cố định đủ tháng, phí theo người
nhân sức chứa phòng. Backend tự chọn hợp đồng đối chiếu. Quyết định này thay
các mô tả cũ bên dưới về chọn đại diện thủ công và tính phí theo ngày/người
cư trú cho **hóa đơn định kỳ mới**. Xem [INVOICES.md](INVOICES.md#quyết-định-tích-hợp-memberthuy--26112026)
và [bàn giao JOB-10](../development/BILLING_REFERENCE_CONTRACT_HANDOFF.md).
Hóa đơn Final và snapshot coverage lịch sử được giữ nguyên; thiếu hợp đồng
đủ điều kiện không tự lập hóa đơn mới.

## Chế độ cấu hình lịch + chạy thử thủ công (14/11/2026)

Owner Web `/billing-automation` tách **Cấu hình lịch** khỏi **Chạy thử thủ công**.
Owner lưu ngày giao/chốt nhiệm vụ ghi số điện, nước và các mốc Draft/Final theo
**ngày trong tháng**; hạn thanh toán hiện kế thừa từ cấu hình Giá & biểu phí.
`effectiveFrom` là **kỳ đầu tiên** áp dụng
phiên bản này, không phải lựa chọn một tháng cụ thể để lập hóa đơn. Các kỳ sau
tiếp tục dùng phiên bản mới nhất có ngày hiệu lực không vượt quá kỳ đang xử lý.
Tháng ngắn tự co ngày 29–31 về ngày cuối tháng; mốc Draft không được sau Final,
Final không được sau hạn thanh toán. Lịch áp dụng theo kỳ được ghi trong
`BillingSnapshot` của plan; snapshot hóa đơn đã tạo không bị thay đổi.

`PUT /api/v1/billing-automation` giữ contract và concurrency version hiện có,
thêm sáu số nguyên **tùy chọn**: `draftDay`, `draftMonthOffset`, `finalDay`,
`finalMonthOffset`, `dueDay`, `dueMonthOffset` (hai trường Due có sẵn ở API nhưng
giao diện hiện chưa cho sửa trực tiếp). Màn cấu hình thử nghiệm ghi
`enabled:false` và `authorizeAutomaticFinalization:false`. Không được dùng việc
**lưu lịch** làm tín hiệu bắt đầu worker; các job hóa đơn chỉ được phép tự chạy
khi cờ server `BillingAutomation:AutomaticJobsEnabled=true` được bật riêng theo
quy trình phát hành chính thức (mặc định `false`). Cờ này không tắt worker của
các phân hệ khác. Plan cũ vẫn có history; không thay hoặc xóa dữ liệu hóa đơn.

**Chạy thử** cho phép thao tác có ghi dữ liệu trong Development/Testing, hoặc
Staging được bật rõ bằng `BillingAutomation:ManualActionsEnabled=true`, và
gọi các API Owner thực, theo một phòng/kỳ/công tơ được chọn:

- Giao nhiệm vụ ghi số **ban đầu**: `POST /api/v1/billing-automation/manual-meter-tasks`, `purpose=Initial`, `meterId` và `billingPeriod` để xác định lịch hiệu lực. Backend tạo Capture task Initial không có billingPeriod.
- Giao nhiệm vụ ghi số **vận hành/định kỳ**: cùng endpoint, `purpose=Periodic`, với `meterId` và kỳ kiểm thử. Backend lấy ngày ghi số từ `meterDay` của lịch áp dụng, không cần nhập tay ngày thử; chỉ chấp nhận khi ngày hiện tại ở Việt Nam đã đến ngày giao việc của kỳ đó.
- Tạo **Draft**: `POST /api/v1/invoices/drafts` với `roomId` và `billingPeriod` (không cần nhập hợp đồng đại diện). Backend dùng lựa chọn đại diện đã lưu cho kỳ nếu hợp lệ, hoặc hợp đồng duy nhất đủ điều kiện. Khi có nhiều hợp đồng nhưng chưa chọn đại diện, trả 409 `representative_selection_required` thay vì chọn tùy tiện; kỳ chưa có hợp đồng phù hợp trả 409 `representative_contract_not_eligible`.
- Phát hành **Final**: `POST /api/v1/invoices/{id}/finalize` với `expectedVersion` và xác nhận Owner rõ ràng.

Endpoint thử nhiệm vụ công tơ yêu cầu Owner có quyền quản lý Location và chỉ bật
trong Development/Testing hoặc Staging có cờ opt-in trên; việc cấu hình lịch không tự phát hành hoặc tự giao việc.
Đây là thao tác ghi nghiệp vụ vào database môi trường đang chạy **thật**, không
phải nút xem giả; những ràng buộc ngày, hợp đồng, chỉ số Staff-confirmed,
idempotency, phân quyền và bằng chứng vẫn được backend áp dụng. Nhiệm vụ chụp
ban đầu và định kỳ tạo qua Capture API thủ công có thể được Staff đang phụ trách
Location nhìn thấy; không được nhầm với tác vụ JOB-09 tự phân công từng Staff.

Cập nhật 24/11/2026: cờ manual mặc định `false`, chỉ được áp dụng khi môi trường
là `Staging`; Production không được mở bởi cờ này. Preview giữ nguyên tên trường
`developerActionsEnabled` để tương thích client và trả `true` khi Owner có thể
chạy thử. Cờ không mở thao tác thử của phân hệ thông báo hoặc bật worker;
`Jobs:Enabled` và `BillingAutomation:AutomaticJobsEnabled` vẫn độc lập. Owner
vẫn phải thực hiện từng lệnh; không tự tạo/chốt hóa đơn khi bật cờ.

Cập nhật **06/11/2026**: JOB-09/10 có implementation Compact24; không mặc định bật cho Location.
[Trạng thái toàn API](API_IMPLEMENTATION_STATUS.md), [route/input/policy](API_RUNTIME_ROUTES.md).
Tên entity/event bên dưới là tên logic; runtime lưu plan/settings/history trong cột/JSON Compact24,
không cần chạy migration EF legacy để tạo thêm bảng. Xem DI và Compact24 mapping khi triển khai.

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

Lưu financial calendar qua `/api/v1/billing-schedules` hiện có hoặc cung cấp
`initialSchedule` khi lưu automation plan với ExpectedBillingScheduleVersion.
Plan snapshot toàn bộ BillingSchedule trong transaction Location lock chung với
cấu hình giá/lịch, append-only và có actor/time. Version stale 409, kể cả request
không đổi nội dung. Cùng effectiveFrom, cùng actor, không đổi lịch/quy tắc tính tiền
và ủy quyền thì trả lại plan hiện có, không tăng version hoặc ghi audit mới.

Phase 7 (BF-05/UC-20/21, JOB-09/10): lịch tính phí theo kỳ và cấu hình legacy
`GET/PUT /api/v1/billing-schedules` có mục đích khác nhau. Khi lưu automation plan
mới, `BillingSnapshot.FallbackSchedule` giữ bản sao lịch fallback trước thay đổi
tài chính, hoặc null nếu chưa có lịch. API legacy vẫn giữ response/version hiện có.
Manual invoice, JOB-10 và quyết toán chưa có hóa đơn chọn plan áp dụng theo kỳ;
nếu kỳ chưa có plan, dùng fallback đã bảo toàn, không lấy quy tắc tài chính của
plan tương lai. Nếu fallback chưa từng được cấu hình, kỳ cũ không tự có lịch mới.
PUT legacy rõ ràng vẫn thay đổi fallback cho những kỳ chưa có plan; các plan và
invoice snapshot đã lưu không thay đổi. Plan cũ chưa có trường FallbackSchedule
không thể khôi phục lịch fallback đã mất trước Phase 7; giữ lịch hiện có cho các
lần lưu tiếp theo. Invoice đã tạo luôn dùng ScheduleSnapshot riêng.
Tự động Final mặc định chưa được ủy quyền ở dữ liệu cũ; phải Owner chọn rõ trong plan.

### Giới hạn Utility Profile nâng cao

Biểu giá bậc thang, định mức và đối soát được lưu theo phiên bản trong workspace điện
nước. `InvoiceService` và quyết toán khi trả phòng hiện dùng đơn giá metered từ
snapshot hợp đồng; không tự chuyển sang Utility Profile. Chưa mở khóa thay đổi
profile ở phòng có hợp đồng ràng buộc; hợp đồng mới có thời hạn giao với profile
cũng bị chặn (`contract_utility_profile_requires_review`) cho tới khi có snapshot nâng cao đầy đủ và
quy tắc xử lý nhiều hợp đồng trong cùng kỳ. Thay thế tariff đang được profile của
phòng ràng buộc sử dụng cũng bị chặn (`utility_tariff_locked_by_contract`) nếu làm
ngắn thời hạn sử dụng của profile. Request không đổi hoặc retry đúng phiên bản
đã lưu không ghi thêm lịch sử. Không dùng dữ liệu cấu hình hiện tại để dựng lại
snapshot của hợp đồng hoặc hóa đơn lịch sử.

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
Room/type được snapshot từ Meter cho cả manual/scheduled task; Compact24 giữ uniqueness của
business source key. Các ghi chú migration legacy ban đầu không phải lệnh triển khai runtime hiện tại;
import dữ liệu trùng cần review, không xóa lịch sử để ép import thành công.

JOB-10 Draft handler `billing-draft`, phase `Draft`, gọi InvoiceService.Generate với Owner
delegation từ plan đã lưu; Owner active/role và plan hiệu lực được revalidate trong Location/
Room transaction hiện có. Financial calculation không sao chép sang job. Invoice.AutomationPlanId
trace nguồn tạo; Room/period unique hiện có dùng chung manual/scheduled/race.
GET/PUT `representative` dùng `{roomId,billingPeriod,contractId,expectedVersion}` khi lưu,
GET query roomId/period. Owner chọn eligible Contract; snapshot selection append-only.
Đã có Invoice không đổi selection. Nhiều Contracts nhưng thiếu selection giữ execution PendingInputs;
không tự chọn GUID/tiền thuê. Draft đã có không refresh/overwrite, giữ approved corrections,
Final và viewer snapshots. Thiếu giá/chỉ số lưu MissingInputs, không dùng OCR proposal.

Phí dịch vụ `FixedPerPersonPerMonth` (BF-01/UC-07, BF-05/UC-21, JOB-10) dùng
đơn giá đã khóa trong hợp đồng. Backend tính theo thành viên ContractResident
thuộc hợp đồng đã kích hoạt, với khoảng ngày cư trú giao với kỳ và thời hạn hợp đồng;
mỗi ResidentId chỉ tính một lần cho mỗi ngày phòng, kể cả hợp đồng chồng lấn/gia hạn.
FullMonth tính mỗi người phát sinh cư trú trong kỳ một tháng. OccupiedCalendarDays
tính đơn giá × tổng ngày-người / số ngày thực của tháng, làm tròn VND một lần
theo lịch tính phí đã lưu. Quantity là số người khác nhau trong kỳ; trường
OccupiedDays là số ngày phòng có hợp đồng, không dùng để suy lại phí theo người.
Snapshot FixedChargeCoverage/v1 lưu ResidentCount và PersonDays để quyết toán
cùng kỳ chỉ thu phần chưa tính. Thiếu dữ liệu cư trú, coverage hoặc giá đã ký
giữ Draft/PendingInputs; không dùng sức chứa phòng để ước lượng.

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
