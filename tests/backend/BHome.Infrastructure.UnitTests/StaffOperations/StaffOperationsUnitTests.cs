using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.Operations;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using Microsoft.EntityFrameworkCore;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;
using static BHome.Infrastructure.UnitTests.Shared.IdentityArrange;

namespace BHome.Infrastructure.UnitTests.StaffOperations;

// Report 5.1 – sheet "StaffOperations" (UTC01–UTC32).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// Run only this sheet:  dotnet test --filter "Sheet=StaffOperations"   ·   one function:  --filter "Sheet=StaffOperations&Function=ActAsync"
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "StaffOperations")]
public sealed class StaffOperationsUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private static readonly Guid Sample1Id = Guid.Parse("c2400000-0000-4000-8000-000000000010"); // "BHOME SAMPLE 1"
    private static readonly Guid Sample2Id = Guid.Parse("c2400000-0000-4000-8000-000000000011"); // "BHOME SAMPLE 2"
    private static readonly Guid GoVapId = Guid.Parse("c2400000-0000-4000-8000-000000000012");   // "BHOME Go Vap"
    private static readonly Guid BinhLeId = Guid.Parse("bd110000-0000-4000-8000-000000000051");  // binhle@bhome.test (Le Van Binh)
    private static readonly TimeSpan Vn = TimeSpan.FromHours(7);
    private static readonly DateTimeOffset Today = new(2026, 11, 12, 9, 0, 0, Vn); // sheet "now" 2026-11-12 09:00 (UTC+7)
    private static readonly DateOnly Nov12 = new(2026, 11, 12);
    private static readonly DateOnly AssignedFrom = new(2026, 11, 1);
    private static readonly DateTimeOffset Nov13At17 = new(2026, 11, 13, 17, 0, 0, Vn);
    private const string WeeklyCheck = "Weekly fire extinguisher check";

    // Action names written on the sheet -> BHOME task action codes ("Accept" is the Owner verification).
    private static readonly Dictionary<string, string> Action = new()
    {
        ["Start"] = "start",
        ["Submit"] = "submit",
        ["Accept"] = "verify",
        ["Rework"] = "rework",
    };

    private AccountProvisioningWorld world = null!;
    private readonly FakeTaskEvidenceFiles evidenceFiles = new();

    public async Task InitializeAsync()
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres, Today);
        await world.AddOwnerSampleAsync();
        await world.ExecAsync(
            """
            insert into locations(id, name, address) values
              (@a, 'BHOME SAMPLE 1', 'Synthetic address'), (@b, 'BHOME SAMPLE 2', 'Synthetic address'), (@c, 'BHOME Go Vap', 'Synthetic address')
            """, ("a", Sample1Id), ("b", Sample2Id), ("c", GoVapId));
    }

    public async Task DisposeAsync() => await world.DisposeAsync();

    private ILocationAssignments Assignments => world.Get<ILocationAssignments>();
    private IOperationalTaskRepository TaskRepository => world.Get<IOperationalTaskRepository>();
    private IOperationsRepository OperationsRepository => world.Get<IOperationsRepository>();
    // The real Owner property service with its real lifecycle checks (built by hand: the test host has no IHostEnvironment
    // for the unrelated contract-readiness dependency).
    private PropertyService Property => new(world.Get<IPropertyRepository>(), world.CurrentUser, world.Get<PermissionAccess>(),
        world.Clock, lifecycle: world.Get<IPropertyLifecycleChecks>());

    // The real task service; only object storage for evidence photos is replaced (outside world).
    // Each call starts with an empty change tracker, as a new request would.
    private OperationalTaskService Tasks
    {
        get
        {
            world.Db.ChangeTracker.Clear();
            return new(TaskRepository, world.CurrentUser, world.Get<PermissionAccess>(), evidenceFiles, world.Get<TaskEvidenceLimits>(), world.Clock);
        }
    }

    // ----- pre-condition builders -----

    private Task AddStaff1Async() => world.AddUserAsync(Staff1Id, "staff1@gmail.com", Roles.Staff, "Staff123456@");
    private Task AddBinhLeAsync() => world.AddUserAsync(BinhLeId, "binhle@bhome.test", Roles.Staff, "Staff123456@");

    // "X is responsible for <Location>": assignment through the real Owner function, from 2026-11-01, no end date.
    private async Task<Guid> AssignAsync(Guid locationId, Guid staffId)
    {
        var result = await Assignments.CreateAssignmentAsync(OwnerId, locationId, staffId, AssignedFrom, DateOnly.MaxValue, default);
        Assert.Equal(CreateAssignmentStatus.Created, result.Status);
        return result.Assignment!.Id;
    }

    private async Task<Guid> AddTaskAsync(Guid locationId, string title, MeterTaskStatus status, Guid? staffId, Guid? assignmentId,
        DateTimeOffset? due = null, OperationalTaskPriority priority = OperationalTaskPriority.Normal, bool evidenceRequired = true)
    {
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = locationId,
            Title = title,
            Requirements = title,
            Priority = priority,
            DueAt = (due ?? Nov13At17).ToUniversalTime(),
            EvidenceRequired = evidenceRequired,
            AssignedStaffUserId = staffId,
            AssignmentId = assignmentId,
            AssignedAt = Today.ToUniversalTime(),
            Status = status,
        };
        await world.ReadAsync(async db => { db.Add(task); return await db.SaveChangesAsync(); });
        return task.Id;
    }

    // Task "Clean floor 2 corridor" (BHOME SAMPLE 1) assigned to staff.sample; Normal; target 2026-11-13 17:00; needs 1 photo.
    private async Task<Guid> CorridorTaskOfStaffSampleAsync(MeterTaskStatus status)
    {
        await world.AddStaffSampleAsync();
        var assignment = await AssignAsync(Sample1Id, StaffSampleId);
        return await AddTaskAsync(Sample1Id, "Clean floor 2 corridor", status, StaffSampleId, assignment);
    }

    private void SignInAsStaffSample() => world.CurrentUser.Set(StaffSampleId, Roles.Staff);

    // "Task is Pending Verification ("Cleaning done", 1 photo)": the Staff uploads the photo and submits through the real functions.
    private async Task<Guid> CorridorTaskPendingVerificationAsync()
    {
        var id = await CorridorTaskOfStaffSampleAsync(MeterTaskStatus.InProgress);
        SignInAsStaffSample();
        var photo = await UploadPhotoAsync(id);
        await Tasks.ActAsync(id, "submit", new TaskAction(await VersionAsync(id), "Cleaning done", [photo]), Guid.NewGuid(), default);
        world.SignInAsOwner();
        return id;
    }

    private async Task<Guid> UploadPhotoAsync(Guid taskId)
    {
        using var photo = new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]); // "corridor_done.jpg"
        return (await Tasks.UploadAsync(taskId, Guid.NewGuid(), photo, default)).Id;
    }

    private Task<int> VersionAsync(Guid taskId) => world.ScalarAsync<int>("select version from operational_tasks where id = @id", ("id", taskId));
    private Task<int> LocationVersionAsync(Guid locationId) => world.ScalarAsync<int>("select version from locations where id = @id", ("id", locationId));

    private Task<OperationalTask> StoredTaskAsync(Guid id) =>
        world.ReadAsync(db => db.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == id));

    private Task<int> TaskNoticeCountAsync(Guid recipient, string taskEvent) =>
        world.ReadAsync(db => db.Set<OperationalTaskNotification>().CountAsync(n => n.RecipientUserId == recipient && n.Event == taskEvent));

    private Task<long> LocationNoticeCountAsync(Guid recipient, Guid locationId, string type) => world.ScalarAsync<long>(
        "select count(*) from notifications where record_kind = 'INBOX' and recipient_user_id = @r and location_id = @l and notification_type = @t",
        ("r", recipient), ("l", locationId), ("t", type));

    // Log Message "Audit record with actor and time": the Location change history entry (no event name is defined in the SRS).
    private Task<long> LocationAuditCountAsync(Guid locationId, Guid actor) => world.ScalarAsync<long>(
        """
        select count(*) from locations l cross join lateral jsonb_array_elements(l.history) h
        where l.id = @l and (h->>'actorId')::uuid = @a and h->>'occurredAt' is not null
        """, ("l", locationId), ("a", actor));

    private async Task<string[]> AssignedLocationNamesAsync(Guid staffId, DateOnly date) =>
        (await Assignments.ListAssignedLocationsAsync(staffId, date, default)).Select(l => l.Name).Order().ToArray();

    private async Task<Guid?> ResponsibleAsync(Guid locationId) => (await TaskRepository.ResponsibilityAsync(locationId, Nov12, default))?.StaffUserId;

    private static async Task AssertForbidden(Func<Task> act)
    {
        var error = await Assert.ThrowsAnyAsync<Exception>(act);
        var status = error is UnauthorizedAccessException ? 403 : error.GetType().GetProperty("Status")?.GetValue(error);
        Assert.Equal(403, Convert.ToInt32(status));
    }

    // "Rejected": the call is refused (exception or a non-success status).
    private static async Task AssertNotChanged(Func<Task<ChangeAssignmentResult>> act)
    {
        ChangeAssignmentResult? result = null;
        try { result = await act(); } catch (Exception) { return; }
        Assert.NotEqual(ChangeAssignmentStatus.Changed, result.Status);
    }

    private static RecurringTaskTemplateWrite WeeklyFireCheck(Guid locationId) => new(
        LocationId: locationId, Title: WeeklyCheck, Requirements: WeeklyCheck, Priority: "Normal",
        EvidenceRequired: true, IntervalDays: 7,
        NextRunAt: new DateTimeOffset(2026, 11, 16, 0, 0, 0, Vn).ToUniversalTime(), // weekly, every Monday
        DueAfterHours: 17,                                                            // target time 17:00
        IsActive: true, ScheduleType: "Weekly", DayOfWeek: 1);

    private Task<long> RecurringTaskCountAsync(Guid locationId) => world.ScalarAsync<long>(
        "select count(*) from operational_tasks where location_id = @l and title = @t", ("l", locationId), ("t", WeeklyCheck));

    #region CreateAssignmentAsync(Guid createdByUserId, Guid locationId, Guid staffUserId, ...)

    [Fact(DisplayName = "UTC01 - CreateAssignmentAsync: Owner phan cong staff.sample cho BHOME Go Vap -> phu trach ca 2 co so, Staff duoc thong bao, co audit")]
    [Trait("Function", "CreateAssignmentAsync")]
    public async Task UTC01()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        world.SignInAsOwner();

        var result = await Assignments.CreateAssignmentAsync(OwnerId, GoVapId, StaffSampleId, Nov12, DateOnly.MaxValue, default);

        Assert.Equal(CreateAssignmentStatus.Created, result.Status);
        Assert.Equal(["BHOME Go Vap", "BHOME SAMPLE 1"], await AssignedLocationNamesAsync(StaffSampleId, Nov12));
        Assert.Equal(1, await LocationNoticeCountAsync(StaffSampleId, GoVapId, "STAFF_ASSIGNMENT_CHANGED"));
        Assert.True(await LocationAuditCountAsync(GoVapId, OwnerId) >= 1);
    }

    [Fact(DisplayName = "UTC02 - CreateAssignmentAsync: BHOME SAMPLE 1 da co staff.sample, them binhle -> tu choi, staff.sample van la nguoi duy nhat")]
    [Trait("Function", "CreateAssignmentAsync")]
    public async Task UTC02()
    {
        await world.AddStaffSampleAsync();
        await AddBinhLeAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        world.SignInAsOwner();

        var result = await Assignments.CreateAssignmentAsync(OwnerId, Sample1Id, BinhLeId, Nov12, DateOnly.MaxValue, default);

        Assert.NotEqual(CreateAssignmentStatus.Created, result.Status);
        var assignments = await Assignments.ListAssignmentsAsync(Sample1Id, default);
        Assert.Equal(StaffSampleId, Assert.Single(assignments!).StaffUserId);
        Assert.Empty(await AssignedLocationNamesAsync(BinhLeId, Nov12));
    }

    [Fact(DisplayName = "UTC03 - CreateAssignmentAsync: Staff tu phan cong BHOME Go Vap -> 403, Go Vap van chua co Staff")]
    [Trait("Function", "CreateAssignmentAsync")]
    public async Task UTC03()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        SignInAsStaffSample();

        await AssertForbidden(() => Assignments.CreateAssignmentAsync(StaffSampleId, GoVapId, StaffSampleId, Nov12, DateOnly.MaxValue, default));

        Assert.Empty((await Assignments.ListAssignmentsAsync(GoVapId, default))!);
    }

    #endregion

    #region StaffChangeAsync(Guid locationId)

    // "BHOME SAMPLE 2" tasks of staff1: "Clean floor 2 corridor" In Progress, "Check water pump" Assigned, ["Fix main gate lock" Completed].
    private async Task<(Guid Corridor, Guid Pump, Guid? GateLock)> Sample2TasksOfStaff1Async(bool withCompleted)
    {
        await AddStaff1Async();
        var assignment = await AssignAsync(Sample2Id, Staff1Id);
        var corridor = await AddTaskAsync(Sample2Id, "Clean floor 2 corridor", MeterTaskStatus.InProgress, Staff1Id, assignment);
        var pump = await AddTaskAsync(Sample2Id, "Check water pump", MeterTaskStatus.Assigned, Staff1Id, assignment);
        Guid? gateLock = withCompleted ? await AddTaskAsync(Sample2Id, "Fix main gate lock", MeterTaskStatus.Completed, Staff1Id, assignment) : null;
        return (corridor, pump, gateLock);
    }

    // StaffChangeAsync has no signed-in user input; it is called through the Owner entry point
    // PropertyService.StaffChangePreviewAsync, which checks the signed-in user and delegates with the same locationId.
    [Fact(DisplayName = "UTC04 - StaffChangeAsync: Owner xem truoc doi Staff BHOME SAMPLE 2 -> 2 task chua xong can chuyen, khong thay doi gi")]
    [Trait("Function", "StaffChangeAsync")]
    public async Task UTC04()
    {
        var (corridor, pump, gateLock) = await Sample2TasksOfStaff1Async(withCompleted: true);
        world.SignInAsOwner();
        var versionBefore = await LocationVersionAsync(Sample2Id);

        var preview = await Property.StaffChangePreviewAsync(Sample2Id, default);

        // The two unfinished tasks are listed; the Completed one is not.
        Assert.Equal(2, preview.OpenResponsibilities.Sum(r => r.Count));
        Assert.Equal(Staff1Id, await ResponsibleAsync(Sample2Id));
        Assert.Equal(versionBefore, await LocationVersionAsync(Sample2Id));
        foreach (var id in new[] { corridor, pump, gateLock!.Value })
            Assert.Equal(Staff1Id, (await StoredTaskAsync(id)).AssignedStaffUserId);
    }

    [Fact(DisplayName = "UTC05 - StaffChangeAsync: Staff staff1 xem truoc doi Staff -> 403, khong thay doi gi")]
    [Trait("Function", "StaffChangeAsync")]
    public async Task UTC05()
    {
        var (corridor, pump, _) = await Sample2TasksOfStaff1Async(withCompleted: false);
        world.CurrentUser.Set(Staff1Id, Roles.Staff);

        await AssertForbidden(() => Property.StaffChangePreviewAsync(Sample2Id, default));

        Assert.Equal(Staff1Id, await ResponsibleAsync(Sample2Id));
        Assert.Equal(MeterTaskStatus.InProgress, (await StoredTaskAsync(corridor)).Status);
        Assert.Equal(MeterTaskStatus.Assigned, (await StoredTaskAsync(pump)).Status);
    }

    #endregion

    #region ReplaceAssignmentAsync(Guid actorId, Guid locationId, Guid staffUserId, ...)

    [Fact(DisplayName = "UTC06 - ReplaceAssignmentAsync: Owner thay staff1 bang binhle tai BHOME SAMPLE 2 -> 2 task chua xong chuyen sang binhle, task da xong giu staff1")]
    [Trait("Function", "ReplaceAssignmentAsync")]
    public async Task UTC06()
    {
        var (corridor, pump, gateLock) = await Sample2TasksOfStaff1Async(withCompleted: true);
        await AddBinhLeAsync();
        world.SignInAsOwner();

        var result = await Assignments.ReplaceAssignmentAsync(OwnerId, Sample2Id, BinhLeId, Nov12,
            await LocationVersionAsync(Sample2Id), "Owner confirmed the replacement", default);

        Assert.Equal(ChangeAssignmentStatus.Changed, result.Status);
        Assert.Equal(BinhLeId, await ResponsibleAsync(Sample2Id));
        Assert.Empty(await AssignedLocationNamesAsync(Staff1Id, Nov12));
        Assert.Equal(BinhLeId, (await StoredTaskAsync(corridor)).AssignedStaffUserId);
        Assert.Equal(BinhLeId, (await StoredTaskAsync(pump)).AssignedStaffUserId);
        Assert.Equal(Staff1Id, (await StoredTaskAsync(gateLock!.Value)).AssignedStaffUserId);
        foreach (var id in new[] { corridor, pump })
            Assert.Contains((await TaskRepository.HistoryAsync(id, 1, 20, default)).Items, h => h.Action == "responsibility_changed" && h.ResponsibleStaffUserId == BinhLeId);
        Assert.True(await LocationNoticeCountAsync(Staff1Id, Sample2Id, "STAFF_ASSIGNMENT_CHANGED") >= 1);
        Assert.True(await LocationNoticeCountAsync(BinhLeId, Sample2Id, "STAFF_ASSIGNMENT_CHANGED") >= 1);
        Assert.True(await LocationAuditCountAsync(Sample2Id, OwnerId) >= 2); // initial assignment + replacement
    }

    [Fact(DisplayName = "UTC07 - ReplaceAssignmentAsync: thay bang staff.api.test dang Inactive -> tu choi, staff1 van phu trach")]
    [Trait("Function", "ReplaceAssignmentAsync")]
    public async Task UTC07()
    {
        await AddStaff1Async();
        await AssignAsync(Sample2Id, Staff1Id);
        await world.AddStaffApiTestAsync(active: false);
        world.SignInAsOwner();
        var version = await LocationVersionAsync(Sample2Id);

        await AssertNotChanged(() => Assignments.ReplaceAssignmentAsync(OwnerId, Sample2Id, StaffApiTestId, Nov12, version,
            "Owner confirmed the replacement", default));

        Assert.Equal(Staff1Id, await ResponsibleAsync(Sample2Id));
        Assert.Equal(version, await LocationVersionAsync(Sample2Id));
    }

    #endregion

    #region RemoveAssignmentAsync(Guid actorId, Guid locationId, DateOnly effectiveFrom, ...)

    [Fact(DisplayName = "UTC08 - RemoveAssignmentAsync: go staff.sample khoi BHOME SAMPLE 1 (khong co task do dang) -> khong con Staff phu trach, mat quyen truy cap, co audit")]
    [Trait("Function", "RemoveAssignmentAsync")]
    public async Task UTC08()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        world.SignInAsOwner();
        var auditBefore = await LocationAuditCountAsync(Sample1Id, OwnerId);

        var result = await Assignments.RemoveAssignmentAsync(OwnerId, Sample1Id, Nov12, await LocationVersionAsync(Sample1Id),
            "Owner removed the assignment", default);

        Assert.Equal(ChangeAssignmentStatus.Changed, result.Status);
        Assert.Null(await ResponsibleAsync(Sample1Id));
        Assert.False(await world.Get<IStaffLocationAccess>().IsAssignedAsync(StaffSampleId, Sample1Id, default));
        Assert.True(await LocationAuditCountAsync(Sample1Id, OwnerId) > auditBefore);
    }

    [Fact(DisplayName = "UTC09 - RemoveAssignmentAsync: staff1 con task 'Clean floor 2 corridor' In Progress -> tu choi, staff1 van phu trach, task khong doi")]
    [Trait("Function", "RemoveAssignmentAsync")]
    public async Task UTC09()
    {
        await AddStaff1Async();
        var assignment = await AssignAsync(Sample2Id, Staff1Id);
        var corridor = await AddTaskAsync(Sample2Id, "Clean floor 2 corridor", MeterTaskStatus.InProgress, Staff1Id, assignment);
        world.SignInAsOwner();

        await AssertNotChanged(async () => await Assignments.RemoveAssignmentAsync(OwnerId, Sample2Id, Nov12,
            await LocationVersionAsync(Sample2Id), "Owner removed the assignment", default));

        Assert.Equal(Staff1Id, await ResponsibleAsync(Sample2Id));
        var task = await StoredTaskAsync(corridor);
        Assert.Equal((MeterTaskStatus.InProgress, (Guid?)Staff1Id), (task.Status, task.AssignedStaffUserId));
    }

    #endregion

    #region ListAssignedLocationsAsync(Guid staffUserId, DateOnly effectiveDate, ...)

    [Fact(DisplayName = "UTC10 - ListAssignedLocationsAsync: staff.sample phu trach SAMPLE 1 va Go Vap -> 2 co so, khong co SAMPLE 2")]
    [Trait("Function", "ListAssignedLocationsAsync")]
    public async Task UTC10()
    {
        await world.AddStaffSampleAsync();
        await AddStaff1Async();
        await AssignAsync(Sample1Id, StaffSampleId);
        await AssignAsync(GoVapId, StaffSampleId);
        await AssignAsync(Sample2Id, Staff1Id);

        var names = await AssignedLocationNamesAsync(StaffSampleId, Nov12);

        // The sheet does not define an order; compared as a set.
        Assert.Equal(new[] { "BHOME SAMPLE 1", "BHOME Go Vap" }.Order(), names);
    }

    [Fact(DisplayName = "UTC11 - ListAssignedLocationsAsync: Owner da go staff.sample khoi SAMPLE 1 tu 2026-11-12 -> chi con Go Vap")]
    [Trait("Function", "ListAssignedLocationsAsync")]
    public async Task UTC11()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        await AssignAsync(GoVapId, StaffSampleId);
        var removed = await Assignments.RemoveAssignmentAsync(OwnerId, Sample1Id, Nov12, await LocationVersionAsync(Sample1Id),
            "Owner removed the assignment", default);
        Assert.Equal(ChangeAssignmentStatus.Changed, removed.Status);

        var names = await AssignedLocationNamesAsync(StaffSampleId, Nov12);

        Assert.Equal(["BHOME Go Vap"], names);
    }

    #endregion

    #region ResponsibilityAsync(Guid locationId, DateOnly date)

    [Fact(DisplayName = "UTC12 - ResponsibilityAsync: BHOME SAMPLE 1 co staff.sample dang hoat dong -> staff.sample")]
    [Trait("Function", "ResponsibilityAsync")]
    public async Task UTC12()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);

        var responsible = await TaskRepository.ResponsibilityAsync(Sample1Id, Nov12, default);

        Assert.Equal(StaffSampleId, responsible?.StaffUserId);
    }

    [Fact(DisplayName = "UTC13 - ResponsibilityAsync: BHOME Go Vap chua co Staff -> rong")]
    [Trait("Function", "ResponsibilityAsync")]
    public async Task UTC13()
    {
        var responsible = await TaskRepository.ResponsibilityAsync(GoVapId, Nov12, default);

        Assert.Null(responsible);
    }

    #endregion

    #region ActAsync(Guid id, string action, TaskAction input, Guid key)

    [Fact(DisplayName = "UTC14 - ActAsync: Staff Start task Assigned -> In Progress")]
    [Trait("Function", "ActAsync")]
    public async Task UTC14()
    {
        var id = await CorridorTaskOfStaffSampleAsync(MeterTaskStatus.Assigned);
        SignInAsStaffSample();

        var view = await Tasks.ActAsync(id, Action["Start"], new TaskAction(await VersionAsync(id)),
            Guid.Parse("5e1f0c3a-0000-4000-8000-000000000001"), default);

        Assert.Equal(nameof(MeterTaskStatus.InProgress), view.Status);
        Assert.Equal(MeterTaskStatus.InProgress, (await StoredTaskAsync(id)).Status);
    }

    [Fact(DisplayName = "UTC15 - ActAsync: Staff Submit 'Cleaning done' kem 1 anh -> Pending Verification, Owner duoc thong bao")]
    [Trait("Function", "ActAsync")]
    public async Task UTC15()
    {
        var id = await CorridorTaskOfStaffSampleAsync(MeterTaskStatus.InProgress);
        SignInAsStaffSample();
        var photo = await UploadPhotoAsync(id);

        var view = await Tasks.ActAsync(id, Action["Submit"], new TaskAction(await VersionAsync(id), "Cleaning done", [photo]),
            Guid.Parse("5e1f0c3a-0000-4000-8000-000000000005"), default);

        Assert.Equal(nameof(MeterTaskStatus.PendingVerification), view.Status);
        var stored = await StoredTaskAsync(id);
        Assert.Equal((MeterTaskStatus.PendingVerification, "Cleaning done"), (stored.Status, stored.Result));
        Assert.Contains(await TaskRepository.EvidenceAsync(id, default), e => e.Id == photo && e.SubmissionId != null);
        Assert.Equal(1, await TaskNoticeCountAsync(OwnerId, "submit"));
    }

    [Fact(DisplayName = "UTC16 - ActAsync: Owner Accept task Pending Verification luc 16:00 -> Completed, nguoi xac nhan Owner, giu lich su")]
    [Trait("Function", "ActAsync")]
    public async Task UTC16()
    {
        var id = await CorridorTaskPendingVerificationAsync();
        var now = new DateTimeOffset(2026, 11, 12, 16, 0, 0, Vn);
        world.Clock.SetUtcNow(now.ToUniversalTime());

        var view = await Tasks.ActAsync(id, Action["Accept"], new TaskAction(await VersionAsync(id)),
            Guid.Parse("5e1f0c3a-0000-4000-8000-000000000008"), default);

        Assert.Equal(nameof(MeterTaskStatus.Completed), view.Status);
        var stored = await StoredTaskAsync(id);
        Assert.Equal((MeterTaskStatus.Completed, (Guid?)OwnerId, (DateTimeOffset?)now), (stored.Status, stored.VerifiedByUserId, stored.VerifiedAt));
        Assert.Equal(StaffSampleId, stored.AssignedStaffUserId);
        var history = (await TaskRepository.HistoryAsync(id, 1, 20, default)).Items.Select(h => h.Action).ToArray();
        Assert.Contains("evidence_uploaded", history);
        Assert.Contains("submit", history);
        Assert.Contains("verify", history);
        Assert.Single(await TaskRepository.EvidenceAsync(id, default));
    }

    [Fact(DisplayName = "UTC17 - ActAsync: Owner Rework kem ly do -> In Progress, luu ly do, Staff duoc thong bao")]
    [Trait("Function", "ActAsync")]
    public async Task UTC17()
    {
        var id = await CorridorTaskPendingVerificationAsync();

        var view = await Tasks.ActAsync(id, Action["Rework"], new TaskAction(await VersionAsync(id), "Floor near the stairs is still dirty"),
            Guid.Parse("5e1f0c3a-0000-4000-8000-000000000010"), default);

        Assert.Equal(nameof(MeterTaskStatus.InProgress), view.Status);
        Assert.Contains((await TaskRepository.HistoryAsync(id, 1, 20, default)).Items,
            h => h.Action == "rework" && h.Note == "Floor near the stairs is still dirty");
        Assert.Equal(1, await TaskNoticeCountAsync(StaffSampleId, "rework"));
    }

    [Fact(DisplayName = "UTC18 - ActAsync: Staff Submit khong co anh bat buoc -> khong nop, van In Progress, Owner khong duoc thong bao")]
    [Trait("Function", "ActAsync")]
    public async Task UTC18()
    {
        var id = await CorridorTaskOfStaffSampleAsync(MeterTaskStatus.InProgress);
        SignInAsStaffSample();

        await Assert.ThrowsAnyAsync<Exception>(async () => await Tasks.ActAsync(id, Action["Submit"],
            new TaskAction(await VersionAsync(id), "Cleaning done", []), Guid.Parse("5e1f0c3a-0000-4000-8000-000000000020"), default));

        Assert.Equal(MeterTaskStatus.InProgress, (await StoredTaskAsync(id)).Status);
        Assert.Equal(0, await TaskNoticeCountAsync(OwnerId, "submit"));
    }

    [Fact(DisplayName = "UTC19 - ActAsync: Staff Accept task cua minh -> 403, van In Progress")]
    [Trait("Function", "ActAsync")]
    public async Task UTC19()
    {
        var id = await CorridorTaskOfStaffSampleAsync(MeterTaskStatus.InProgress);
        SignInAsStaffSample();

        await AssertForbidden(async () => await Tasks.ActAsync(id, Action["Accept"], new TaskAction(await VersionAsync(id)),
            Guid.Parse("5e1f0c3a-0000-4000-8000-000000000021"), default));

        Assert.Equal(MeterTaskStatus.InProgress, (await StoredTaskAsync(id)).Status);
    }

    [Fact(DisplayName = "UTC20 - ActAsync: Owner Rework voi ly do rong -> tu choi, van Pending Verification, Staff khong duoc thong bao")]
    [Trait("Function", "ActAsync")]
    public async Task UTC20()
    {
        var id = await CorridorTaskPendingVerificationAsync();

        await Assert.ThrowsAnyAsync<Exception>(async () => await Tasks.ActAsync(id, Action["Rework"], new TaskAction(await VersionAsync(id), ""),
            Guid.Parse("5e1f0c3a-0000-4000-8000-000000000022"), default));

        Assert.Equal(MeterTaskStatus.PendingVerification, (await StoredTaskAsync(id)).Status);
        Assert.Equal(0, await TaskNoticeCountAsync(StaffSampleId, "rework"));
    }

    #endregion

    #region UpdateAsync(Guid id, TaskUpdate input, Guid key)

    // Task "Fix water pump" (BHOME SAMPLE 1) In Progress for staff.sample; Normal; target 2026-11-14 17:00.
    private static readonly DateTimeOffset Nov14At17 = new(2026, 11, 14, 17, 0, 0, Vn);

    private async Task<Guid> FixWaterPumpAsync()
    {
        await world.AddStaffSampleAsync();
        var assignment = await AssignAsync(Sample1Id, StaffSampleId);
        return await AddTaskAsync(Sample1Id, "Fix water pump", MeterTaskStatus.InProgress, StaffSampleId, assignment, Nov14At17, evidenceRequired: false);
    }

    // The sheet gives no change reason; the product requires one, so a synthetic reason is used.
    private async Task<TaskUpdate> HighPriorityUpdateAsync(Guid id, DateTimeOffset target) =>
        new(await VersionAsync(id), new TaskWrite("Fix water pump", "Fix water pump", OperationalTaskPriority.High, target, false),
            "Owner raised priority and moved the target");

    [Fact(DisplayName = "UTC21 - UpdateAsync: Owner doi Priority High, target 2026-11-13 12:00 -> cap nhat, giu gia tri cu trong lich su, Staff duoc thong bao")]
    [Trait("Function", "UpdateAsync")]
    public async Task UTC21()
    {
        var id = await FixWaterPumpAsync();
        world.SignInAsOwner();
        var target = new DateTimeOffset(2026, 11, 13, 12, 0, 0, Vn);

        var view = await Tasks.UpdateAsync(id, await HighPriorityUpdateAsync(id, target), Guid.Parse("5e1f0c3a-0000-4000-8000-000000000014"), default);

        Assert.Equal((nameof(OperationalTaskPriority.High), (DateTimeOffset?)target), (view.Priority, view.DueAt));
        var stored = await StoredTaskAsync(id);
        Assert.Equal((OperationalTaskPriority.High, (DateTimeOffset?)target), (stored.Priority, stored.DueAt));
        var updated = Assert.Single((await TaskRepository.HistoryAsync(id, 1, 20, default)).Items, h => h.Action == "updated");
        using var changes = JsonDocument.Parse(updated.ChangesJson);
        var before = changes.RootElement.GetProperty("Before");
        Assert.Equal((int)OperationalTaskPriority.Normal, before.GetProperty("Priority").GetInt32());
        Assert.Equal(Nov14At17, before.GetProperty("DueAt").GetDateTimeOffset());
        Assert.Equal(1, await TaskNoticeCountAsync(StaffSampleId, "updated"));
    }

    [Fact(DisplayName = "UTC22 - UpdateAsync: Staff tu doi Priority/target -> 403, khong doi")]
    [Trait("Function", "UpdateAsync")]
    public async Task UTC22()
    {
        var id = await FixWaterPumpAsync();
        SignInAsStaffSample();
        var update = await HighPriorityUpdateAsync(id, new DateTimeOffset(2026, 11, 20, 12, 0, 0, Vn));

        await AssertForbidden(() => Tasks.UpdateAsync(id, update, Guid.Parse("5e1f0c3a-0000-4000-8000-000000000023"), default));

        var stored = await StoredTaskAsync(id);
        Assert.Equal((OperationalTaskPriority.Normal, (DateTimeOffset?)Nov14At17), (stored.Priority, stored.DueAt));
    }

    #endregion

    #region ListAsync(TaskQuery query, Guid? staffId, DateOnly date, DateTimeOffset now)

    [Fact(DisplayName = "UTC23 - ListAsync: staff.sample xem danh sach -> chi 2 task cua BHOME SAMPLE 1")]
    [Trait("Function", "ListAsync")]
    public async Task UTC23()
    {
        await world.AddStaffSampleAsync();
        await AddStaff1Async();
        var sample1 = await AssignAsync(Sample1Id, StaffSampleId);
        var sample2 = await AssignAsync(Sample2Id, Staff1Id);
        await AddTaskAsync(Sample1Id, "Clean floor 2 corridor", MeterTaskStatus.Assigned, StaffSampleId, sample1);
        await AddTaskAsync(Sample1Id, "Fix water pump", MeterTaskStatus.InProgress, StaffSampleId, sample1, Nov14At17);
        await AddTaskAsync(Sample2Id, "Check water pump", MeterTaskStatus.Assigned, Staff1Id, sample2);

        var page = await TaskRepository.ListAsync(new TaskQuery { Page = 1, PageSize = 20 }, StaffSampleId, Nov12, Today, default);

        Assert.Equal(["Clean floor 2 corridor", "Fix water pump"], page.Items.Select(t => t.Title).Order().ToArray());
    }

    [Fact(DisplayName = "UTC24 - ListAsync: task In Progress han 2026-11-10 09:00, bay gio 09:01 -> Overdue, nguoi lam va han khong doi")]
    [Trait("Function", "ListAsync")]
    public async Task UTC24()
    {
        await world.AddStaffSampleAsync();
        var assignment = await AssignAsync(Sample1Id, StaffSampleId);
        var target = new DateTimeOffset(2026, 11, 10, 9, 0, 0, Vn);
        var id = await AddTaskAsync(Sample1Id, "Replace corridor light bulbs", MeterTaskStatus.InProgress, StaffSampleId, assignment, target);
        var historyBefore = (await TaskRepository.HistoryAsync(id, 1, 20, default)).TotalCount;

        var page = await TaskRepository.ListAsync(new TaskQuery { Page = 1, PageSize = 20 }, StaffSampleId,
            new DateOnly(2026, 11, 10), new DateTimeOffset(2026, 11, 10, 9, 1, 0, Vn), default);

        var item = Assert.Single(page.Items);
        Assert.True(item.IsOverdue);
        Assert.Equal(((Guid?)StaffSampleId, (DateTimeOffset?)target), (item.RecordedStaffUserId, item.DueAt));
        var stored = await StoredTaskAsync(id);
        Assert.Equal(((Guid?)StaffSampleId, (DateTimeOffset?)target), (stored.AssignedStaffUserId, stored.DueAt));
        Assert.Equal(historyBefore, (await TaskRepository.HistoryAsync(id, 1, 20, default)).TotalCount);
    }

    [Fact(DisplayName = "UTC25 - ListAsync: binhle khong co Location, khong co task -> danh sach rong")]
    [Trait("Function", "ListAsync")]
    public async Task UTC25()
    {
        await world.AddStaffSampleAsync();
        await AddStaff1Async();
        await AddBinhLeAsync();
        await AddTaskAsync(Sample1Id, "Clean floor 2 corridor", MeterTaskStatus.Assigned, StaffSampleId, await AssignAsync(Sample1Id, StaffSampleId));
        await AddTaskAsync(Sample2Id, "Check water pump", MeterTaskStatus.Assigned, Staff1Id, await AssignAsync(Sample2Id, Staff1Id));
        world.CurrentUser.Set(BinhLeId, Roles.Staff);

        var page = await TaskRepository.ListAsync(new TaskQuery { Page = 1, PageSize = 20 }, BinhLeId, Nov12, Today, default);

        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
    }

    #endregion

    #region HistoryAsync(Guid taskId, int page, int size)

    // HistoryAsync has no signed-in user input; it is called through OperationalTaskService.HistoryAsync,
    // which checks the signed-in user's scope and delegates to the repository with the same taskId/page/size.

    [Fact(DisplayName = "UTC26 - HistoryAsync: task co ghi chu cua staff1 roi duoc Owner chuyen sang binhle -> lich su co ca hai")]
    [Trait("Function", "HistoryAsync")]
    public async Task UTC26()
    {
        await AddStaff1Async();
        await AddBinhLeAsync();
        var assignment = await AssignAsync(Sample2Id, Staff1Id);
        var id = await AddTaskAsync(Sample2Id, "Clean floor 2 corridor", MeterTaskStatus.InProgress, Staff1Id, assignment);
        world.CurrentUser.Set(Staff1Id, Roles.Staff);
        await Tasks.ActAsync(id, "progress", new TaskAction(await VersionAsync(id), "Cleaned half of the corridor"), Guid.NewGuid(), default);
        world.SignInAsOwner();
        var replaced = await Assignments.ReplaceAssignmentAsync(OwnerId, Sample2Id, BinhLeId, Nov12, await LocationVersionAsync(Sample2Id),
            "Owner confirmed the replacement", default);
        Assert.Equal(ChangeAssignmentStatus.Changed, replaced.Status);

        var history = await Tasks.HistoryAsync(id, 1, 20, default);

        Assert.Contains(history.Items, h => h.ActorId == Staff1Id && h.Action == "progress" && h.Note == "Cleaned half of the corridor");
        var reassigned = Assert.Single(history.Items, h => h.ActorId == OwnerId && h.ResponsibleStaffUserId == BinhLeId);
        using var changes = JsonDocument.Parse(reassigned.ChangesJson);
        Assert.Equal(Staff1Id, changes.RootElement.GetProperty("previous").GetGuid());
        Assert.Equal(BinhLeId, changes.RootElement.GetProperty("next").GetGuid());
        Assert.Equal(Today, reassigned.OccurredAt);
    }

    [Fact(DisplayName = "UTC27 - HistoryAsync: staff.sample xem lich su task cua BHOME SAMPLE 2 -> tu choi (ngoai pham vi), khong tra lich su")]
    [Trait("Function", "HistoryAsync")]
    public async Task UTC27()
    {
        await world.AddStaffSampleAsync();
        await AddStaff1Async();
        await AssignAsync(Sample1Id, StaffSampleId);
        var pump = await AddTaskAsync(Sample2Id, "Check water pump", MeterTaskStatus.Assigned, Staff1Id, await AssignAsync(Sample2Id, Staff1Id));
        SignInAsStaffSample();

        TaskPage<TaskHistoryView>? history = null;
        await Assert.ThrowsAnyAsync<Exception>(async () => history = await Tasks.HistoryAsync(pump, 1, 20, default));

        Assert.Null(history);
    }

    #endregion

    #region SaveTemplateAsync(Guid actorId, Guid? id, RecurringTaskTemplateWrite input, ...)

    [Fact(DisplayName = "UTC28 - SaveTemplateAsync: Owner tao viec dinh ky hang tuan thu Hai cho BHOME SAMPLE 1 -> da luu")]
    [Trait("Function", "SaveTemplateAsync")]
    public async Task UTC28()
    {
        world.SignInAsOwner();

        var saved = await OperationsRepository.SaveTemplateAsync(OwnerId, null, WeeklyFireCheck(Sample1Id), world.Clock.GetUtcNow(), default);

        var stored = Assert.Single(await OperationsRepository.TemplatesAsync(Sample1Id, default));
        Assert.Equal(saved.Id, stored.Id);
        Assert.Equal((Sample1Id, WeeklyCheck, "Weekly", (int?)1), (stored.LocationId, stored.Title, stored.ScheduleType, stored.DayOfWeek));
    }

    [Fact(DisplayName = "UTC29 - SaveTemplateAsync: Staff tao viec dinh ky -> 403, khong tao")]
    [Trait("Function", "SaveTemplateAsync")]
    public async Task UTC29()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        SignInAsStaffSample();

        await AssertForbidden(() => OperationsRepository.SaveTemplateAsync(StaffSampleId, null, WeeklyFireCheck(Sample1Id), world.Clock.GetUtcNow(), default));

        Assert.Empty(await OperationsRepository.TemplatesAsync(Sample1Id, default));
    }

    #endregion

    #region GenerateDueRecurringTasksAsync(DateTimeOffset now)

    private static readonly DateTimeOffset Nov16At06 = new(2026, 11, 16, 6, 0, 0, Vn);

    private async Task WeeklyCheckForSample1Async()
    {
        await world.AddStaffSampleAsync();
        await AssignAsync(Sample1Id, StaffSampleId);
        await OperationsRepository.SaveTemplateAsync(OwnerId, null, WeeklyFireCheck(Sample1Id), world.Clock.GetUtcNow(), default);
    }

    private Task<long> TaskAssignedNoticeCountAsync(Guid recipient) => world.ScalarAsync<long>(
        "select count(*) from notifications where record_kind = 'INBOX' and recipient_user_id = @r and notification_type = 'TASK_ASSIGNED'",
        ("r", recipient));

    [Fact(DisplayName = "UTC30 - GenerateDueRecurringTasksAsync: thu Hai 2026-11-16 06:00 -> 1 task, han 17:00, giao staff.sample")]
    [Trait("Function", "GenerateDueRecurringTasksAsync")]
    public async Task UTC30()
    {
        await WeeklyCheckForSample1Async();

        var created = await OperationsRepository.GenerateDueRecurringTasksAsync(Nov16At06.ToUniversalTime(), default);

        Assert.Equal(1, created);
        Assert.Equal(1, await RecurringTaskCountAsync(Sample1Id));
        var due = await world.ScalarAsync<DateTime>("select due_at from operational_tasks where location_id = @l and title = @t", ("l", Sample1Id), ("t", WeeklyCheck));
        Assert.Equal(new DateTimeOffset(2026, 11, 16, 17, 0, 0, Vn), new DateTimeOffset(DateTime.SpecifyKind(due, DateTimeKind.Utc)));
        Assert.Equal(StaffSampleId, await world.ScalarAsync<Guid>("select assigned_user_id from operational_tasks where location_id = @l and title = @t",
            ("l", Sample1Id), ("t", WeeklyCheck)));
    }

    [Fact(DisplayName = "UTC31 - GenerateDueRecurringTasksAsync: chay lai luc 06:05 -> 0, khong trung task, khong thong bao lai")]
    [Trait("Function", "GenerateDueRecurringTasksAsync")]
    public async Task UTC31()
    {
        await WeeklyCheckForSample1Async();
        await OperationsRepository.GenerateDueRecurringTasksAsync(Nov16At06.ToUniversalTime(), default); // earlier run
        var noticesBefore = await TaskAssignedNoticeCountAsync(StaffSampleId);

        var created = await OperationsRepository.GenerateDueRecurringTasksAsync(new DateTimeOffset(2026, 11, 16, 6, 5, 0, Vn).ToUniversalTime(), default);

        Assert.Equal(0, created);
        Assert.Equal(1, await RecurringTaskCountAsync(Sample1Id));
        Assert.Equal(noticesBefore, await TaskAssignedNoticeCountAsync(StaffSampleId));
    }

    [Fact(DisplayName = "UTC32 - GenerateDueRecurringTasksAsync: BHOME Go Vap chua co Staff -> tao task chua giao, khong thong bao ai")]
    [Trait("Function", "GenerateDueRecurringTasksAsync")]
    public async Task UTC32()
    {
        await OperationsRepository.SaveTemplateAsync(OwnerId, null, WeeklyFireCheck(GoVapId), world.Clock.GetUtcNow(), default);

        var created = await OperationsRepository.GenerateDueRecurringTasksAsync(Nov16At06.ToUniversalTime(), default);

        Assert.Equal(1, created);
        Assert.Equal(1, await RecurringTaskCountAsync(GoVapId));
        Assert.True(await world.ScalarAsync<bool>("select assigned_user_id is null from operational_tasks where location_id = @l and title = @t",
            ("l", GoVapId), ("t", WeeklyCheck)));
        Assert.Equal(0, await world.ScalarAsync<long>("select count(*) from notifications where record_kind = 'INBOX' and notification_type = 'TASK_ASSIGNED'"));
    }

    #endregion
}

// Outside world: private object storage for task evidence photos.
internal sealed class FakeTaskEvidenceFiles : ITaskEvidenceFiles
{
    private readonly HashSet<string> stored = [];
    public string Validate(byte[] content, int maximumBytes) => "image/jpeg";
    public Task PutAsync(Guid taskId, string key, byte[] content, string contentType, CancellationToken t)
    {
        stored.Add(key);
        return Task.CompletedTask;
    }
    public Task CopyAsync(string key, Stream output, CancellationToken t) =>
        stored.Contains(key) ? Task.CompletedTask : throw new FileNotFoundException(key);
}
