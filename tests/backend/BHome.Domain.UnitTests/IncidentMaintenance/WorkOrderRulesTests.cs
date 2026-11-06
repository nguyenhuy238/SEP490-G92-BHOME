using BHome.Domain.IncidentMaintenance;

namespace BHome.Domain.UnitTests.IncidentMaintenance;

public sealed class WorkOrderRulesTests
{
    [Fact]
    public void ApprovalIsVersionedAndDoesNotStartWorkUntilStaffStarts()
    {
        var work = new MaintenanceWorkOrder(); var actor = Guid.NewGuid();
        Assert.Throws<InvalidOperationException>(work.Start);
        work.Propose(); work.DecidePlan(true, actor, DateTimeOffset.UtcNow);
        Assert.True(work.PlanApproved); Assert.Equal(WorkOrderStatus.PendingApproval, work.Status);
        work.Propose(); Assert.False(work.PlanApproved);
        Assert.Throws<InvalidOperationException>(work.Start);
        work.DecidePlan(true, actor, DateTimeOffset.UtcNow); work.Start();
        Assert.Equal(WorkOrderStatus.InProgress, work.Status);
        Assert.Throws<InvalidOperationException>(() => work.DecidePlan(true, actor, DateTimeOffset.UtcNow));
        var first = Guid.NewGuid(); work.Submit(first); work.Rework();
        Assert.Null(work.CompletionActivityId); Assert.Null(work.VerifiedAt);
        work.Submit(Guid.NewGuid()); work.Verify(actor, DateTimeOffset.UtcNow);
        Assert.Equal(WorkOrderStatus.Verified, work.Status); Assert.Equal(actor, work.VerifiedById);
        Assert.Throws<InvalidOperationException>(work.Cancel); Assert.Throws<InvalidOperationException>(work.Rework);
    }
    [Theory]
    [InlineData(WorkOrderStatus.Assigned)]
    [InlineData(WorkOrderStatus.InProgress)]
    [InlineData(WorkOrderStatus.PendingApproval)]
    [InlineData(WorkOrderStatus.Cancelled)]
    [InlineData(WorkOrderStatus.Verified)]
    public void VerificationRejectsEveryStateExceptPendingVerification(WorkOrderStatus status)
    {
        var work = new MaintenanceWorkOrder { Status = status };
        Assert.Throws<InvalidOperationException>(() => work.Verify(Guid.NewGuid(), DateTimeOffset.UtcNow));
    }
    [Fact]
    public void RejectedPlanReturnsToAssignedAndRequiresResubmission()
    {
        var work = new MaintenanceWorkOrder(); work.Propose(); work.DecidePlan(false, Guid.NewGuid(), DateTimeOffset.UtcNow);
        Assert.Equal(WorkOrderStatus.Assigned, work.Status); Assert.False(work.PlanApproved);
        Assert.Throws<InvalidOperationException>(work.Start); work.Propose(); Assert.Equal(2, work.ProposalVersion);
    }
    [Fact]
    public void ClosureRequiresAtLeastOneVerifiedAndNoOpenOrders()
    {
        Assert.False(IncidentReport.CanResolve([]));
        Assert.False(IncidentReport.CanResolve([WorkOrderStatus.Cancelled]));
        Assert.False(IncidentReport.CanResolve([WorkOrderStatus.Verified, WorkOrderStatus.PendingVerification]));
        Assert.True(IncidentReport.CanResolve([WorkOrderStatus.Verified, WorkOrderStatus.Cancelled]));
        Assert.True(IncidentReport.CanResolve([WorkOrderStatus.Verified, WorkOrderStatus.Verified]));
    }
}
