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
    [Fact]
    public void FastRepairUsesPolicyEvidenceAndAlwaysRequiresVerification()
    {
        var work = new MaintenanceWorkOrder { EstimatedCost = 0 };
        work.StartFastRepair(2, "Owner-enabled category", DateTimeOffset.UtcNow);
        Assert.False(work.PlanApproved); Assert.True(work.ExecutionAuthorized);
        Assert.Null(work.ApprovedById); Assert.Null(work.ApprovedAt);
        Assert.Throws<InvalidOperationException>(() => work.Verify(Guid.NewGuid(), DateTimeOffset.UtcNow));
        work.Submit(Guid.NewGuid()); work.Rework(); work.Submit(Guid.NewGuid());
        work.Verify(Guid.NewGuid(), DateTimeOffset.UtcNow);
        Assert.Equal(WorkOrderStatus.Verified, work.Status);
    }
    [Theory]
    [InlineData(1, false)]
    [InlineData(0, true)]
    public void FastRepairRejectsAnyCostOrMaterials(int cost, bool materials)
    {
        var work = new MaintenanceWorkOrder { EstimatedCost = cost, UsesMaterials = materials };
        Assert.Throws<InvalidOperationException>(() => work.StartFastRepair(1, "Category", DateTimeOffset.UtcNow));
    }
    [Fact]
    public void FallbackStopsExecutionUntilNewProposalApproval()
    {
        var work = new MaintenanceWorkOrder { EstimatedCost = 0 };
        work.StartFastRepair(1, "Category", DateTimeOffset.UtcNow); work.RequireNormalApproval();
        Assert.Equal(WorkOrderStatus.Assigned, work.Status); Assert.False(work.ExecutionAuthorized);
        Assert.Null(work.FastRepairPolicyVersion);
        Assert.Throws<InvalidOperationException>(() => work.Submit(Guid.NewGuid()));
        work.EstimatedCost = 100000; work.Propose();
        Assert.Throws<InvalidOperationException>(work.Start);
        work.DecidePlan(true, Guid.NewGuid(), DateTimeOffset.UtcNow); work.Start();
        Assert.True(work.ExecutionAuthorized);
    }
}
