using BHome.Application.IdentityAccess;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using NSubstitute;
using System.Text.Json;

namespace BHome.Application.UnitTests.StaffOperations;

public sealed class OperationalTaskServiceTests
{
    private sealed class Clock : TimeProvider
    { public DateTimeOffset Now { get; set; } = new(2026, 10, 30, 18, 0, 0, TimeSpan.Zero); public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class User : ICurrentUser
    {
        public Guid? UserId { get; set; } = Guid.NewGuid(); public string Role { get; set; } = Roles.Owner;
        public bool IsInRole(string role) => role == Role;
    }
    private sealed class Rig
    {
        public readonly User User = new(); public readonly Clock Clock = new();
        public readonly IOperationalTaskRepository Repo = Substitute.For<IOperationalTaskRepository>();
        public readonly ITaskEvidenceFiles Files = Substitute.For<ITaskEvidenceFiles>();
        public readonly List<object> Added = [];
        public readonly Guid Location = Guid.NewGuid(); public readonly Guid Staff = Guid.NewGuid();
        public TaskResponsibility? Responsibility { get; set; }
        public OperationalTaskService Service { get; }
        public Rig()
        {
            Responsibility = new(Guid.NewGuid(), Staff);
            Repo.LocationAsync(default, default).ReturnsForAnyArgs(c => new TaskLocation(c.Arg<Guid>(), true));
            Repo.ResponsibilityAsync(default, default, default).ReturnsForAnyArgs(_ => Responsibility);
            Repo.FindAsync(default, default).ReturnsForAnyArgs(c => Added.OfType<OperationalTask>().SingleOrDefault(x => x.Id == c.Arg<Guid>()));
            Repo.OwnerConfirmedInventoryAsync(default!, default).ReturnsForAnyArgs(c =>
                JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(c.Arg<OperationalTask>().LocationAssetInventoryJson)!);
            Repo.CommandAsync(default, default, default).ReturnsForAnyArgs(c => Added.OfType<OperationalTaskCommand>().SingleOrDefault(x => x.ActorId == c.ArgAt<Guid>(0) && x.Key == c.ArgAt<Guid>(1)));
            Repo.EvidenceAsync(default, default).ReturnsForAnyArgs(c => (IReadOnlyList<OperationalTaskEvidence>)Added.OfType<OperationalTaskEvidence>().Where(x => x.TaskId == c.Arg<Guid>()).ToArray());
            Repo.OwnersAsync(default).ReturnsForAnyArgs(new[] { User.UserId!.Value });
            Repo.TransactionAsync(default, default, default, default(Func<Task<TaskView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<TaskView>>>()());
            Repo.TransactionAsync(default, default, default, default(Func<Task<LocationAssetInventoryView>>)!, default)
                .ReturnsForAnyArgs(c => c.Arg<Func<Task<LocationAssetInventoryView>>>()());
            Repo.TransactionAsync(default, default, default, default(Func<Task<TaskEvidenceView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<TaskEvidenceView>>>()());
            Repo.When(x => x.Add(Arg.Any<object>())).Do(c => Added.Add(c.Arg<object>()));
            Files.Validate(default!, default).ReturnsForAnyArgs("image/png");
            Service = new(Repo, User, new PermissionAccess(User, new ResourceAccess(User, Substitute.For<IStaffLocationAccess>())), Files,
                new TaskEvidenceLimits { MaximumFileBytes = 1024, MaximumFilesPerTask = 2 }, Clock);
        }
        public TaskWrite Work => new("Synthetic task", "Synthetic requirement", OperationalTaskPriority.Normal, Clock.Now.AddDays(1), true);
        public async Task<TaskView> Create() => await Service.CreateAsync(new(Location, Work), Guid.NewGuid(), default);
        public void AsStaff() { User.Role = Roles.Staff; User.UserId = Staff; }
    }

    [Fact]
    public void OwnerConfirmedAssetUnitIsPartOfTheImmutableBaseline()
    {
        var item = new LocationAssetInventoryItem(Guid.NewGuid(), Guid.NewGuid(), "P.101",
            Guid.NewGuid(), "Giường đơn", 2, null)
        { Unit = "chiếc", UnitCaptured = true };

        Assert.True(LocationAssetInventorySync.SameOwnerItem(item, item with { Unit = " CHIẾC " }));
        Assert.False(LocationAssetInventorySync.SameOwnerItem(item, item with { Unit = "bộ" }));
        Assert.True(LocationAssetInventorySync.SameOwnerItem(item with { Unit = null }, item with { Unit = " " }));
        Assert.True(LocationAssetInventorySync.SameOwnerItem(
            item with { Unit = null, UnitCaptured = false }, item));

        var assignment = Guid.NewGuid();
        var legacy = item with
        {
            Unit = null,
            UnitCaptured = false,
            Checked = true,
            Condition = "Intact",
            Note = "Đã kiểm tra trực tiếp"
        };
        var current = new LocationAssetInventorySnapshot(assignment, new DateOnly(2026, 11, 1), [legacy]);
        var confirmed = new LocationAssetInventorySnapshot(assignment, new DateOnly(2026, 11, 1), [item]);
        Assert.True(LocationAssetInventorySync.TryMerge(current, confirmed, out var merged));
        Assert.Equal("chiếc", merged.Items.Single().Unit);
        Assert.True(merged.Items.Single().UnitCaptured);
        Assert.True(merged.Items.Single().Checked);
        Assert.Equal("Intact", merged.Items.Single().Condition);
        Assert.Equal("Đã kiểm tra trực tiếp", merged.Items.Single().Note);
    }

    [Fact]
    public async Task CreateRoutesFromTrustedResponsibilityAndReplayHasNoDuplicateEffect()
    {
        var r = new Rig(); var key = Guid.NewGuid(); var input = new TaskCreate(r.Location, r.Work);
        var first = await r.Service.CreateAsync(input, key, default);
        var replay = await r.Service.CreateAsync(input, key, default);
        Assert.Equal(first, replay); Assert.Equal(r.Staff, first.CurrentResponsibleStaffUserId);
        Assert.Single(r.Added.OfType<OperationalTask>()); Assert.Single(r.Added.OfType<OperationalTaskNotification>());
        Assert.Equal("idempotency_conflict", (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.CreateAsync(input with { Work = r.Work with { Title = "different" } }, key, default))).Code);
        Assert.Equal(new DateOnly(2026, 10, 31), r.Repo.ReceivedCalls().First(c => c.GetMethodInfo().Name == nameof(IOperationalTaskRepository.ResponsibilityAsync)).GetArguments()[1]);
    }
    [Fact]
    public async Task TargetsAreValidatedAndPersistedWithoutChangingLocationResponsibility()
    {
        var r = new Rig(); var room = Guid.NewGuid(); var asset = Guid.NewGuid();
        r.Repo.TargetRoomNameAsync(r.Location, room, default).Returns("P.101");
        r.Repo.TargetAssetAsync(r.Location, asset, default).Returns(new TaskTargetOption(asset, "Điều hòa", room, null));
        var work = r.Work with { Target = new(room, asset) };
        var created = await r.Service.CreateAsync(new(r.Location, work), Guid.NewGuid(), default);
        Assert.Equal(new TaskTargetView(room, asset, null, "P.101 · Điều hòa"), created.Target);
        Assert.Equal(r.Staff, created.CurrentResponsibleStaffUserId);
        // An older client that edits the work without a target must retain it.
        var updated = await r.Service.UpdateAsync(created.Id, new(created.Version, r.Work, "Synthetic edit"), Guid.NewGuid(), default);
        Assert.Equal(created.Target, updated.Target);
        var cleared = await r.Service.UpdateAsync(created.Id, new(updated.Version, r.Work with { Target = new() }, "Clear target"), Guid.NewGuid(), default);
        Assert.Null(cleared.Target);
    }
    [Fact]
    public async Task TargetsCannotEscapeTheirLocationOrSelectedPosition()
    {
        var r = new Rig(); var room = Guid.NewGuid(); var asset = Guid.NewGuid();
        r.Repo.TargetRoomNameAsync(r.Location, room, default).Returns("P.101");
        r.Repo.TargetAssetAsync(r.Location, asset, default).Returns(new TaskTargetOption(asset, "Camera", null, "Sân"));
        r.Repo.CommonAreasAsync(r.Location, default).Returns(new[] { "Sân" });
        foreach (var target in new TaskTarget[] { new(Guid.NewGuid()), new(room, asset), new(AssetId: asset), new(room, CommonArea: "Sân"), new(CommonArea: "Other") })
        {
            var error = await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.CreateAsync(new(r.Location, r.Work with { Target = target }), Guid.NewGuid(), default));
            Assert.Equal("invalid_task_target", error.Code);
        }
        Assert.Empty(r.Added);
        var created = await r.Service.CreateAsync(new(r.Location, r.Work with { Target = new(AssetId: asset, CommonArea: "Sân") }), Guid.NewGuid(), default);
        Assert.Equal(new TaskTargetView(null, asset, "Sân", "Sân · Camera"), created.Target);
    }
    [Fact]
    public async Task OwnerTaskListForwardsStaffFilterWhileStaffScopeRemainsAuthenticated()
    {
        var r = new Rig();
        r.Repo.ListAsync(Arg.Any<TaskQuery>(), Arg.Any<Guid?>(), Arg.Any<DateOnly>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(new TaskPage<TaskView>([], 1, 20, 0));
        var requestedStaff = Guid.NewGuid();

        await r.Service.ListAsync(new TaskQuery { StaffUserId = requestedStaff }, default);

        await r.Repo.Received(1).ListAsync(
            Arg.Is<TaskQuery>(query => query.StaffUserId == requestedStaff),
            requestedStaff,
            Arg.Any<DateOnly>(),
            Arg.Any<DateTimeOffset>(),
            Arg.Any<CancellationToken>());

        r.AsStaff();
        await r.Service.ListAsync(new TaskQuery { StaffUserId = Guid.NewGuid() }, default);
        await r.Repo.Received(1).ListAsync(
            Arg.Is<TaskQuery>(query => query.StaffUserId != r.User.UserId),
            r.User.UserId,
            Arg.Any<DateOnly>(),
            Arg.Any<DateTimeOffset>(),
            Arg.Any<CancellationToken>());
    }
    [Fact]
    public async Task TaskListNormalizesLocalDayBoundsToUtcWithoutChangingInstants()
    {
        var r = new Rig();
        r.Repo.ListAsync(Arg.Any<TaskQuery>(), Arg.Any<Guid?>(), Arg.Any<DateOnly>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(new TaskPage<TaskView>([], 1, 1, 0));
        var from = DateTimeOffset.Parse("2026-11-12T00:00:00+07:00");
        var to = DateTimeOffset.Parse("2026-11-12T23:59:59.999+07:00");

        await r.Service.ListAsync(new TaskQuery { PageSize = 1, DueFrom = from, DueTo = to }, default);

        await r.Repo.Received(1).ListAsync(
            Arg.Is<TaskQuery>(q => q.DueFrom == from && q.DueTo == to &&
                q.DueFrom.Value.Offset == TimeSpan.Zero && q.DueTo.Value.Offset == TimeSpan.Zero),
            Arg.Any<Guid?>(), Arg.Any<DateOnly>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OwnerTaskListForwardsRecordedAssigneeAndResponsibilityFilters(bool available)
    {
        var r = new Rig();
        var recorded = Guid.NewGuid();
        r.Repo.ListAsync(Arg.Any<TaskQuery>(), Arg.Any<Guid?>(), Arg.Any<DateOnly>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(new TaskPage<TaskView>([], 1, 20, 0));
        await r.Service.ListAsync(new TaskQuery { RecordedStaffUserId = recorded, HasResponsibility = available }, default);
        await r.Repo.Received(1).ListAsync(
            Arg.Is<TaskQuery>(q => q.RecordedStaffUserId == recorded && q.HasResponsibility == available),
            null, new DateOnly(2026, 10, 31), r.Clock.Now, Arg.Any<CancellationToken>());
    }
    [Fact]
    public async Task StaffCannotUseRecordedAssigneeOrEitherResponsibilityFilter()
    {
        var r = new Rig();
        r.AsStaff();
        foreach (var query in new TaskQuery[]
        {
            new() { RecordedStaffUserId = r.Staff },
            new() { HasResponsibility = false },
            new() { HasResponsibility = true }
        })
        {
            var error = await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.ListAsync(query, default));
            Assert.Equal(400, error.Status);
            Assert.Equal("invalid_task_filter", error.Code);
        }
        await r.Repo.DidNotReceiveWithAnyArgs().ListAsync(default!, default, default, default, default);
    }
    [Fact]
    public async Task OwnerCannotUseEmptyStaffFilterIdentifiers()
    {
        var r = new Rig();
        foreach (var query in new TaskQuery[]
        {
            new() { StaffUserId = Guid.Empty },
            new() { RecordedStaffUserId = Guid.Empty }
        })
            Assert.Equal("invalid_task_filter", (await Assert.ThrowsAsync<OperationalTaskException>(
                () => r.Service.ListAsync(query, default))).Code);
        await r.Repo.DidNotReceiveWithAnyArgs().ListAsync(default!, default, default, default, default);
    }
    [Fact]
    public async Task MissingStaffAndInvalidWorkCannotCreateTask()
    {
        var r = new Rig(); r.Responsibility = null;
        Assert.Equal("no_responsible_staff", (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Create())).Code);
        Assert.Empty(r.Added);
        r.Responsibility = new(Guid.NewGuid(), r.Staff);
        foreach (var work in new[] { r.Work with { Title = " " }, r.Work with { Title = new string('x', 201) }, r.Work with { DueAt = r.Clock.Now }, r.Work with { Priority = (OperationalTaskPriority)99 } })
            await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.CreateAsync(new(r.Location, work), Guid.NewGuid(), default));
        Assert.Empty(r.Added);
    }
    [Fact]
    public async Task WrongRoleWrongLocationAndStaleWriteAreDenied()
    {
        var r = new Rig(); var task = await r.Create(); r.AsStaff();
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Create())).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.ActAsync(task.Id, "verify", new(task.Version), Guid.NewGuid(), default))).Status);
        r.User.UserId = Guid.NewGuid();
        Assert.Equal(404, (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.GetAsync(task.Id, default))).Status);
        r.AsStaff();
        Assert.Equal("stale_version", (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.ActAsync(task.Id, "start", new(0), Guid.NewGuid(), default))).Code);
    }
    [Fact]
    public async Task CompletionRequiresEvidenceThenOwnerVerificationAndReworkReason()
    {
        var r = new Rig(); var owner = r.User.UserId; var task = await r.Create(); r.AsStaff();
        task = await r.Service.ActAsync(task.Id, "start", new(task.Version), Guid.NewGuid(), default);
        Assert.Equal("completion_evidence_required", (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.ActAsync(task.Id, "submit", new(task.Version, "done"), Guid.NewGuid(), default))).Code);
        var evidence = await r.Service.UploadAsync(task.Id, Guid.NewGuid(), new MemoryStream([1, 2]), default);
        task = await r.Service.GetAsync(task.Id, default);
        task = await r.Service.ActAsync(task.Id, "submit", new(task.Version, "done", [evidence.Id]), Guid.NewGuid(), default);
        Assert.Equal("PendingVerification", task.Status); Assert.Null(task.VerifiedAt);
        r.User.UserId = owner; r.User.Role = Roles.Owner;
        await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.ActAsync(task.Id, "rework", new(task.Version), Guid.NewGuid(), default));
        task = await r.Service.ActAsync(task.Id, "rework", new(task.Version, "more work"), Guid.NewGuid(), default);
        Assert.Null(r.Added.OfType<OperationalTaskEvidence>().Single().SubmissionId);
        r.AsStaff();
        task = await r.Service.ActAsync(task.Id, "submit", new(task.Version, "corrected", [evidence.Id]), Guid.NewGuid(), default);
        r.User.Role = Roles.Owner; r.User.UserId = owner;
        task = await r.Service.ActAsync(task.Id, "verify", new(task.Version), Guid.NewGuid(), default);
        Assert.Equal("Completed", task.Status); Assert.Equal(owner, task.VerifiedByUserId);
        Assert.Contains(r.Added.OfType<OperationalTaskHistory>(), h => h.Action == "rework" && h.Note == "more work");
    }
    [Fact]
    public async Task ReplacementStaffContinuesButOldStaffLosesAccessAndHistoryIsRetained()
    {
        var r = new Rig(); var task = await r.Create(); var next = Guid.NewGuid();
        r.Responsibility = new(Guid.NewGuid(), next); r.AsStaff();
        await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.GetAsync(task.Id, default));
        r.User.UserId = next;
        task = await r.Service.ActAsync(task.Id, "start", new(task.Version), Guid.NewGuid(), default);
        Assert.Equal(next, task.RecordedStaffUserId);
        Assert.Contains(r.Added.OfType<OperationalTaskHistory>(), h => h.Action == "created" && h.ResponsibleStaffUserId == r.Staff);
        Assert.Contains(r.Added.OfType<OperationalTaskHistory>(), h => h.Action == "responsibility_changed" && h.ResponsibleStaffUserId == next);
    }
    [Theory]
    [InlineData(null, true)]
    [InlineData(MeterTaskStatus.Assigned, false)]
    [InlineData(MeterTaskStatus.InProgress, true)]
    [InlineData(MeterTaskStatus.PendingVerification, false)]
    [InlineData(MeterTaskStatus.Completed, false)]
    [InlineData(MeterTaskStatus.Cancelled, false)]
    public async Task MoveInInventoryStartPreservesMainHandoverGate(MeterTaskStatus? mainStatus, bool allowed)
    {
        var rig = new Rig();
        var contractId = Guid.NewGuid();
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.MoveInInventory,
            LocationId = rig.Location,
            ContractId = contractId,
            AssignmentId = rig.Responsibility!.AssignmentId,
            AssignedStaffUserId = rig.Staff
        };
        rig.Added.Add(task);
        rig.Repo.MoveInMainTaskStatusAsync(contractId, default).Returns(Task.FromResult(mainStatus));
        rig.AsStaff();

        if (allowed)
        {
            var result = await rig.Service.ActAsync(task.Id, "start", new(task.Version), Guid.NewGuid(), default);
            Assert.Equal("InProgress", result.Status);
        }
        else
        {
            var error = await Assert.ThrowsAsync<OperationalTaskException>(() =>
                rig.Service.ActAsync(task.Id, "start", new(task.Version), Guid.NewGuid(), default));
            Assert.Equal("move_in_handover_task_not_started", error.Code);
            Assert.Equal(MeterTaskStatus.Assigned, task.Status);
            Assert.Empty(rig.Added.OfType<OperationalTaskCommand>());
        }
    }

    [Fact]
    public async Task LocationAssetInventoryRequiresAllChecksAndPreservesInheritedEvidence()
    {
        var rig = new Rig();
        var room = Guid.NewGuid();
        var sourceContract = Guid.NewGuid();
        var inherited = new LocationAssetInventoryItem(Guid.NewGuid(), room, "P.101", Guid.NewGuid(),
            "Giường", 2, null, true, true, sourceContract);
        var common = new LocationAssetInventoryItem(Guid.NewGuid(), null, null, Guid.NewGuid(), "Bình cứu hỏa", 1, "Sảnh");
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            LocationId = rig.Location,
            AssignmentId = rig.Responsibility!.AssignmentId,
            AssignedStaffUserId = rig.Staff,
            LocationAssetInventoryJson = JsonSerializer.Serialize(new LocationAssetInventorySnapshot(
                rig.Responsibility.AssignmentId, new DateOnly(2026, 10, 31), [inherited, common]))
        };
        rig.Added.Add(task);
        rig.AsStaff();
        var beginning = await rig.Service.LocationAssetInventoryAsync(task.Id, default);
        Assert.Equal(2, beginning.TotalCount);
        Assert.Equal(1, beginning.CheckedCount);
        var begun = await rig.Service.ActAsync(task.Id, "start", new(task.Version), Guid.NewGuid(), default);
        var image = await rig.Service.UploadAsync(task.Id, Guid.NewGuid(), new MemoryStream([1, 2, 3]), default);
        Assert.Equal(task.Id, Assert.Single(rig.Added.OfType<OperationalTaskEvidence>()).TaskId);
        Assert.Equal(image.Id, Assert.Single(rig.Added.OfType<OperationalTaskEvidence>()).Id);
        begun = await rig.Service.GetAsync(task.Id, default);
        Assert.Equal("location_asset_inventory_incomplete", (await Assert.ThrowsAsync<OperationalTaskException>(
            () => rig.Service.ActAsync(task.Id, "submit", new(begun.Version, "Đã kiểm"), Guid.NewGuid(), default))).Code);
        Assert.Equal("location_asset_inventory_inherited_item_immutable", (await Assert.ThrowsAsync<OperationalTaskException>(
            () => rig.Service.UpdateLocationAssetInventoryItemAsync(task.Id, inherited.Id,
                new(begun.Version, false), Guid.NewGuid(), default))).Code);
        var checkedView = await rig.Service.UpdateLocationAssetInventoryItemAsync(task.Id, common.Id,
            new(begun.Version, true, "Đã kiểm tra thực tế"), Guid.NewGuid(), default);
        Assert.Equal("PendingVerification", checkedView.Status);
        Assert.Equal(checkedView.TotalCount, checkedView.CheckedCount);
        Assert.Equal(sourceContract, Assert.Single(checkedView.Items, item => item.Inherited).SourceHandoverContractId);
        var submitted = await rig.Service.ActAsync(task.Id, "submit",
            new(checkedView.Version, "Hoàn thành kiểm kê"), Guid.NewGuid(), default);
        Assert.Equal("PendingVerification", submitted.Status);
        rig.User.Role = Roles.Owner;
        rig.User.UserId = Guid.NewGuid();
        Assert.Equal("location_asset_handover_workflow_required", (await Assert.ThrowsAsync<OperationalTaskException>(
            () => rig.Service.ActAsync(task.Id, "verify", new(submitted.Version), Guid.NewGuid(), default))).Code);
    }

    [Fact]
    public async Task ChallengedTenantBaselineIsNotSilentlyInheritedAgainDuringReconciliation()
    {
        var rig = new Rig();
        var assignment = rig.Responsibility!.AssignmentId;
        var source = Guid.NewGuid();
        var inherited = new LocationAssetInventoryItem(Guid.NewGuid(), Guid.NewGuid(), "P.101",
            Guid.NewGuid(), "Tài sản đã bàn giao Tenant", 1, null, true, true, source);
        var challenged = inherited with
        {
            Checked = false,
            Inherited = false,
            SourceHandoverContractId = null,
            RecheckOfHandoverContractId = source
        };
        var authoritative = new LocationAssetInventorySnapshot(assignment, new DateOnly(2026, 10, 31), [inherited]);
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            Status = MeterTaskStatus.InProgress,
            LocationId = rig.Location,
            AssignmentId = assignment,
            AssignedStaffUserId = rig.Staff,
            LocationAssetInventoryJson = JsonSerializer.Serialize(authoritative with { Items = [challenged] })
        };
        rig.Added.Add(task);
        rig.Repo.OwnerConfirmedInventoryAsync(task, default).Returns(Task.FromResult(authoritative));
        var reconciled = await rig.Service.ReconcileLocationAssetInventoryAsync(task.Id,
            new(task.Version, true), Guid.NewGuid(), default);
        Assert.Equal("InProgress", reconciled.Status);
        Assert.False(Assert.Single(reconciled.Items).Checked);
        Assert.False(Assert.Single(reconciled.Items).Inherited);
        rig.AsStaff();
        var checkedView = await rig.Service.UpdateLocationAssetInventoryItemAsync(task.Id, challenged.Id,
            new(reconciled.Version, true, "Đã kiểm tra trực tiếp"), Guid.NewGuid(), default);
        Assert.Equal("PendingVerification", checkedView.Status);
        Assert.False(Assert.Single(checkedView.Items).Inherited);
        Assert.Equal(source, Assert.Single(checkedView.Items).RecheckOfHandoverContractId);
    }

    [Fact]
    public async Task OwnerReconciliationRemovesOnlyUntouchedLegacyEntriesAndPreservesHistory()
    {
        var rig = new Rig();
        var assignment = rig.Responsibility!.AssignmentId;
        var confirmed = new LocationAssetInventoryItem(Guid.NewGuid(), Guid.NewGuid(), "P.101",
            Guid.NewGuid(), "Owner verified bed", 1, null);
        var staffChecked = confirmed with { Checked = true, Note = "Staff đã kiểm tra thực tế" };
        var legacy = new LocationAssetInventoryItem(Guid.NewGuid(), Guid.NewGuid(), "P.102",
            null, "Configured only, not confirmed", 1, null);
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            Status = MeterTaskStatus.InProgress,
            LocationId = rig.Location,
            AssignmentId = assignment,
            AssignedStaffUserId = rig.Staff,
            LocationAssetInventoryJson = JsonSerializer.Serialize(new LocationAssetInventorySnapshot(
                assignment, new DateOnly(2026, 10, 31), [staffChecked, legacy]))
        };
        rig.Added.Add(task);
        var ownerBaseline = new LocationAssetInventorySnapshot(assignment, new DateOnly(2026, 10, 31), [confirmed]);
        rig.Repo.OwnerConfirmedInventoryAsync(task, default).Returns(Task.FromResult(ownerBaseline));

        var preview = await rig.Service.PreviewLocationAssetInventoryReconciliationAsync(task.Id, default);
        Assert.True(preview.CanApply);
        Assert.Equal(2, preview.CurrentCount);
        Assert.Equal(1, preview.OwnerConfirmedCount);
        Assert.Equal(1, preview.RemovedCount);

        var command = new LocationAssetInventoryReconcileCommand(task.Version, true);
        var key = Guid.NewGuid();
        var result = await rig.Service.ReconcileLocationAssetInventoryAsync(task.Id, command, key, default);
        Assert.Equal(task.Version, result.Version);
        Assert.Equal(1, result.TotalCount);
        Assert.Equal(confirmed.AssetId, Assert.Single(result.Items).AssetId);
        Assert.True(Assert.Single(result.Items).Checked);
        Assert.Equal("Staff đã kiểm tra thực tế", Assert.Single(result.Items).Note);
        var replay = await rig.Service.ReconcileLocationAssetInventoryAsync(task.Id, command, key, default);
        Assert.Equal(result.Version, replay.Version);
        Assert.Equal(result.TotalCount, replay.TotalCount);
        Assert.Equal(result.Items.Select(item => item.Id), replay.Items.Select(item => item.Id));
        Assert.Contains(rig.Added.OfType<OperationalTaskHistory>(), x => x.Action == "location_asset_inventory_owner_reconciled");
        Assert.Single(rig.Added.OfType<OperationalTaskHistory>(), x => x.Action == "location_asset_inventory_owner_reconciled");
        rig.AsStaff();
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationalTaskException>(() =>
            rig.Service.PreviewLocationAssetInventoryReconciliationAsync(task.Id, default))).Status);
    }

    [Fact]
    public async Task OwnerReconciliationRefusesToDropCheckedStaffWorkOrMutateSubmittedTasks()
    {
        var rig = new Rig();
        var assignment = rig.Responsibility!.AssignmentId;
        var checkedItem = new LocationAssetInventoryItem(Guid.NewGuid(), Guid.NewGuid(), "P.101",
            Guid.NewGuid(), "Staff checked bed", 1, null, Checked: true, Note: "Đã kiểm tra");
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            Status = MeterTaskStatus.InProgress,
            LocationId = rig.Location,
            AssignmentId = assignment,
            AssignedStaffUserId = rig.Staff,
            LocationAssetInventoryJson = JsonSerializer.Serialize(new LocationAssetInventorySnapshot(
                assignment, new DateOnly(2026, 10, 31), [checkedItem]))
        };
        rig.Added.Add(task);
        var differentOwnerAsset = new LocationAssetInventoryItem(Guid.NewGuid(), Guid.NewGuid(), "P.102",
            Guid.NewGuid(), "Different owner verified item", 1, null);
        rig.Repo.OwnerConfirmedInventoryAsync(task, default).Returns(Task.FromResult(new LocationAssetInventorySnapshot(
            assignment, new DateOnly(2026, 10, 31), [differentOwnerAsset])));
        var preview = await rig.Service.PreviewLocationAssetInventoryReconciliationAsync(task.Id, default);
        Assert.False(preview.CanApply);
        Assert.Equal("location_asset_inventory_staff_work_conflict", preview.BlockedReason);
        var before = task.LocationAssetInventoryJson;
        Assert.Equal("location_asset_inventory_staff_work_conflict", (await Assert.ThrowsAsync<OperationalTaskException>(() =>
            rig.Service.ReconcileLocationAssetInventoryAsync(task.Id,
                new(task.Version, true), Guid.NewGuid(), default))).Code);
        Assert.Equal(before, task.LocationAssetInventoryJson);
        task.Status = MeterTaskStatus.PendingVerification;
        Assert.Equal("location_asset_inventory_reconciliation_locked", (await Assert.ThrowsAsync<OperationalTaskException>(() =>
            rig.Service.ReconcileLocationAssetInventoryAsync(task.Id,
                new(task.Version, true), Guid.NewGuid(), default))).Code);
        Assert.Empty(rig.Added.OfType<OperationalTaskHistory>());
    }

    [Fact]
    public async Task NewAssignmentCannotAlterPreviousAssignmentInventory()
    {
        var rig = new Rig();
        var firstAssignmentId = rig.Responsibility!.AssignmentId;
        var item = new LocationAssetInventoryItem(Guid.NewGuid(), null, null, null, "Kiểm tra khu chung", 0, "Sảnh");
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            LocationId = rig.Location,
            AssignmentId = firstAssignmentId,
            AssignedStaffUserId = rig.Staff,
            LocationAssetInventoryJson = JsonSerializer.Serialize(new LocationAssetInventorySnapshot(
                firstAssignmentId, new DateOnly(2026, 10, 31), [item]))
        };
        rig.Added.Add(task);
        rig.Responsibility = new(Guid.NewGuid(), rig.Staff); // Same Staff, later responsibility period.
        rig.AsStaff();
        var denied = await Assert.ThrowsAsync<OperationalTaskException>(
            () => rig.Service.LocationAssetInventoryAsync(task.Id, default));
        Assert.Equal(404, denied.Status);
    }
    [Fact]
    public async Task DeadlineExtensionRetainsOverdueHistoryWithoutDiscardingExecutionState()
    {
        var r = new Rig(); var task = await r.Create(); r.Clock.Now = r.Clock.Now.AddDays(2);
        Assert.True((await r.Service.GetAsync(task.Id, default)).IsOverdue);
        task = await r.Service.UpdateAsync(task.Id, new(task.Version, r.Work, "extend deadline"), Guid.NewGuid(), default);
        Assert.False(task.IsOverdue); Assert.Equal("Assigned", task.Status);
        Assert.True(r.Added.OfType<OperationalTaskHistory>().Last().WasOverdue);
    }
    [Fact]
    public async Task EvidenceLimitCrossTaskIdsAndLargeFilesCannotReachStorage()
    {
        var r = new Rig(); var task = await r.Create(); r.AsStaff();
        task = await r.Service.ActAsync(task.Id, "start", new(task.Version), Guid.NewGuid(), default);
        await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.ActAsync(task.Id, "submit", new(task.Version, "done", [Guid.NewGuid()]), Guid.NewGuid(), default));
        Assert.Equal(413, (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.UploadAsync(task.Id, Guid.NewGuid(), new MemoryStream(new byte[1025]), default))).Status);
        await r.Files.DidNotReceiveWithAnyArgs().PutAsync(default, default!, default!, default!, default);
        foreach (var i in new[] { 1, 2 }) await r.Service.UploadAsync(task.Id, Guid.NewGuid(), new MemoryStream([(byte)i]), default);
        Assert.Equal("task_evidence_limit", (await Assert.ThrowsAsync<OperationalTaskException>(() => r.Service.UploadAsync(task.Id, Guid.NewGuid(), new MemoryStream([3]), default))).Code);
    }
    [Theory]
    [InlineData("2026-10-31T10:00:00")]
    [InlineData("invalid")]
    public void DeadlineInputRequiresAnExplicitOffset(string value) => Assert.Throws<JsonException>(() =>
        JsonSerializer.Deserialize<TaskWrite>(JsonSerializer.Serialize(new { Title = "x", Requirements = "x", Priority = "Normal", DueAt = value, EvidenceRequired = false })));
}
