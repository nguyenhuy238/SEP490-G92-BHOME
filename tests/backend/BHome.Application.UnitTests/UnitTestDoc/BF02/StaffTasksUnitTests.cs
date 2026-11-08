using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF02;

// Unit test cho sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx (20 TC).
// Kết quả mong đợi (Return / Exception / Log Message) lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3).
// Code chỉ được dùng để biết cách gọi hàm (danh mục chữ ký + tài liệu API docs/api/OPERATIONAL_TASKS.md cho tên action).
// Hàm được gọi:
//   assignStaffToLocation  -> CaptureService.AssignStaffAsync (quy tắc nằm ở repository DB, xem ghi chú từng UTC)
//   createOperationalTask  -> OperationalTaskService.CreateAsync
//   startTask / recordTaskProgress / submitTaskResult / verifyTask -> OperationalTaskService.ActAsync("start"|"progress"|"submit"|"verify"|"rework")
//   generateRecurringTasks -> chỉ có ở repository DB (IOperationsRepository.GenerateDueRecurringTasksAsync)
//   markOverdueTasks       -> OperationalTask.IsOverdue / TaskView.IsOverdue (không tìm thấy job đánh dấu + thông báo)
// Repository, phân công Location, file evidence, người dùng hiện tại và đồng hồ là bản giả.
public sealed class StaffTasksUnitTests
{
    private const string Msg03 = "You do not have permission to perform this action.";
    private const string Msg04 = "This Location is outside your assigned scope.";

    private static readonly Guid Owner1 = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Staff1 = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
    private static readonly Guid Staff2 = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
    private static readonly Guid L1 = Guid.Parse("00000000-0000-0000-0000-0000000000c1");
    private static readonly Guid L2 = Guid.Parse("00000000-0000-0000-0000-0000000000c2");
    private static readonly Guid L3 = Guid.Parse("00000000-0000-0000-0000-0000000000c3");
    private static readonly TimeSpan Vn = TimeSpan.FromHours(7);

    private readonly FakeCurrentUser user = new();
    private readonly FakeStaffLocations assignments = new();
    private readonly InMemoryTaskRepository repository;
    private readonly FakeEvidenceFiles files = new();
    private readonly FixedClock clock = new(new DateTimeOffset(2026, 11, 10, 8, 0, 0, Vn));

    public StaffTasksUnitTests()
    {
        repository = new InMemoryTaskRepository(assignments);
        repository.Owners.Add(Owner1);
        repository.Locations[L1] = new TaskLocation(L1, true);
        repository.Locations[L2] = new TaskLocation(L2, true);
        repository.Locations[L3] = new TaskLocation(L3, true);
    }

    private PermissionAccess Permission() => new(user, new ResourceAccess(user, assignments));

    private OperationalTaskService Tasks() =>
        new(repository, user, Permission(), files, new TaskEvidenceLimits(), clock);

    private void LoggedIn(Guid id, string role)
    {
        user.UserId = id;
        user.Role = role;
    }

    private static string Norm(string? s) => (s ?? "").Replace(" ", "").Replace("_", "").ToLowerInvariant();

    private OperationalTask ExistingTask(Guid location, MeterTaskStatus status, Guid? assignee, bool evidenceRequired = false,
        DateTimeOffset? dueAt = null)
    {
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = location,
            Title = "Clean corridor",
            Requirements = "Clean the corridor of floor 1",
            Priority = OperationalTaskPriority.Normal,
            DueAt = dueAt ?? new DateTimeOffset(2026, 11, 11, 17, 0, 0, Vn),
            EvidenceRequired = evidenceRequired,
            AssignedStaffUserId = assignee,
            AssignmentId = assignee is null ? null : repository.AssignmentOf(location),
            AssignedAt = clock.Now.AddDays(-1),
            Status = status,
            Version = 1
        };
        repository.Track(task);
        return task;
    }

    private void EarlierHistory(OperationalTask task, string action, string note) =>
        repository.Add(new OperationalTaskHistory
        {
            TaskId = task.Id, ActorId = Staff1, Action = action, Note = note, ChangesJson = "{}",
            ResponsibleStaffUserId = Staff1, OccurredAt = clock.Now.AddHours(-2), TaskVersion = task.Version
        });

    private async Task<Guid> UploadPhoto(OperationalTask task)
    {
        var evidence = await Tasks().UploadAsync(task.Id, Guid.NewGuid(), new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]), default);
        return evidence.Id;
    }

    // ============================== assignStaffToLocation ==============================

    // UTC01 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; staff1 is an active Staff account and is already responsible for Location L2; active Location L1 has no responsible Staff
    // Đầu vào : locationId=L1; staffId=staff1
    // Mong đợi: Return: staff1 is the responsible Staff of L1 and remains responsible for L2; staff1 notified; staff1 can view L1 and its Operational Tasks; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-09 Normal Flow 1-10; UC-09 Postcondition 1-2; FE-01 1.2.1
    // Ghi chú : theo danh mục chữ ký, việc phân công chỉ được xử lý trong repository DB (ICaptureRepository / ILocationAssignments
    //           -> CompactLocationAssignments dùng Compact24DbContext); tầng Application chỉ chuyển tiếp. Không có service nghiệp vụ để
    //           unit test các quy tắc này -> cần integration test với DB.
    [Fact(DisplayName = "BF02 UTC01 - Owner giao staff1 phu trach L1 (van giu L2)", Skip = "assignStaffToLocation: quy tac nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC01_AssignStaffToSecondLocation() { }

    // UTC02 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; staff1 is the responsible Staff of L1; task T1 at L1 is In Progress assigned to staff1; task T2 at L1 is Completed; staff2 is an active Staff account
    // Đầu vào : locationId=L1; staffId=staff2; replacementConfirmed=true
    // Mong đợi: Return: staff2 is the only responsible Staff of L1; T1 reassigned to staff2 with the reassignment recorded in T1 history; T2 unchanged; staff1 and staff2 notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-09 Normal Flow 6-9; UC-09 A2; UC-09 Postcondition 1, 3, 4
    // Ghi chú : như UTC01 - thay phân công (ReplaceAssignmentAsync) chỉ có ở repository DB.
    [Fact(DisplayName = "BF02 UTC02 - Thay staff1 bang staff2 tai L1, chuyen task dang lam", Skip = "assignStaffToLocation: quy tac nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC02_ReplaceResponsibleStaff() { }

    // UTC03 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; tenant1 is a Tenant account
    // Đầu vào : locationId=L1; staffId=tenant1
    // Mong đợi: Return: assignment rejected; L1 responsibility unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-09 Precondition 3; UC-09 A1 (invalid Staff account); GBR-01
    // Ghi chú : kiểm tra tài khoản có phải Staff hợp lệ nằm ở repository DB.
    [Fact(DisplayName = "BF02 UTC03 - Giao Location cho tai khoan Tenant: bi tu choi", Skip = "assignStaffToLocation: quy tac nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC03_AssignTenantRejected() { }

    // UTC04 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; staff3 is a Staff account with status Inactive
    // Đầu vào : locationId=L1; staffId=staff3
    // Mong đợi: Return: assignment rejected; L1 responsibility unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-09 Precondition 3; UC-09 A1 (inactive Staff account)
    // Ghi chú : kiểm tra trạng thái Staff nằm ở repository DB.
    [Fact(DisplayName = "BF02 UTC04 - Giao Location cho Staff Inactive: bi tu choi", Skip = "assignStaffToLocation: quy tac nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC04_AssignInactiveStaffRejected() { }

    // UTC05 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff1 logged in as Staff; staff1 is responsible for L1
    // Đầu vào : locationId=L1; staffId=staff1; action=change Location responsibility
    // Mong đợi: Return: action denied; L1 responsibility unchanged; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : UC-09 A5; FE-01 1.2.1 (only Owner manages Location assignments); Permission Matrix Staff/Employment; MSG03
    [Fact(DisplayName = "BF02 UTC05 - Staff tu doi phan cong Location: bi tu choi, MSG03")]
    public async Task UTC05_StaffCannotChangeAssignment()
    {
        LoggedIn(Staff1, Roles.Staff);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var capture = Substitute.For<ICaptureRepository>();
        var properties = new PropertyService(Substitute.For<IPropertyRepository>(), user, Permission(), clock);
        var service = new CaptureService(capture, user, properties);

        var error = await Assert.ThrowsAnyAsync<Exception>(() =>
            service.AssignStaffAsync(new AssignmentInput(L1, Staff1, new DateOnly(2026, 11, 10), null), default));

        await capture.DidNotReceiveWithAnyArgs().AssignStaffAsync(default!, default);
        Assert.Equal(Staff1, assignments.ResponsibleByLocation[L1]);
        Assert.Equal(Msg03, error.Message);
    }

    // UTC06 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; staff1 is responsible for L1; L1 has no unfinished Operational Tasks
    // Đầu vào : locationId=L1; action=remove Staff assignment
    // Mong đợi: Return: L1 has no responsible Staff; staff1 no longer has access to L1 operational data; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-09 A3; DBR-01
    // Ghi chú : gỡ phân công (RemoveAssignmentAsync) chỉ có ở repository DB.
    [Fact(DisplayName = "BF02 UTC06 - Owner go phan cong staff1 khoi L1", Skip = "assignStaffToLocation: quy tac nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC06_RemoveAssignment() { }

    // ============================== createOperationalTask ==============================

    // UTC07 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Location L1 is active; staff1 is the active responsible Staff of L1
    // Đầu vào : locationId=L1; taskType=Ad-hoc; priority=Normal; targetCompletionTime=2026-11-11 17:00; evidenceRequirement=1 photo
    // Mong đợi: Return: Operational Task created in Assigned status with responsible Staff=staff1; priority, deadline and evidence requirement retained; staff1 notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-10 Normal Flow 2-12; UC-10 Postcondition 1-3; FE-01 1.3.2
    // Ghi chú : API chỉ có cờ EvidenceRequired (bool), "1 photo" được truyền là EvidenceRequired=true.
    [Fact(DisplayName = "BF02 UTC07 - Owner tao task Ad-hoc tai L1: Assigned cho staff1, staff1 duoc bao")]
    public async Task UTC07_CreateTaskAssignedToResponsibleStaff()
    {
        LoggedIn(Owner1, Roles.Owner);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var due = new DateTimeOffset(2026, 11, 11, 17, 0, 0, Vn);

        var view = await Tasks().CreateAsync(new TaskCreate(L1,
            new TaskWrite("Fix corridor light", "Replace the broken bulb", OperationalTaskPriority.Normal, due, true)), Guid.NewGuid(), default);

        Assert.Equal(Norm(nameof(OperationalTaskKind.AdHoc)), Norm(view.Kind));
        Assert.Equal(Norm("Assigned"), Norm(view.Status));
        Assert.Equal(Staff1, view.CurrentResponsibleStaffUserId);
        Assert.Equal(Norm("Normal"), Norm(view.Priority));
        Assert.Equal(due, view.DueAt);
        Assert.True(view.EvidenceRequired);
        Assert.Contains(repository.Notifications(view.Id), n => n.RecipientUserId == Staff1);
    }

    // UTC08 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; active Location L3 has no responsible Staff
    // Đầu vào : locationId=L3; taskType=Ad-hoc; targetCompletionTime=2026-11-11 17:00
    // Mong đợi: Return: task assignment not activated; task remains unassigned; Owner informed to resolve the Location responsibility first; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-10 A1; UC-09 A4
    // Ghi chú : "Owner informed" được chấp nhận ở 1 trong 2 dạng quan sát được: hàm báo lỗi cho Owner,
    //           hoặc trả về task với ResponsibilityAvailable=false. Cả 2 dạng đều không được có Staff phụ trách.
    [Fact(DisplayName = "BF02 UTC08 - Tao task tai L3 chua co Staff: khong giao, Owner duoc bao")]
    public async Task UTC08_CreateTaskWithoutResponsibleStaff()
    {
        LoggedIn(Owner1, Roles.Owner);

        TaskView? view = null;
        Exception? informed = null;
        try
        {
            view = await Tasks().CreateAsync(new TaskCreate(L3,
                new TaskWrite("Fix corridor light", "Replace the broken bulb", OperationalTaskPriority.Normal,
                    new DateTimeOffset(2026, 11, 11, 17, 0, 0, Vn), false)), Guid.NewGuid(), default);
        }
        catch (Exception e) { informed = e; }

        Assert.DoesNotContain(repository.AllTasks(), t => t.LocationId == L3 && t.AssignedStaffUserId is not null);
        if (informed is null)
        {
            Assert.NotNull(view);
            Assert.Null(view.CurrentResponsibleStaffUserId);
            Assert.False(view.ResponsibilityAvailable);
            Assert.NotEqual(Norm("Assigned"), Norm(view.Status));
        }
    }

    // ============================== startTask ==============================

    // UTC09 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff1 logged in; task T1 at L1 is Assigned to staff1; staff1 is responsible for L1
    // Đầu vào : taskId=T1; action=start
    // Mong đợi: Return: T1 status=In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-11 Normal Flow 4-5; FE-01 1.3.3
    [Fact(DisplayName = "BF02 UTC09 - staff1 bat dau T1: In Progress")]
    public async Task UTC09_StartTask()
    {
        LoggedIn(Staff1, Roles.Staff);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.Assigned, Staff1);

        var view = await Tasks().ActAsync(t1.Id, "start", new TaskAction(t1.Version), Guid.NewGuid(), default);

        Assert.Equal(Norm("In Progress"), Norm(view.Status));
    }

    // ============================== recordTaskProgress ==============================

    // UTC10 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff1 logged in; task T1 is In Progress, assigned to staff1, with one earlier progress update
    // Đầu vào : taskId=T1; progressNote="50% done"; evidence=1 photo
    // Mong đợi: Return: progress update and evidence recorded on T1; earlier progress history retained; T1 remains In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-11 Normal Flow 7; UC-11 Postconditions (history retained)
    [Fact(DisplayName = "BF02 UTC10 - Cap nhat tien do kem anh: luu tien do, giu lich su cu")]
    public async Task UTC10_RecordProgress()
    {
        LoggedIn(Staff1, Roles.Staff);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1);
        EarlierHistory(t1, "progress", "20% done");
        var earlier = repository.Histories(t1.Id).Single();

        var photo = await UploadPhoto(t1);
        var view = await Tasks().ActAsync(t1.Id, "progress", new TaskAction(t1.Version, "50% done", [photo]), Guid.NewGuid(), default);

        Assert.Contains(repository.Histories(t1.Id), h => h.Note.Contains("50% done"));
        Assert.Contains(repository.Histories(t1.Id), h => h.Id == earlier.Id && h.Note == "20% done");
        Assert.Contains(repository.Evidence(t1.Id), e => e.Id == photo);
        Assert.Equal(Norm("In Progress"), Norm(view.Status));
    }

    // UTC11 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Task T1 at L1 is assigned to staff1; staff2 logged in and is responsible only for L2
    // Đầu vào : taskId=T1; userId=staff2; action=update progress
    // Mong đợi: Return: access denied; T1 unchanged; Exception: N/A; Log Message: "This Location is outside your assigned scope."
    // Căn cứ  : UC-11 Precondition 2-3; FE-01 1.3.3; DBR-01; GBR-02; MSG04
    [Fact(DisplayName = "BF02 UTC11 - staff2 (chi phu trach L2) cap nhat T1 o L1: bi tu choi, MSG04")]
    public async Task UTC11_ProgressOutsideScopeDenied()
    {
        assignments.ResponsibleByLocation[L1] = Staff1;
        assignments.ResponsibleByLocation[L2] = Staff2;
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1);
        LoggedIn(Staff2, Roles.Staff);

        var error = await Assert.ThrowsAnyAsync<Exception>(() =>
            Tasks().ActAsync(t1.Id, "progress", new TaskAction(t1.Version, "50% done"), Guid.NewGuid(), default));

        Assert.Equal(MeterTaskStatus.InProgress, t1.Status);
        Assert.Equal(1, t1.Version);
        Assert.Empty(repository.Histories(t1.Id));
        Assert.Equal(Msg04, error.Message);
    }

    // ============================== submitTaskResult ==============================

    // UTC12 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff1 logged in; task T1 is In Progress, assigned to staff1; T1 requires 1 completion photo
    // Đầu vào : taskId=T1; result="Cleaning done"; evidence=1 photo
    // Mong đợi: Return: T1 status=Pending Verification; result and evidence retained; Owner notified; Exception: N/A; Log Message: "Task completion submitted successfully."
    // Căn cứ  : UC-11 Normal Flow 9-14; UC-11 Postcondition Success; MSG16
    // Ghi chú : hàm trả về TaskView, không có trường thông báo -> Log Message (MSG16) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF02 UTC12 - Nop ket qua kem anh: Pending Verification, Owner duoc bao")]
    public async Task UTC12_SubmitResult()
    {
        LoggedIn(Staff1, Roles.Staff);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1, evidenceRequired: true);

        var photo = await UploadPhoto(t1);
        var view = await Tasks().ActAsync(t1.Id, "submit", new TaskAction(t1.Version, "Cleaning done", [photo]), Guid.NewGuid(), default);

        Assert.Equal(Norm("Pending Verification"), Norm(view.Status));
        Assert.Equal("Cleaning done", view.Result);
        Assert.Contains(repository.Evidence(t1.Id), e => e.Id == photo);
        Assert.Contains(repository.Notifications(t1.Id), n => n.RecipientUserId == Owner1);
    }

    // UTC13 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff1 logged in; task T1 is In Progress, assigned to staff1; T1 requires 1 completion photo
    // Đầu vào : taskId=T1; result="Cleaning done"; evidence=none
    // Mong đợi: Return: submission blocked; required evidence requested; T1 remains In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-11 A2; UC-11 Normal Flow 12
    [Fact(DisplayName = "BF02 UTC13 - Nop ket qua thieu anh bat buoc: bi chan, van In Progress")]
    public async Task UTC13_SubmitWithoutRequiredEvidence()
    {
        LoggedIn(Staff1, Roles.Staff);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1, evidenceRequired: true);

        await Assert.ThrowsAnyAsync<Exception>(() =>
            Tasks().ActAsync(t1.Id, "submit", new TaskAction(t1.Version, "Cleaning done", []), Guid.NewGuid(), default));

        Assert.Equal(MeterTaskStatus.InProgress, t1.Status);
    }

    // UTC14 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff1 logged in; task T1 is In Progress, assigned to staff1
    // Đầu vào : taskId=T1; status=Completed
    // Mong đợi: Return: action not allowed; T1 does not become Completed (Owner verification required); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-11 A5; UC-12 Postcondition Accepted
    // Ghi chú : cách duy nhất chuyển sang Completed theo API là action "verify"; Staff gọi action này.
    [Fact(DisplayName = "BF02 UTC14 - Staff tu chuyen T1 sang Completed: khong duoc phep")]
    public async Task UTC14_StaffCannotCompleteTask()
    {
        LoggedIn(Staff1, Roles.Staff);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1);

        await Assert.ThrowsAnyAsync<Exception>(() =>
            Tasks().ActAsync(t1.Id, "verify", new TaskAction(t1.Version), Guid.NewGuid(), default));

        Assert.NotEqual(MeterTaskStatus.Completed, t1.Status);
    }

    // ============================== verifyTask ==============================

    // UTC15 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; task T1 is Pending Verification, assigned to staff1
    // Đầu vào : taskId=T1; decision=Request rework; reworkReason="Floor still dirty"
    // Mong đợi: Return: T1 status=In Progress; rework reason retained in T1 history; staff1 notified; Exception: N/A; Log Message: "Owner requested rework. Please review the reason."
    // Căn cứ  : UC-12 A1; FE-01 1.3.2 (Rework Reason); MSG15
    // Ghi chú : hàm trả về TaskView, không có trường thông báo -> Log Message (MSG15) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF02 UTC15 - Owner yeu cau lam lai: In Progress, luu ly do, staff1 duoc bao")]
    public async Task UTC15_RequestRework()
    {
        LoggedIn(Owner1, Roles.Owner);
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.PendingVerification, Staff1);
        t1.Result = "Cleaning done";

        var view = await Tasks().ActAsync(t1.Id, "rework", new TaskAction(t1.Version, "Floor still dirty"), Guid.NewGuid(), default);

        Assert.Equal(Norm("In Progress"), Norm(view.Status));
        Assert.Contains(repository.Histories(t1.Id), h => h.Note.Contains("Floor still dirty"));
        Assert.Contains(repository.Notifications(t1.Id), n => n.RecipientUserId == Staff1);
    }

    // UTC16 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; task T1 is Pending Verification with result and evidence
    // Đầu vào : taskId=T1; decision=Accept
    // Mong đợi: Return: T1 status=Completed; verification actor=owner1 and verification time recorded; assignment, progress and evidence history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-12 Normal Flow 7-11; UC-12 Postcondition Accepted
    [Fact(DisplayName = "BF02 UTC16 - Owner chap nhan: Completed, ghi nguoi va thoi gian duyet")]
    public async Task UTC16_AcceptTask()
    {
        // Dựng Điều kiện "Pending Verification with result and evidence" bằng chính luồng của Staff: tải ảnh rồi nộp kết quả.
        assignments.ResponsibleByLocation[L1] = Staff1;
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1, evidenceRequired: true);
        EarlierHistory(t1, "assigned", "Assigned to staff1");
        EarlierHistory(t1, "progress", "50% done");
        LoggedIn(Staff1, Roles.Staff);
        var photo = await UploadPhoto(t1);
        await Tasks().ActAsync(t1.Id, "submit", new TaskAction(t1.Version, "Cleaning done", [photo]), Guid.NewGuid(), default);
        Assert.Equal(MeterTaskStatus.PendingVerification, t1.Status);
        var earlierHistory = repository.Histories(t1.Id).Select(h => h.Id).ToArray();
        LoggedIn(Owner1, Roles.Owner);

        var view = await Tasks().ActAsync(t1.Id, "verify", new TaskAction(t1.Version), Guid.NewGuid(), default);

        Assert.Equal(Norm("Completed"), Norm(view.Status));
        Assert.Equal(Owner1, view.VerifiedByUserId);
        Assert.Equal(clock.Now, view.VerifiedAt);
        Assert.Equal(Staff1, t1.AssignedStaffUserId);
        Assert.All(earlierHistory, id => Assert.Contains(repository.Histories(t1.Id), h => h.Id == id));
        Assert.Contains(repository.Evidence(t1.Id), e => e.Id == photo);
    }

    // ============================== generateRecurringTasks ==============================

    // UTC17 (Normal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Recurring task configured weekly on Monday for Location L1 with a configured deadline; staff1 is responsible for L1; no task generated yet for the week of 2026-11-16
    // Đầu vào : runDate=2026-11-16 (Monday)
    // Mong đợi: Return: 1 recurring Operational Task created for L1 with the configured deadline and responsible Staff=staff1; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-06 Required Processing; UC-10 Normal Flow 3
    // Ghi chú : theo danh mục chữ ký, việc sinh task định kỳ chỉ nằm trong repository DB
    //           (IOperationsRepository.GenerateDueRecurringTasksAsync -> CompactOperationsRepository) -> cần integration test.
    [Fact(DisplayName = "BF02 UTC17 - Job sinh task dinh ky thu Hai cho L1", Skip = "generateRecurringTasks: logic nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC17_GenerateWeeklyTask() { }

    // UTC18 (Abnormal) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Task for week 2026-W47 already generated
    // Đầu vào : runDate=2026-11-16 (second run, same week)
    // Mong đợi: Return: 0 tasks created (no duplicate); Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-06 Failure/Idempotency; GBR-18; NFR 2.2 Idempotency
    // Ghi chú : như UTC17.
    [Fact(DisplayName = "BF02 UTC18 - Chay job lan 2 cung tuan: khong tao trung", Skip = "generateRecurringTasks: logic nam o repository DB, khong unit test duoc - can integration test")]
    public void UTC18_NoDuplicateRecurringTask() { }

    // ============================== markOverdueTasks ==============================

    // UTC19 (Boundary) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Task T1 is In Progress, assigned to staff1; Target Completion Time=2026-11-10 09:00
    // Đầu vào : runTime=2026-11-10 09:00
    // Mong đợi: Return: T1 not marked Overdue; T1 remains In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-11 A3 (Overdue only when Target Completion Time is exceeded); JOB-07
    [Fact(DisplayName = "BF02 UTC19 - Dung han 09:00: chua qua han, van In Progress")]
    public async Task UTC19_NotOverdueAtDeadline()
    {
        assignments.ResponsibleByLocation[L1] = Staff1;
        var deadline = new DateTimeOffset(2026, 11, 10, 9, 0, 0, Vn);
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1, dueAt: deadline);
        clock.Now = deadline;
        LoggedIn(Owner1, Roles.Owner);

        Assert.False(t1.IsOverdue(deadline));
        var view = await Tasks().GetAsync(t1.Id, default);
        Assert.False(view.IsOverdue);
        Assert.Equal(Norm("In Progress"), Norm(view.Status));
    }

    // UTC20 (Boundary) - sheet "BF-02 Staff Tasks", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Task T1 is In Progress, assigned to staff1; Target Completion Time=2026-11-10 09:00
    // Đầu vào : runTime=2026-11-10 09:01
    // Mong đợi: Return: T1 marked Overdue; original assignee, deadline and execution history preserved; staff1 and Owner notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-11 A3; UC-12 A4; JOB-07 Required Processing and Failure/Idempotency
    // Ghi chú : danh mục chữ ký không có job đánh dấu quá hạn và gửi thông báo (JOB-07), chỉ có cờ IsOverdue tính tại thời điểm đọc.
    //           Phần "staff1 and Owner notified" vì vậy không thực hiện được -> test báo Fail cho phần này.
    [Fact(DisplayName = "BF02 UTC20 - Qua han 1 phut (09:01): danh dau Overdue, bao staff1 va Owner")]
    public async Task UTC20_OverdueOneMinuteAfterDeadline()
    {
        assignments.ResponsibleByLocation[L1] = Staff1;
        var deadline = new DateTimeOffset(2026, 11, 10, 9, 0, 0, Vn);
        var t1 = ExistingTask(L1, MeterTaskStatus.InProgress, Staff1, dueAt: deadline);
        EarlierHistory(t1, "progress", "50% done");
        var runTime = deadline.AddMinutes(1);
        clock.Now = runTime;
        LoggedIn(Owner1, Roles.Owner);

        Assert.True(t1.IsOverdue(runTime));
        var view = await Tasks().GetAsync(t1.Id, default);
        Assert.True(view.IsOverdue);
        Assert.Equal(Staff1, t1.AssignedStaffUserId);
        Assert.Equal(deadline, view.DueAt);
        Assert.Contains(repository.Histories(t1.Id), h => h.Note == "50% done");
        Assert.Fail("Chưa tìm thấy chức năng markOverdueTasks (JOB-07) gửi thông báo quá hạn cho staff1 và Owner trong hệ thống (danh mục chữ ký)");
    }
}
