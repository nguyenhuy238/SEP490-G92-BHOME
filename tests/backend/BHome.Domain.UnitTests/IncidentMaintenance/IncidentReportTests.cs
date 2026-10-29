using BHome.Domain.IncidentMaintenance;

namespace BHome.Domain.UnitTests.IncidentMaintenance;

public sealed class IncidentReportTests
{
    internal static readonly DateTimeOffset Now = new(2026, 11, 3, 2, 0, 0, TimeSpan.Zero);
    internal static readonly Guid Reporter = Guid.NewGuid();
    internal static readonly Guid Owner = Guid.NewGuid();
    internal static readonly Guid Staff = Guid.NewGuid();
    internal static readonly Guid Location = Guid.NewGuid();

    internal static IncidentReport Normal() => Submit(IncidentSeverity.Normal, IncidentReporterRole.Tenant);

    internal static IncidentReport Submit(IncidentSeverity severity, IncidentReporterRole role, Guid? location = null) =>
        IncidentReport.Submit("SC-261103-ABC123", role == IncidentReporterRole.Staff ? Staff : Reporter, role,
            location ?? Location, null, null, severity, "Vòi nước rỉ", "Vòi nước bồn rửa bị rỉ liên tục", [], Now,
            TimeSpan.FromMinutes(30));

    internal static EvidenceRef Photo(EvidenceKind kind) =>
        new($"incident-evidence/{Guid.NewGuid():N}", kind, Owner, Now, 1000, "image/jpeg");

    // ---- UC-26 ----

    [Fact]
    public void SubmitStartsAsSubmitted()
    {
        var report = Normal();
        Assert.Equal(IncidentStatus.Submitted, report.Status);
        Assert.Null(report.AckDueAt);
    }

    [Theory]
    [InlineData("")]
    [InlineData("quá ngắn")]
    public void DescriptionMustHaveAtLeastTenCharacters(string description)
    {
        var error = Assert.Throws<MaintenanceValidationException>(() => IncidentReport.Submit("SC-1", Reporter,
            IncidentReporterRole.Tenant, Location, null, null, IncidentSeverity.Normal, "Tiêu đề", description, [], Now,
            TimeSpan.FromMinutes(30)));
        Assert.Equal("description_too_short", error.Code);
    }

    [Fact]
    public void AtMostFivePhotos()
    {
        var photos = Enumerable.Range(0, 6).Select(_ => Photo(EvidenceKind.Report)).ToArray();
        var error = Assert.Throws<MaintenanceValidationException>(() => IncidentReport.Submit("SC-1", Reporter,
            IncidentReporterRole.Tenant, Location, null, null, IncidentSeverity.Normal, "Tiêu đề", "Mô tả đủ dài rồi", photos,
            Now, TimeSpan.FromMinutes(30)));
        Assert.Equal("too_many_evidence_files", error.Code);
    }

    [Fact]
    public void ReporterCanCancelBeforeOwnerDecision()
    {
        var report = Normal();
        report.CancelByReporter(Reporter, null, Now);
        Assert.Equal(IncidentStatus.Cancelled, report.Status);
    }

    [Fact]
    public void ReporterCannotCancelAfterOwnerDecision()
    {
        var report = Normal();
        MaintenanceWorkOrder.Create(report, Owner, Staff, "Thay vòi", null, null, Now);
        Assert.Throws<MaintenanceStateException>(() => report.CancelByReporter(Reporter, null, Now));
    }

    [Fact]
    public void OwnerCancelNeedsReasonAndNoOpenWorkOrder()
    {
        var report = Normal();
        Assert.Throws<MaintenanceValidationException>(() => report.CancelByOwner(Owner, " ", false, Now));
        Assert.Throws<MaintenanceStateException>(() => report.CancelByOwner(Owner, "Báo nhầm", true, Now));
        report.CancelByOwner(Owner, "Báo nhầm", false, Now);
        Assert.Equal(IncidentStatus.Cancelled, report.Status);
        Assert.Equal("Báo nhầm", report.CancelReason);
    }

    // ---- UC-27 ----

    [Fact]
    public void EmergencyGetsAcknowledgementDeadline()
    {
        var report = Submit(IncidentSeverity.OperationalEmergency, IncidentReporterRole.Tenant);
        Assert.Equal(Now.AddMinutes(30), report.AckDueAt);
        Assert.Null(report.AcknowledgedAt);
    }

    [Fact]
    public void StaffReportingEmergencyOnSiteIsAlreadyAcknowledged()
    {
        var report = Submit(IncidentSeverity.OperationalEmergency, IncidentReporterRole.Staff);
        Assert.Equal(Staff, report.AcknowledgedByUserId);
    }

    [Fact]
    public void AcknowledgeOnlyOnceAndStaysSubmitted()
    {
        var report = Submit(IncidentSeverity.OperationalEmergency, IncidentReporterRole.Tenant);
        report.Acknowledge(Staff, Now);
        Assert.Equal(IncidentStatus.Submitted, report.Status);
        Assert.Throws<MaintenanceStateException>(() => report.Acknowledge(Staff, Now));
    }

    [Fact]
    public void NormalReportCannotBeAcknowledged() =>
        Assert.Throws<MaintenanceStateException>(() => Normal().Acknowledge(Staff, Now));

    [Fact]
    public void ImmediateActionsNeedAcknowledgementAndAreAppendOnly()
    {
        var report = Submit(IncidentSeverity.OperationalEmergency, IncidentReporterRole.Tenant);
        Assert.Throws<MaintenanceStateException>(() => report.AddImmediateAction(Staff, "Khóa van", null, [], Now));

        report.Acknowledge(Staff, Now);
        report.AddImmediateAction(Staff, "Khóa van tổng", null, [], Now);
        var first = report.ImmediateActions.ToArray();
        report.AddImmediateAction(Staff, "Ngắt aptomat", 50_000m, [Photo(EvidenceKind.Emergency)], Now.AddMinutes(5));

        Assert.Equal(first, report.ImmediateActions.Take(first.Length));
        Assert.Equal(3, report.ImmediateActions.Count);
        Assert.Single(report.Evidence);
    }

    [Fact]
    public void OverdueFlagIsSetOnceAfterDeadline()
    {
        var report = Submit(IncidentSeverity.OperationalEmergency, IncidentReporterRole.Tenant);
        Assert.False(report.MarkAcknowledgementOverdue(Now.AddMinutes(29)));
        Assert.True(report.MarkAcknowledgementOverdue(Now.AddMinutes(30)));
        Assert.False(report.MarkAcknowledgementOverdue(Now.AddMinutes(31)));
        Assert.NotNull(report.EscalatedAt);
    }

    // ---- UC-28 ----

    [Fact]
    public void RejectNeedsReason()
    {
        var report = Normal();
        Assert.Throws<MaintenanceValidationException>(() => report.Reject(Owner, "", Now));
        report.Reject(Owner, "Không phải sự cố", Now);
        Assert.Equal(IncidentStatus.Rejected, report.Status);
        Assert.Equal(IncidentDecision.Rejected, report.OwnerDecision);
    }

    [Fact]
    public void DuplicateLinksOriginalInSameLocation()
    {
        var original = Normal();
        var copy = Normal();
        copy.MarkDuplicate(Owner, original, null, Now);
        Assert.Equal(IncidentStatus.Duplicate, copy.Status);
        Assert.Equal(original.Id, copy.DuplicateOfReportId);
    }

    [Fact]
    public void DuplicateRejectsSelfOtherLocationAndClosedOriginal()
    {
        var report = Normal();
        Assert.Throws<MaintenanceValidationException>(() => report.MarkDuplicate(Owner, report, null, Now));

        var elsewhere = Submit(IncidentSeverity.Normal, IncidentReporterRole.Tenant, Guid.NewGuid());
        Assert.Throws<MaintenanceValidationException>(() => report.MarkDuplicate(Owner, elsewhere, null, Now));

        var rejected = Normal();
        rejected.Reject(Owner, "Sai", Now);
        Assert.Throws<MaintenanceStateException>(() => report.MarkDuplicate(Owner, rejected, null, Now));
    }

    [Fact]
    public void ResolveDirectlyNeedsAtLeastOnePhoto()
    {
        var report = Normal();
        Assert.Throws<MaintenanceValidationException>(() => report.ResolveDirectly(Owner, "Đã thay vòi", [], false, Now));
        report.ResolveDirectly(Owner, "Đã thay vòi", [Photo(EvidenceKind.Resolution)], false, Now);
        Assert.Equal(IncidentStatus.Resolved, report.Status);
        Assert.Equal(IncidentDecision.HandledDirectly, report.OwnerDecision);
    }

    [Fact]
    public void ResolveWithoutActionIsBlockedByOpenWorkOrders()
    {
        var report = Normal();
        Assert.Throws<MaintenanceStateException>(() => report.ResolveWithoutAction(Owner, "Không cần xử lý", true, Now));
        report.ResolveWithoutAction(Owner, "Không cần xử lý", false, Now);
        Assert.Equal(IncidentStatus.Resolved, report.Status);
    }

    // ---- UC-30 step 9 ----

    [Theory]
    [InlineData(new[] { WorkOrderStatus.Verified }, true)]
    [InlineData(new[] { WorkOrderStatus.Verified, WorkOrderStatus.Cancelled }, true)]
    [InlineData(new[] { WorkOrderStatus.Verified, WorkOrderStatus.InProgress }, false)]
    [InlineData(new[] { WorkOrderStatus.Cancelled, WorkOrderStatus.Cancelled }, false)]
    public void ResolvedOnlyWhenAllDoneAndOneVerified(WorkOrderStatus[] statuses, bool resolved)
    {
        var report = Normal();
        MaintenanceWorkOrder.Create(report, Owner, Staff, "Thay vòi", null, null, Now);
        Assert.Equal(resolved, report.TryResolveFromWorkOrders(statuses, Now));
        Assert.Equal(resolved ? IncidentStatus.Resolved : IncidentStatus.InProgress, report.Status);
    }
}
