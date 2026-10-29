using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Application.Jobs;
using BHome.Application.Locations;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using NSubstitute;

namespace BHome.Application.UnitTests.IncidentMaintenance;

public sealed class IncidentMaintenanceServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 3, 2, 0, 0, TimeSpan.Zero);
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid ownerId = Guid.NewGuid();
    private readonly Guid locationId = Guid.NewGuid();

    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly ILocationAssignments assignments = Substitute.For<ILocationAssignments>();
    private readonly IIncidentMaintenanceStore store = Substitute.For<IIncidentMaintenanceStore>();
    private readonly IObjectStorage storage = Substitute.For<IObjectStorage>();
    private readonly IBackgroundJobQueue queue = Substitute.For<IBackgroundJobQueue>();
    private readonly IMaintenanceDirectory directory = Substitute.For<IMaintenanceDirectory>();
    private readonly ITenantRoomScope tenantRooms = Substitute.For<ITenantRoomScope>();
    private readonly IMaintenanceExpenseRecorder expenses = Substitute.For<IMaintenanceExpenseRecorder>();

    public IncidentMaintenanceServiceTests()
    {
        user.UserId.Returns(userId);
        store.BeginTransactionAsync(Arg.Any<CancellationToken>()).Returns(Substitute.For<IMaintenanceTransaction>());
        store.LocationExistsAsync(locationId, Arg.Any<CancellationToken>()).Returns(true);
        directory.OwnerUserIdsAsync(Arg.Any<CancellationToken>()).Returns([ownerId]);
    }

    private MaintenanceAccess Access => new(user, assignments, new FixedClock());
    private MaintenanceNotifier Notifier => new(queue, directory);
    private IncidentReportService Reports => new(store, Access, new MaintenanceEvidence(storage), Notifier, tenantRooms,
        new IncidentMaintenanceOptions());
    private WorkOrderService WorkOrders => new(store, Access, new MaintenanceEvidence(storage), Notifier, directory, expenses);
    private IncidentReviewService Review => new(store, Access, new MaintenanceEvidence(storage), Notifier, directory, expenses);

    private void AsStaff(params Guid[] assignedLocations)
    {
        user.IsInRole(Roles.Staff).Returns(true);
        assignments.ListAssignedLocationsAsync(userId, Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(assignedLocations.Select(id => new LocationSummary(id, "Cơ sở")).ToArray());
    }

    private void AsOwner() => user.IsInRole(Roles.Owner).Returns(true);

    private static SubmitIncidentInput Input(Guid location, IncidentSeverity severity = IncidentSeverity.Normal) =>
        new(location, null, null, severity, "Ống nước vỡ", "Nước tràn ra hành lang tầng 2");

    // ---- UC-26 scope ----

    [Fact]
    public async Task StaffAssignedToLocationSubmitsAndEmergencyAlertsOwnersAndStaff()
    {
        AsStaff(locationId);
        var detail = await Reports.SubmitAsync(Input(locationId, IncidentSeverity.OperationalEmergency), [], default);

        Assert.Equal(IncidentReporterRole.Staff, detail.ReporterRole);
        Assert.NotNull(detail.AcknowledgedAt);
        await queue.Received(1).EnqueueAsync(
            Arg.Is<JobSubmission>(j => j.IdempotencyKey == $"incident:{detail.Id}:emergency" && j.PayloadJson.Contains("MSG13")),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StaffOutsideAssignedLocationGetsNotFoundAndNothingIsStored()
    {
        AsStaff(Guid.NewGuid());
        await Assert.ThrowsAsync<MaintenanceNotFoundException>(() =>
            Reports.SubmitAsync(Input(locationId), [Jpeg()], default));

        store.DidNotReceiveWithAnyArgs().Add(default(IncidentReport)!);
        await storage.DidNotReceiveWithAnyArgs().PutAsync(default!, default!, default, default!, default);
    }

    [Fact]
    public async Task TenantWithoutActiveRoomCannotReport()
    {
        user.IsInRole(Roles.Tenant).Returns(true);
        tenantRooms.ActiveRoomsAsync(userId, Arg.Any<CancellationToken>()).Returns([]);
        await Assert.ThrowsAsync<MaintenanceNotFoundException>(() => Reports.SubmitAsync(Input(locationId), [], default));
    }

    [Fact]
    public async Task TenantCannotSeeAnotherTenantsReport()
    {
        user.IsInRole(Roles.Tenant).Returns(true);
        var someoneElses = IncidentReport.Submit("SC-1", Guid.NewGuid(), IncidentReporterRole.Tenant, locationId, null, null,
            IncidentSeverity.Normal, "Đèn hỏng", "Đèn phòng tắm không sáng", [], Now, TimeSpan.FromMinutes(30));
        store.FindIncidentAsync(someoneElses.Id, Arg.Any<CancellationToken>()).Returns(someoneElses);

        await Assert.ThrowsAsync<MaintenanceNotFoundException>(() => Reports.GetAsync(someoneElses.Id, default));
    }

    // ---- Evidence (NFR Report Upload) ----

    [Fact]
    public async Task RejectsSixPhotosOversizedPhotoAndNonImage()
    {
        AsStaff(locationId);
        var six = Enumerable.Range(0, 6).Select(_ => Jpeg()).ToArray();
        var tooBig = new EvidenceUpload(new MemoryStream(new byte[MaintenanceEvidence.MaxBytes + 1]), MaintenanceEvidence.MaxBytes + 1);
        var text = new EvidenceUpload(new MemoryStream("not an image"u8.ToArray()), 12);

        Assert.Equal("too_many_evidence_files", (await Assert.ThrowsAsync<MaintenanceValidationException>(() =>
            Reports.SubmitAsync(Input(locationId), six, default))).Code);
        Assert.Equal("evidence_file_too_large", (await Assert.ThrowsAsync<MaintenanceValidationException>(() =>
            Reports.SubmitAsync(Input(locationId), [tooBig], default))).Code);
        Assert.Equal("unsupported_evidence_type", (await Assert.ThrowsAsync<MaintenanceValidationException>(() =>
            Reports.SubmitAsync(Input(locationId), [text], default))).Code);
    }

    [Fact]
    public async Task UploadedPhotosAreDeletedWhenSavingFails()
    {
        AsStaff(locationId);
        store.SaveAsync(Arg.Any<CancellationToken>()).Returns(Task.FromException(new MaintenanceStateException("concurrent_update")));

        await Assert.ThrowsAsync<MaintenanceStateException>(() => Reports.SubmitAsync(Input(locationId), [Jpeg()], default));
        await storage.Received(1).DeleteAsync(Arg.Is<string>(k => k.StartsWith("incident-evidence/")), Arg.Any<CancellationToken>());
    }

    // ---- UC-28 / UC-30 ----

    [Fact]
    public async Task WorkOrderOnlyForStaffAssignedToTheLocation()
    {
        AsOwner();
        var report = Report();
        directory.StaffAssignedToLocationAsync(locationId, Arg.Any<CancellationToken>()).Returns([Guid.NewGuid()]);

        var error = await Assert.ThrowsAsync<MaintenanceValidationException>(() => Review.CreateWorkOrderAsync(report.Id,
            new CreateWorkOrderInput(Guid.NewGuid(), "Thay ống nước", null, null, null), default));
        Assert.Equal("staff_not_assigned_to_location", error.Code);
    }

    [Fact]
    public async Task VerifyRecordsExpenseOnceAndResolvesReport()
    {
        AsOwner();
        var report = Report();
        var staff = Guid.NewGuid();
        var order = MaintenanceWorkOrder.Create(report, ownerId, staff, "Thay ống nước", null, null, Now);
        order.SubmitProposal(staff, "Ống nứt", "Thay đoạn ống", "2 giờ", 300_000m, [], Now);
        order.ApprovePlan(ownerId, Now);
        order.Start(staff, Now);
        order.SubmitForVerification(staff, "Đã thay", [new EvidenceRef("incident-evidence/a", EvidenceKind.After, staff, Now, 10, "image/jpeg")], Now);
        store.FindWorkOrderAsync(order.Id, Arg.Any<CancellationToken>()).Returns(order);
        store.WorkOrdersForIncidentAsync(report.Id, Arg.Any<CancellationToken>()).Returns([order]);

        await WorkOrders.VerifyAsync(order.Id, new VerifyInput(300_000m, null), default);

        Assert.Equal(IncidentStatus.Resolved, report.Status);
        await expenses.Received(1).RecordAsync(
            Arg.Is<MaintenanceExpense>(e => e.SourceKey == $"WO:{order.Id}" && e.Amount == 300_000m && e.LocationId == locationId),
            Arg.Any<CancellationToken>());
        await queue.Received(1).EnqueueAsync(Arg.Is<JobSubmission>(j => j.IdempotencyKey == $"incident:{report.Id}:resolved"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StaffCannotOpenWorkOrderAssignedToSomeoneElse()
    {
        AsStaff(locationId);
        var order = MaintenanceWorkOrder.Create(Report(), ownerId, Guid.NewGuid(), "Thay ống nước", null, null, Now);
        store.FindWorkOrderAsync(order.Id, Arg.Any<CancellationToken>()).Returns(order);

        await Assert.ThrowsAsync<MaintenanceNotFoundException>(() => WorkOrders.GetAsync(order.Id, default));
        await Assert.ThrowsAsync<MaintenanceNotFoundException>(() => WorkOrders.StartAsync(order.Id, default));
    }

    private IncidentReport Report()
    {
        var report = IncidentReport.Submit("SC-1", Guid.NewGuid(), IncidentReporterRole.Tenant, locationId, null, null,
            IncidentSeverity.Normal, "Ống nước vỡ", "Nước tràn ra hành lang tầng 2", [], Now, TimeSpan.FromMinutes(30));
        store.FindIncidentAsync(report.Id, Arg.Any<CancellationToken>()).Returns(report);
        return report;
    }

    private static EvidenceUpload Jpeg() => new(new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]), 7);

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
