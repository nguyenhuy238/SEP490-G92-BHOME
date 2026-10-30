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
            Repo.CommandAsync(default, default, default).ReturnsForAnyArgs(c => Added.OfType<OperationalTaskCommand>().SingleOrDefault(x => x.ActorId == c.ArgAt<Guid>(0) && x.Key == c.ArgAt<Guid>(1)));
            Repo.EvidenceAsync(default, default).ReturnsForAnyArgs(c => (IReadOnlyList<OperationalTaskEvidence>)Added.OfType<OperationalTaskEvidence>().Where(x => x.TaskId == c.Arg<Guid>()).ToArray());
            Repo.OwnersAsync(default).ReturnsForAnyArgs(new[] { User.UserId!.Value });
            Repo.TransactionAsync(default, default, default, default(Func<Task<TaskView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<TaskView>>>()());
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
