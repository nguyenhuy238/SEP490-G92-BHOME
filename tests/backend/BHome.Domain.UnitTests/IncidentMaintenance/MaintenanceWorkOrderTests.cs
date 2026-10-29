using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using static BHome.Domain.UnitTests.IncidentMaintenance.IncidentReportTests;

namespace BHome.Domain.UnitTests.IncidentMaintenance;

public sealed class MaintenanceWorkOrderTests
{
    private static MaintenanceWorkOrder Assigned(IncidentReport? report = null) =>
        MaintenanceWorkOrder.Create(report ?? Normal(), Owner, Staff, "Kiểm tra và thay vòi nước", "Không còn rỉ", null, Now);

    private static MaintenanceWorkOrder InProgress(decimal? estimate = 200_000m)
    {
        var order = Assigned();
        order.SubmitProposal(Staff, "Gioăng hỏng", "Thay gioăng", "1 giờ", estimate, [], Now);
        order.ApprovePlan(Owner, Now);
        order.Start(Staff, Now);
        return order;
    }

    private static MaintenanceWorkOrder PendingVerification(decimal? estimate = 200_000m)
    {
        var order = InProgress(estimate);
        order.SubmitForVerification(Staff, "Đã thay gioăng", [Photo(EvidenceKind.After)], Now);
        return order;
    }

    [Fact]
    public void CreateMovesReportToInProgress()
    {
        var report = Normal();
        var order = Assigned(report);
        Assert.Equal(WorkOrderStatus.Assigned, order.Status);
        Assert.Equal(IncidentStatus.InProgress, report.Status);
        Assert.Equal(report.LocationId, order.LocationId);
    }

    [Fact]
    public void ClosedReportCannotGetWorkOrder()
    {
        var report = Normal();
        report.Reject(Owner, "Sai", Now);
        Assert.Throws<MaintenanceStateException>(() => Assigned(report));
    }

    [Fact]
    public void HappyPathFollowsSrsLifecycle()
    {
        var order = PendingVerification();
        order.Verify(Owner, 200_000m, null, Now);

        Assert.Equal(WorkOrderStatus.Verified, order.Status);
        Assert.Equal(
            [WorkOrderEntryType.Created, WorkOrderEntryType.Proposal, WorkOrderEntryType.PlanApproved,
             WorkOrderEntryType.Started, WorkOrderEntryType.Submitted, WorkOrderEntryType.Verified],
            order.History.Select(h => h.Type));
    }

    [Fact]
    public void OnlyAssignedStaffCanWork()
    {
        var order = Assigned();
        Assert.Throws<MaintenanceStateException>(() =>
            order.SubmitProposal(Guid.NewGuid(), "x", "y", "1 giờ", null, [], Now));
    }

    [Fact]
    public void StartRequiresApprovedPlan()
    {
        var order = Assigned();
        order.SubmitProposal(Staff, "Gioăng hỏng", "Thay gioăng", "1 giờ", null, [], Now);
        Assert.Equal(WorkOrderStatus.PendingApproval, order.Status);
        Assert.Throws<MaintenanceStateException>(() => order.Start(Staff, Now));
    }

    [Fact]
    public void RejectedPlanGoesBackToAssignedWithReason()
    {
        var order = Assigned();
        order.SubmitProposal(Staff, "Gioăng hỏng", "Thay cả vòi", "1 giờ", 900_000m, [], Now);
        order.RejectPlan(Owner, "Chi phí cao, chỉ thay gioăng", Now);

        Assert.Equal(WorkOrderStatus.Assigned, order.Status);
        Assert.False(order.IsPlanApproved);
        Assert.Equal("Chi phí cao, chỉ thay gioăng", order.PlanRejectionReason);
    }

    [Fact]
    public void SubmitNeedsAfterPhoto()
    {
        var order = InProgress();
        var error = Assert.Throws<MaintenanceValidationException>(() =>
            order.SubmitForVerification(Staff, "Đã sửa", [], Now));
        Assert.Equal("evidence_required", error.Code);
        Assert.Throws<MaintenanceValidationException>(() =>
            order.SubmitForVerification(Staff, "Đã sửa", [Photo(EvidenceKind.Before)], Now));
    }

    [Fact]
    public void CostDifferentFromEstimateNeedsReason()
    {
        var order = PendingVerification(estimate: 200_000m);
        var error = Assert.Throws<MaintenanceValidationException>(() => order.Verify(Owner, 250_000m, null, Now));
        Assert.Equal("cost_variance_reason_required", error.Code);

        order.Verify(Owner, 250_000m, "Phải thay thêm ống nối", Now);
        Assert.Equal(250_000m, order.ActualCost);
    }

    [Fact]
    public void ReworkReturnsToInProgress()
    {
        var order = PendingVerification();
        Assert.Throws<MaintenanceValidationException>(() => order.RequestRework(Owner, "", Now));
        order.RequestRework(Owner, "Vẫn còn rỉ", Now);
        Assert.Equal(WorkOrderStatus.InProgress, order.Status);
        Assert.Equal("Vẫn còn rỉ", order.ReworkReason);
    }

    [Fact]
    public void CancelNeedsReasonAndClosesOrder()
    {
        var order = Assigned();
        order.Cancel(Owner, "Tenant tự sửa", Now);
        Assert.Equal(WorkOrderStatus.Cancelled, order.Status);
        Assert.Throws<MaintenanceStateException>(() => order.Cancel(Owner, "Lần hai", Now));
    }

    [Fact]
    public void ReassignKeepsStatusAndHistory()
    {
        var order = InProgress();
        var other = Guid.NewGuid();
        order.Reassign(Owner, other, "Staff cũ nghỉ phép", Now);

        Assert.Equal(WorkOrderStatus.InProgress, order.Status);
        Assert.Equal(other, order.AssignedStaffUserId);
        Assert.Equal(WorkOrderEntryType.Reassigned, order.History[^1].Type);
        Assert.Throws<MaintenanceValidationException>(() => order.Reassign(Owner, other, null, Now));
    }

    [Fact]
    public void InvalidStepsAreRejected()
    {
        var order = Assigned();
        Assert.Throws<MaintenanceStateException>(() => order.ApprovePlan(Owner, Now));
        Assert.Throws<MaintenanceStateException>(() => order.Verify(Owner, 0, null, Now));
        Assert.Throws<MaintenanceStateException>(() => order.RequestRework(Owner, "x", Now));
        Assert.Throws<MaintenanceStateException>(() => order.AddProgress(Staff, "x", [], Now));
    }

    // ---- Asset (UC-05, D10) ----

    [Fact]
    public void AssetFollowsMaintenanceStatus()
    {
        var asset = new Asset(Location, null, "BNL-01", "Bình nóng lạnh", "Điện", null);
        asset.MarkNeedsRepair();
        Assert.Equal(AssetStatus.NeedsRepair, asset.Status);
        asset.MarkUnderRepair();
        asset.CompleteRepair(otherOpenWorkOrders: true);
        Assert.Equal(AssetStatus.UnderRepair, asset.Status);
        asset.CompleteRepair(otherOpenWorkOrders: false);
        Assert.Equal(AssetStatus.Active, asset.Status);
    }

    [Fact]
    public void AssetRetireIsBlockedByOpenWorkOrdersAndIsFinal()
    {
        var asset = new Asset(Location, null, "BNL-01", "Bình nóng lạnh", "Điện", null);
        Assert.Throws<MaintenanceStateException>(() => asset.Retire(hasOpenWorkOrders: true));
        asset.Retire(hasOpenWorkOrders: false);
        Assert.Equal(AssetStatus.Retired, asset.Status);
        Assert.Throws<MaintenanceStateException>(() => asset.UpdateCondition("Hỏng"));
    }
}
