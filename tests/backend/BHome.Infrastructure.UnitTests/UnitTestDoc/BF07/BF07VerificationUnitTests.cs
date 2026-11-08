using BHome.Application.IncidentMaintenance;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Infrastructure.UnitTests.UnitTestDoc.BF07;

// Sheet "BF-07 Incident" - nhóm nghiệm thu: verifyWorkOrder, requestRework, cancelWorkOrder, resolveReportFromWorkOrders (UTC53-UTC66).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký).
public sealed class BF07VerificationUnitTests
{
    private readonly IncidentTestWorld world = new();

    private Task<Guid> ReportAsync(Guid? assetId = null) =>
        world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA, assetId: assetId);

    private Task ReworkAsync(Guid wo, string reason) =>
        world.As(world.Owner).ActAsync(wo, "rework", new WorkOrderAction(world.WorkOrder(wo).Version, reason), Guid.NewGuid(), default);

    // UTC53 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order passed proposal, approval, start and submission; estimatedCost=200,000
    // Đầu vào : verification=Accepted; actualCost=200,000
    // Mong đợi: Return: Work Order status=Verified; verifier and verification time recorded; decision and progress history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 NF 4-7; UC-29 NF 11, 15
    [Fact(DisplayName = "BF07 UTC53 - Nghiem thu dat 200.000: Verified, ghi nguoi va thoi diem, giu lich su")]
    public async Task UTC53_VerifyAccepted()
    {
        var wo = await world.WorkOrderPendingVerificationAsync(await ReportAsync(), world.StaffS1, 200_000m);
        var historyBefore = world.Repository.Activities.Where(a => a.WorkOrderId == wo).Select(a => a.Id).ToArray();

        await world.VerifyAsync(wo, 200_000m);

        var workOrder = world.WorkOrder(wo);
        Assert.Equal(WorkOrderStatus.Verified, workOrder.Status);
        Assert.Equal(world.Owner, workOrder.VerifiedById);
        Assert.NotNull(workOrder.VerifiedAt);
        Assert.NotEmpty(historyBefore);
        Assert.All(historyBefore, a => Assert.Contains(world.Repository.Activities, x => x.Id == a));
    }

    // UTC54 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Only Work Order of the report in Pending Verification; estimatedCost=300,000
    // Đầu vào : verification=Accepted; actualCost=300,000
    // Mong đợi: Return: Work Order Verified; OperatingExpense of category Maintenance 300,000 linked to Location, Room, Asset and Work Order; maintenance history updated; report status=Resolved; reporter notified; Exception: N/A; Log Message: "Your report  has been resolved."
    // Căn cứ  : UC-30 NF 6-10; GBR-12; DBR-10; MSG22
    // Ghi chú : MSG22 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC54 - Nghiem thu Work Order duy nhat: chi phi Maintenance 300.000, bao cao Resolved")]
    public async Task UTC54_VerifyCreatesExpenseAndResolves()
    {
        var asset = world.AddAsset(world.RoomA);
        var id = await ReportAsync(asset.Id);
        var wo = await world.WorkOrderPendingVerificationAsync(id, world.StaffS1, 300_000m);
        world.ResetNotifications();

        await world.VerifyAsync(wo, 300_000m);

        Assert.Equal(WorkOrderStatus.Verified, world.WorkOrder(wo).Status);
        var expense = Assert.Single(world.Repository.Expenses);
        Assert.Equal("Maintenance", expense.Category);
        Assert.Equal(300_000m, expense.Amount);
        Assert.Equal(world.LocationX, expense.LocationId);
        Assert.Equal(world.RoomA, expense.RoomId);
        Assert.Equal(asset.Id, expense.AssetId);
        Assert.Equal(wo, expense.WorkOrderId);
        Assert.Contains(world.Repository.Histories, h => h.WorkOrderId == wo);
        Assert.Equal(IncidentStatus.Resolved, world.Report(id).Status);
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC55 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order PendingVerification; estimate=200,000
    // Đầu vào : actualCost=250,000; reason='Phải thay thêm ống nối'
    // Mong đợi: Return: status=Verified, actualCost=250,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 A4
    [Fact(DisplayName = "BF07 UTC55 - Chi phi thuc te 250.000 khac du toan, co ly do: Verified")]
    public async Task UTC55_ActualCostDiffersWithReason()
    {
        var wo = await world.WorkOrderPendingVerificationAsync(await ReportAsync(), world.StaffS1, 200_000m);

        await world.VerifyAsync(wo, 250_000m, "Phải thay thêm ống nối");

        Assert.Equal(WorkOrderStatus.Verified, world.WorkOrder(wo).Status);
        Assert.Equal(250_000m, world.WorkOrder(wo).ActualCost);
    }

    // UTC56 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Pending Verification; estimatedCost=200,000
    // Đầu vào : actualCost=250,000; reason=''
    // Mong đợi: Return: verification not saved; reason for cost difference required; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-30 A4 (Owner records actual cost and the reason); MSG02
    // Ghi chú : MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC56 - Chi phi khac du toan khong co ly do: khong luu nghiem thu")]
    public async Task UTC56_ActualCostDiffersWithoutReason()
    {
        var wo = await world.WorkOrderPendingVerificationAsync(await ReportAsync(), world.StaffS1, 200_000m);

        var error = await Rejection.AssertRejectedAsync(() => world.VerifyAsync(wo, 250_000m, ""));

        Rejection.AssertIdentifies(error, "reason", "variance");
        Assert.Equal(WorkOrderStatus.PendingVerification, world.WorkOrder(wo).Status);
        Assert.Null(world.WorkOrder(wo).VerifiedAt);
    }

    // UTC57 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order in Assigned status
    // Đầu vào : verification=Accepted; actualCost=0
    // Mong đợi: Return: verification not possible; Work Order remains Assigned; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 Pre 1 (Pending Verification)
    [Fact(DisplayName = "BF07 UTC57 - Nghiem thu Work Order dang Assigned: khong cho phep")]
    public async Task UTC57_VerifyAssignedWorkOrder()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);

        await Rejection.AssertRejectedAsync(() => world.VerifyAsync(wo, 0m));

        Assert.Equal(WorkOrderStatus.Assigned, world.WorkOrder(wo).Status);
    }

    // UTC58 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Pending Verification
    // Đầu vào : verification=Rework Required; reason='Vẫn còn rỉ'
    // Mong đợi: Return: Work Order status=In Progress with rework reason recorded; Staff notified; Exception: N/A; Log Message: "Work Order returned for rework: reason."
    // Căn cứ  : UC-30 A1; FE-06 6.3.1; MSG21; MSG15
    // Ghi chú : MSG21 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC58 - Yeu cau lam lai 'Van con ri': ve In Progress, Staff duoc bao")]
    public async Task UTC58_RequestRework()
    {
        var wo = await world.WorkOrderPendingVerificationAsync(await ReportAsync(), world.StaffS1);
        world.ResetNotifications();

        await ReworkAsync(wo, "Vẫn còn rỉ");

        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo).Status);
        Assert.Contains(world.Repository.Activities, a => a.WorkOrderId == wo && a.Note.Contains("Vẫn còn rỉ"));
        Assert.True(world.Notified(world.StaffS1), "Staff chưa được thông báo.");
    }

    // UTC59 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Pending Verification
    // Đầu vào : verification=Rework Required; reason=''
    // Mong đợi: Return: rework not saved; reason identified as mandatory; Work Order remains Pending Verification; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-30 A1 (mandatory reason); MSG02
    // Ghi chú : MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC59 - Yeu cau lam lai khong co ly do: khong luu")]
    public async Task UTC59_ReworkWithoutReason()
    {
        var wo = await world.WorkOrderPendingVerificationAsync(await ReportAsync(), world.StaffS1);

        var error = await Rejection.AssertRejectedAsync(() => ReworkAsync(wo, ""));

        Rejection.AssertIdentifies(error, "reason", "note");
        Assert.Equal(WorkOrderStatus.PendingVerification, world.WorkOrder(wo).Status);
    }

    // UTC60 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Assigned
    // Đầu vào : reason='Tenant tự sửa'
    // Mong đợi: Return: status=Cancelled; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 A3; MaintenanceWorkOrder lifecycle
    [Fact(DisplayName = "BF07 UTC60 - Huy Work Order dang Assigned: Cancelled")]
    public async Task UTC60_CancelAssignedWorkOrder()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);

        await world.CancelWorkOrderAsync(wo, "Tenant tự sửa");

        Assert.Equal(WorkOrderStatus.Cancelled, world.WorkOrder(wo).Status);
    }

    // UTC61 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Cancelled
    // Đầu vào : action=cancel; reason='Lần hai'
    // Mong đợi: Return: cancellation not possible; Work Order remains Cancelled; Exception: N/A; Log Message: N/A
    // Căn cứ  : MaintenanceWorkOrder lifecycle (Cancelled is final)
    [Fact(DisplayName = "BF07 UTC61 - Huy lan hai Work Order da Cancelled: khong cho phep")]
    public async Task UTC61_CancelTwice()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);
        await world.CancelWorkOrderAsync(wo, "Tenant tự sửa");

        await Rejection.AssertRejectedAsync(() => world.CancelWorkOrderAsync(wo, "Lần hai"));

        Assert.Equal(WorkOrderStatus.Cancelled, world.WorkOrder(wo).Status);
    }

    // UTC62 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report In Progress with Work Orders WO1 (Assigned) and WO2 (In Progress)
    // Đầu vào : action=cancel WO1; reason='Trùng phạm vi với WO2'
    // Mong đợi: Return: WO1 status=Cancelled with reason; report remains In Progress because WO2 is unresolved; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 A3
    [Fact(DisplayName = "BF07 UTC62 - Huy WO1 khi WO2 dang lam: bao cao van In Progress")]
    public async Task UTC62_CancelOneOfTwo()
    {
        var id = await ReportAsync();
        var wo2 = await world.WorkOrderInProgressAsync(id, world.StaffS1);
        var wo1 = await world.AssignAsync(id, world.StaffS1);

        await world.CancelWorkOrderAsync(wo1, "Trùng phạm vi với WO2");

        Assert.Equal(WorkOrderStatus.Cancelled, world.WorkOrder(wo1).Status);
        Assert.Contains(world.Repository.Activities, a => a.WorkOrderId == wo1 && a.Note.Contains("Trùng phạm vi với WO2"));
        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo2).Status);
        Assert.Equal(IncidentStatus.InProgress, world.Report(id).Status);
    }

    // UTC63 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report In Progress with one linked Work Order
    // Đầu vào : linked Work Orders=[Verified]
    // Mong đợi: Return: report status=Resolved; reporter notified; Exception: N/A; Log Message: "Your report  has been resolved."
    // Căn cứ  : UC-30 NF 9-10; MSG22
    // Ghi chú : MSG22 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC63 - Work Order duy nhat Verified: bao cao Resolved")]
    public async Task UTC63_OneVerified()
    {
        var id = await ReportAsync();
        var wo = await world.WorkOrderPendingVerificationAsync(id, world.StaffS1);
        world.ResetNotifications();

        await world.VerifyAsync(wo, 200_000m);

        Assert.Equal(IncidentStatus.Resolved, world.Report(id).Status);
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC64 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report In Progress with two linked Work Orders
    // Đầu vào : linked Work Orders=[Verified, Cancelled]
    // Mong đợi: Return: report status=Resolved; reporter notified; Exception: N/A; Log Message: "Your report  has been resolved."
    // Căn cứ  : UC-30 NF 9 (all Verified or Cancelled, at least one Verified)
    // Ghi chú : MSG22 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC64 - [Verified, Cancelled]: bao cao Resolved")]
    public async Task UTC64_VerifiedAndCancelled()
    {
        var id = await ReportAsync();
        var wo1 = await world.WorkOrderPendingVerificationAsync(id, world.StaffS1);
        var wo2 = await world.AssignAsync(id, world.StaffS1);
        await world.CancelWorkOrderAsync(wo2, "Không cần thiết");
        world.ResetNotifications();

        await world.VerifyAsync(wo1, 200_000m);

        Assert.Equal(WorkOrderStatus.Verified, world.WorkOrder(wo1).Status);
        Assert.Equal(WorkOrderStatus.Cancelled, world.WorkOrder(wo2).Status);
        Assert.Equal(IncidentStatus.Resolved, world.Report(id).Status);
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC65 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report In Progress with two linked Work Orders
    // Đầu vào : linked Work Orders=[Verified, In Progress]
    // Mong đợi: Return: report remains In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 NF 9; UC-30 A3
    [Fact(DisplayName = "BF07 UTC65 - [Verified, In Progress]: bao cao van In Progress")]
    public async Task UTC65_VerifiedAndInProgress()
    {
        var id = await ReportAsync();
        var wo1 = await world.WorkOrderPendingVerificationAsync(id, world.StaffS1);
        var wo2 = await world.WorkOrderInProgressAsync(id, world.StaffS1);

        await world.VerifyAsync(wo1, 200_000m);

        Assert.Equal(WorkOrderStatus.Verified, world.WorkOrder(wo1).Status);
        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo2).Status);
        Assert.Equal(IncidentStatus.InProgress, world.Report(id).Status);
    }

    // UTC66 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report In Progress with two linked Work Orders
    // Đầu vào : linked Work Orders=[Cancelled, Cancelled]
    // Mong đợi: Return: report remains In Progress; Owner must create a new Work Order, handle directly (UC-28 A4) or resolve with a resolution note; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 NF 9 (at least one Verified); UC-30 A3
    [Fact(DisplayName = "BF07 UTC66 - [Cancelled, Cancelled]: bao cao van In Progress")]
    public async Task UTC66_BothCancelled()
    {
        var id = await ReportAsync();
        var wo1 = await world.AssignAsync(id, world.StaffS1);
        var wo2 = await world.AssignAsync(id, world.StaffS1);

        await world.CancelWorkOrderAsync(wo1, "Không cần thiết");
        await world.CancelWorkOrderAsync(wo2, "Không cần thiết");

        Assert.Equal(IncidentStatus.InProgress, world.Report(id).Status);
    }
}
