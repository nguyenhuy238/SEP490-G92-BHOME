using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using NSubstitute;

namespace BHome.Application.UnitTests.StaffOperations;

public sealed class MoveInInventoryServiceTests
{
    private sealed class CurrentStaff : ICurrentUser
    {
        public Guid? UserId { get; set; } = Guid.NewGuid();
        public string Role { get; set; } = Roles.Staff;
        public bool IsInRole(string role) => Role == role;
    }

    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 11, 18, 8, 0, 0, TimeSpan.Zero);
    }

    private sealed class Rig
    {
        public readonly CurrentStaff User = new();
        public readonly IOperationalTaskRepository Repo = Substitute.For<IOperationalTaskRepository>();
        public readonly ITaskEvidenceFiles Files = Substitute.For<ITaskEvidenceFiles>();
        public readonly List<object> Added = [];
        public readonly Guid Location = Guid.NewGuid();
        public readonly Guid Room = Guid.NewGuid();
        public readonly Guid Asset = Guid.NewGuid();
        public readonly Guid Contract = Guid.NewGuid();
        public readonly Guid Owner = Guid.NewGuid();
        public readonly OperationalTask Task;
        public readonly OperationalTaskService Service;
        public bool IssuesResolved { get; set; }

        public Rig(int itemCount = 1)
        {
            var items = Enumerable.Range(0, itemCount).Select(_ =>
                new MoveInInventoryItem(Guid.NewGuid(), Asset, "Giường", 2)).ToArray();
            Task = new OperationalTask
            {
                LocationId = Location,
                ContractId = Contract,
                TargetRoomId = Room,
                Kind = OperationalTaskKind.MoveInInventory,
                Status = MeterTaskStatus.InProgress,
                AssignedStaffUserId = User.UserId,
                Version = 1,
                MoveInInventoryJson = JsonSerializer.Serialize(new MoveInInventorySnapshot("baseline", items))
            };
            Repo.FindAsync(default, default).ReturnsForAnyArgs(c =>
                c.Arg<Guid>() == Task.Id ? Task : null);
            Repo.LocationAsync(default, default).ReturnsForAnyArgs(c => new TaskLocation(c.Arg<Guid>(), true));
            Repo.ResponsibilityAsync(default, default, default).ReturnsForAnyArgs(
                _ => new TaskResponsibility(Guid.NewGuid(), User.UserId!.Value));
            Repo.OwnersAsync(default).ReturnsForAnyArgs([Owner]);
            Repo.IncidentsResolvedAsync(default!, default).ReturnsForAnyArgs(c =>
                c.Arg<Guid[]>().Length == 0 || IssuesResolved);
            Repo.EvidenceAsync(default, default).ReturnsForAnyArgs(c =>
                (IReadOnlyList<OperationalTaskEvidence>)Added.OfType<OperationalTaskEvidence>()
                    .Where(x => x.TaskId == c.Arg<Guid>()).ToArray());
            Repo.TransactionAsync(default, default, default, default(Func<Task<MoveInInventoryView>>)!, default)
                .ReturnsForAnyArgs(c => c.Arg<Func<Task<MoveInInventoryView>>>()());
            Repo.TransactionAsync(default, default, default, default(Func<Task<TaskEvidenceView>>)!, default)
                .ReturnsForAnyArgs(c => c.Arg<Func<Task<TaskEvidenceView>>>()());
            Repo.When(x => x.Add(Arg.Any<object>())).Do(c => Added.Add(c.Arg<object>()));
            Files.Validate(default!, default).ReturnsForAnyArgs("image/png");
            Service = new OperationalTaskService(Repo, User,
                new PermissionAccess(User, new ResourceAccess(User, Substitute.For<IStaffLocationAccess>())),
                Files, new TaskEvidenceLimits { MaximumFileBytes = 1024, MaximumFilesPerTask = 10 }, new Clock());
        }

        public MoveInInventoryItem[] Items => JsonSerializer.Deserialize<MoveInInventorySnapshot>(Task.MoveInInventoryJson)!.Items;
        public Guid Evidence()
        {
            var file = new OperationalTaskEvidence
            {
                TaskId = Task.Id,
                UploadedByUserId = User.UserId!.Value,
                ObjectKey = "synthetic/test.png",
                ContentType = "image/png",
                Sha256 = new string('A', 64),
                Length = 3
            };
            Added.Add(file);
            return file.Id;
        }
        public void Mark(MoveInInventoryItem item)
        {
            var snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(Task.MoveInInventoryJson)!;
            snapshot.Items[Array.FindIndex(snapshot.Items, x => x.Id == item.Id)] =
                item with { ActualQuantity = 2, Condition = "Good", EvidenceIds = [Evidence()] };
            Task.MoveInInventoryJson = JsonSerializer.Serialize(snapshot);
        }
    }

    [Fact]
    public async Task CompletedGoodInventoryGoesDirectlyToCompletedAndNotifiesOwner()
    {
        var r = new Rig();
        r.Mark(r.Items.Single());
        var result = await r.Service.CompleteMoveInInventoryAsync(r.Task.Id, new(r.Task.Version, "Đã kiểm"), Guid.NewGuid(), default);
        Assert.Equal("Completed", result.Status);
        Assert.Equal("Good", result.Outcome);
        Assert.True(result.ReadyForHandover);
        Assert.Null(r.Task.VerifiedByUserId);
        Assert.Contains(r.Added.OfType<OperationalTaskNotification>(), n =>
            n.RecipientUserId == r.Owner && n.Event == "move_in_inventory_completed");
        await r.Repo.Received(1).NotifyMoveInInventoryCompletedAsync(r.Task, r.User.UserId!.Value, default);
    }

    [Fact]
    public async Task GoodInventoryCanBeSavedAndCompletedWithoutReasonOrPhoto()
    {
        var r = new Rig();
        var item = r.Items.Single();
        var saved = await r.Service.UpdateInventoryItemAsync(r.Task.Id, item.Id,
            new(r.Task.Version, item.ExpectedQuantity, "Good", null, [], null), Guid.NewGuid(), default);
        Assert.Equal("Good", Assert.Single(saved.Items).Condition);
        Assert.Empty(Assert.Single(saved.Items).EvidenceIds!);
        Assert.Null(Assert.Single(saved.Items).IncidentId);
        var completed = await r.Service.CompleteMoveInInventoryAsync(r.Task.Id,
            new(r.Task.Version), Guid.NewGuid(), default);
        Assert.Equal("Completed", completed.Status);
        Assert.True(completed.ReadyForHandover);
    }

    [Theory]
    [InlineData("Missing", 1)]
    [InlineData("Damaged", 2)]
    public async Task MissingOrDamagedStillRequirePhotosAndReason(string condition, int actualQuantity)
    {
        var r = new Rig();
        var item = r.Items.Single();
        var withoutPhoto = await Assert.ThrowsAsync<OperationalTaskException>(() =>
            r.Service.UpdateInventoryItemAsync(r.Task.Id, item.Id,
                new(r.Task.Version, actualQuantity, condition, "Hiện trạng bất thường", [], null),
                Guid.NewGuid(), default));
        Assert.Equal("invalid_move_in_inventory_item", withoutPhoto.Code);

        var withoutReason = await Assert.ThrowsAsync<OperationalTaskException>(() =>
            r.Service.UpdateInventoryItemAsync(r.Task.Id, item.Id,
                new(r.Task.Version, actualQuantity, condition, "", [r.Evidence()], null),
                Guid.NewGuid(), default));
        Assert.Equal("invalid_move_in_inventory_item", withoutReason.Code);
    }

    [Fact]
    public async Task CannotCompleteUncheckedOrIssueWithoutDescriptionAndPhoto()
    {
        var r = new Rig();
        var incomplete = await Assert.ThrowsAsync<OperationalTaskException>(() =>
            r.Service.CompleteMoveInInventoryAsync(r.Task.Id, new(r.Task.Version), Guid.NewGuid(), default));
        Assert.Equal("move_in_inventory_checklist_incomplete", incomplete.Code);

        var snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(r.Task.MoveInInventoryJson)!;
        snapshot.Items[0] = snapshot.Items[0] with { ActualQuantity = 1, Condition = "Missing", Notes = "Thiếu giường", EvidenceIds = [] };
        r.Task.MoveInInventoryJson = JsonSerializer.Serialize(snapshot);
        var missing = await Assert.ThrowsAsync<OperationalTaskException>(() =>
            r.Service.CompleteMoveInInventoryAsync(r.Task.Id, new(r.Task.Version), Guid.NewGuid(), default));
        Assert.Equal("move_in_inventory_checklist_incomplete", missing.Code);
        Assert.Equal(MeterTaskStatus.InProgress, r.Task.Status);
    }

    [Theory]
    [InlineData("Missing", 1)]
    [InlineData("Damaged", 2)]
    public async Task StaffCanCompleteIssueWithPhotoWithoutCreatingAnIncident(string condition, int quantity)
    {
        var r = new Rig();
        var item = r.Items.Single();
        var evidence = r.Evidence();
        var saved = await r.Service.UpdateInventoryItemAsync(r.Task.Id, item.Id,
            new(r.Task.Version, quantity, condition, "Hiện trạng do Staff ghi nhận", [evidence]), Guid.NewGuid(), default);
        Assert.Null(Assert.Single(saved.Items).IncidentId);
        var completed = await r.Service.CompleteMoveInInventoryAsync(r.Task.Id,
            new(r.Task.Version), Guid.NewGuid(), default);
        Assert.Equal("Completed", completed.Status);
        Assert.Equal(condition, completed.Outcome);
        Assert.False(completed.ReadyForHandover); // Owner must review/decide, not Staff
    }

    [Fact]
    public async Task IssueCanFinishInspectionButRequiresResolvedIncidentBeforeHandover()
    {
        var r = new Rig();
        var incidentId = Guid.NewGuid();
        r.Repo.IncidentTargetsAsync(default!, default).ReturnsForAnyArgs(c =>
            (IReadOnlyList<TaskIncidentTarget>)c.Arg<Guid[]>().Select(id =>
                new TaskIncidentTarget(id, r.Location, r.Room, r.Asset, r.User.UserId!.Value, true)).ToArray());
        var evidence = r.Evidence();
        var changed = await r.Service.UpdateInventoryItemAsync(r.Task.Id, r.Items.Single().Id,
            new(r.Task.Version, 1, "Missing", "Thiếu một giường", [evidence], incidentId), Guid.NewGuid(), default);
        Assert.Equal("Missing", changed.Outcome);
        var completed = await r.Service.CompleteMoveInInventoryAsync(r.Task.Id,
            new(r.Task.Version), Guid.NewGuid(), default);
        Assert.Equal("Completed", completed.Status);
        Assert.False(completed.ReadyForHandover);

        r.IssuesResolved = true; // BF-07 Owner resolved after repair verification.
        var report = await r.Service.MoveInInventoryAsync(r.Task.Id, default);
        Assert.True(report.ReadyForHandover);
    }

    [Fact]
    public async Task RejectCrossRoomIncidentAndDifferentAssignedStaff()
    {
        var r = new Rig();
        var incident = Guid.NewGuid();
        r.Repo.IncidentTargetsAsync(default!, default).ReturnsForAnyArgs(c =>
            (IReadOnlyList<TaskIncidentTarget>)c.Arg<Guid[]>().Select(id =>
                new TaskIncidentTarget(id, r.Location, Guid.NewGuid(), r.Asset, r.User.UserId!.Value, true)).ToArray());
        var error = await Assert.ThrowsAsync<OperationalTaskException>(() =>
            r.Service.UpdateInventoryItemAsync(r.Task.Id, r.Items.Single().Id,
                new(r.Task.Version, 1, "Missing", "Thiếu một giường", [r.Evidence()], incident), Guid.NewGuid(), default));
        Assert.Equal("invalid_move_in_inventory_incident", error.Code);

        r.User.UserId = Guid.NewGuid();
        // Responsibility resolution is still the old assigned Staff.
        r.Repo.ResponsibilityAsync(default, default, default).ReturnsForAnyArgs(
            _ => new TaskResponsibility(Guid.NewGuid(), r.Task.AssignedStaffUserId!.Value));
        Assert.Equal(404, (await Assert.ThrowsAsync<OperationalTaskException>(() =>
            r.Service.MoveInInventoryAsync(r.Task.Id, default))).Status);
    }

    [Fact]
    public async Task ReassignedStaffCanKeepExistingIncidentWithoutImpersonatingOriginalReporter()
    {
        var r = new Rig();
        var originalStaff = r.User.UserId!.Value;
        var incidentId = Guid.NewGuid();
        r.Repo.IncidentTargetsAsync(default!, default).ReturnsForAnyArgs(c =>
            (IReadOnlyList<TaskIncidentTarget>)c.Arg<Guid[]>().Select(id =>
                new TaskIncidentTarget(id, r.Location, r.Room, r.Asset, originalStaff, true)).ToArray());
        var evidenceId = r.Evidence();
        var first = await r.Service.UpdateInventoryItemAsync(r.Task.Id, r.Items.Single().Id,
            new(r.Task.Version, 1, "Missing", "Thiếu một giường", [evidenceId], incidentId),
            Guid.NewGuid(), default);
        Assert.Equal(incidentId, Assert.Single(first.Items).IncidentId);

        var replacement = Guid.NewGuid();
        r.User.UserId = replacement;
        r.Repo.ResponsibilityAsync(default, default, default).ReturnsForAnyArgs(_ =>
            new TaskResponsibility(Guid.NewGuid(), replacement));
        var second = await r.Service.UpdateInventoryItemAsync(r.Task.Id, r.Items.Single().Id,
            new(r.Task.Version, 1, "Missing", "Đã đối chiếu sự cố tồn đọng", [evidenceId], incidentId),
            Guid.NewGuid(), default);
        Assert.Equal(incidentId, Assert.Single(second.Items).IncidentId);
        Assert.Equal(replacement, r.Task.AssignedStaffUserId);
    }

    [Fact]
    public async Task ElevenAssetGroupsCanUploadEleventhPhotoDespiteGenericTenFileLimit()
    {
        var r = new Rig(11);
        for (var i = 0; i < 10; ++i) r.Evidence();
        var file = await r.Service.UploadAsync(r.Task.Id, Guid.NewGuid(), new MemoryStream([1, 2, 3]), default);
        Assert.NotEqual(Guid.Empty, file.Id);
        Assert.Equal(11, r.Added.OfType<OperationalTaskEvidence>().Count());
    }
}
