using BHome.Application.IncidentMaintenance;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Infrastructure.UnitTests.UnitTestDoc.BF07;

// Sheet "BF-07 Incident" - nhóm thực hiện sửa chữa: submitRepairProposal, reviewRepairPlan, startRepair,
// recordRepairProgress, submitForVerification, updateAssetRepairStatus (UTC38-UTC52).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký).
public sealed class BF07RepairUnitTests
{
    private readonly IncidentTestWorld world = new();

    private Task<Guid> ReportAsync(Guid? assetId = null) =>
        world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA, assetId: assetId);

    // UTC38 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Assigned to Staff S1
    // Đầu vào : inspectionResult='Gioăng hỏng'; beforeEvidence=1 image; proposedSolution='Thay gioăng'; estimatedTime='1 giờ'; estimatedCost=empty
    // Mong đợi: Return: Work Order status=Pending Approval; Owner notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 NF 3-8 (Estimated Cost where applicable); FE-06 6.2.1
    [Fact(DisplayName = "BF07 UTC38 - Staff gui de xuat sua chua (khong co chi phi): Pending Approval, Owner duoc bao")]
    public async Task UTC38_SubmitRepairProposal()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);
        world.ResetNotifications();

        await world.ProposeAsync(wo, world.StaffS1, estimatedCost: null);

        Assert.Equal(WorkOrderStatus.PendingApproval, world.WorkOrder(wo).Status);
        Assert.True(world.Notified(world.Owner), "Owner chưa được thông báo.");
    }

    // UTC39 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Assigned to Staff S1
    // Đầu vào : actor=Staff S2 (not the assignee); proposedSolution='Thay gioăng'
    // Mong đợi: Return: proposal not accepted; Work Order remains Assigned; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : UC-29 Pre 1-2; Permission Matrix (Staff executes assigned work); MSG03
    // Ghi chú : S2 cũng thuộc Location để chỉ kiểm tra điều kiện "không phải người được giao". MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC39 - Staff khong duoc giao gui de xuat: khong chap nhan")]
    public async Task UTC39_ProposalByOtherStaff()
    {
        world.AssignStaff(world.StaffS2, world.LocationX);
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);

        await Rejection.AssertRejectedAsync(() => world.As(world.StaffS2).ProposeAsync(wo,
            new RepairProposal(world.WorkOrder(wo).Version, "Gioăng hỏng", "Thay gioăng", 60, null, []), Guid.NewGuid(), default));

        Assert.Equal(WorkOrderStatus.Assigned, world.WorkOrder(wo).Status);
    }

    // UTC40 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order in Pending Approval with estimatedCost=200,000
    // Đầu vào : decision=Approve
    // Mong đợi: Return: approval and decision history recorded; Staff may start the approved work; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 NF 9-11; GBR-03
    [Fact(DisplayName = "BF07 UTC40 - Owner duyet ke hoach 200.000: ghi nhan duyet, Staff duoc bat dau")]
    public async Task UTC40_ApprovePlan()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);
        await world.ProposeAsync(wo, world.StaffS1, 200_000m);
        var historyBefore = world.Repository.Activities.Count;

        await world.DecidePlanAsync(wo, approve: true);

        var workOrder = world.WorkOrder(wo);
        Assert.True(workOrder.PlanApproved);
        Assert.Equal(world.Owner, workOrder.ApprovedById);
        Assert.NotNull(workOrder.ApprovedAt);
        Assert.True(world.Repository.Activities.Count > historyBefore, "Lịch sử quyết định chưa được ghi.");
        Assert.True((await world.As(world.StaffS1).WorkOrderAsync(wo, default)).CanStart, "Staff chưa được phép bắt đầu công việc đã duyệt.");
    }

    // UTC41 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Proposal submitted with cost=900,000
    // Đầu vào : decision=Reject; reason='Chi phí cao, chỉ thay gioăng'
    // Mong đợi: Return: status=Assigned, plan not approved, rejection reason saved; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 A1; FE-06 6.2.1 Decision Reason
    [Fact(DisplayName = "BF07 UTC41 - Owner tu choi ke hoach 900.000: ve Assigned, luu ly do")]
    public async Task UTC41_RejectPlan()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);
        await world.ProposeAsync(wo, world.StaffS1, 900_000m);

        await world.DecidePlanAsync(wo, approve: false, reason: "Chi phí cao, chỉ thay gioăng");

        var workOrder = world.WorkOrder(wo);
        Assert.Equal(WorkOrderStatus.Assigned, workOrder.Status);
        Assert.False(workOrder.PlanApproved);
        Assert.Contains(world.Repository.Activities, a => a.WorkOrderId == wo && a.Note.Contains("Chi phí cao, chỉ thay gioăng"));
    }

    // UTC42 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Assigned; no proposal submitted
    // Đầu vào : decision=Approve
    // Mong đợi: Return: approval not possible; Work Order remains Assigned; Exception: N/A; Log Message: N/A
    // Căn cứ  : MaintenanceWorkOrder lifecycle (Assigned -> Pending Approval -> In Progress); UC-29 NF 8-10
    [Fact(DisplayName = "BF07 UTC42 - Duyet khi chua co de xuat: khong cho duyet")]
    public async Task UTC42_ApproveWithoutProposal()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);

        await Rejection.AssertRejectedAsync(() => world.DecidePlanAsync(wo, approve: true));

        Assert.Equal(WorkOrderStatus.Assigned, world.WorkOrder(wo).Status);
    }

    // UTC43 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order proposal approved by Owner; assigned to Staff S1; no related Asset
    // Đầu vào : actor=S1; action=start approved work
    // Mong đợi: Return: Work Order status=In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 NF 12-13
    [Fact(DisplayName = "BF07 UTC43 - S1 bat dau cong viec da duyet: In Progress")]
    public async Task UTC43_StartApprovedWork()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);
        await world.ProposeAsync(wo, world.StaffS1, 200_000m);
        await world.DecidePlanAsync(wo, approve: true);

        await world.StartAsync(wo, world.StaffS1);

        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo).Status);
    }

    // UTC44 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Proposal submitted (Pending Approval), not yet approved
    // Đầu vào : actor=assigned Staff; action=start work
    // Mong đợi: Return: work not started; Work Order remains Pending Approval; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 NF 10-13 (start approved work only); GBR-03
    [Fact(DisplayName = "BF07 UTC44 - Bat dau khi chua duyet: khong cho bat dau")]
    public async Task UTC44_StartBeforeApproval()
    {
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS1);
        await world.ProposeAsync(wo, world.StaffS1, 200_000m);

        await Rejection.AssertRejectedAsync(() => world.StartAsync(wo, world.StaffS1));

        Assert.Equal(WorkOrderStatus.PendingApproval, world.WorkOrder(wo).Status);
    }

    // UTC45 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff S1 assigned to the Location; Work Order assigned to Staff S2
    // Đầu vào : actor=S1; action=open/start the Work Order
    // Mong đợi: Return: access denied; Work Order unchanged; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : UC-29 Pre 1; Permission Matrix (Staff executes assigned work); MSG03
    // Ghi chú : MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC45 - S1 mo/bat dau Work Order cua S2: bi tu choi")]
    public async Task UTC45_StaffOpensOthersWorkOrder()
    {
        world.AssignStaff(world.StaffS2, world.LocationX);
        var wo = await world.AssignAsync(await ReportAsync(), world.StaffS2);
        await world.ProposeAsync(wo, world.StaffS2, 200_000m);
        await world.DecidePlanAsync(wo, approve: true);
        var statusBefore = world.WorkOrder(wo).Status;

        var open = await Record.ExceptionAsync(() => world.As(world.StaffS1).WorkOrderAsync(wo, default));
        var start = await Record.ExceptionAsync(() => world.StartAsync(wo, world.StaffS1));
        Assert.True(open is IncidentException or UnauthorizedAccessException, "S1 vẫn mở được Work Order giao cho S2.");
        Assert.True(start is IncidentException or UnauthorizedAccessException, "S1 vẫn bắt đầu được Work Order giao cho S2.");

        Assert.Equal(statusBefore, world.WorkOrder(wo).Status);
        Assert.Equal(world.StaffS2, world.WorkOrder(wo).AssignedStaffId);
    }

    // UTC46 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order InProgress
    // Đầu vào : type=Blocker; note='Thiếu linh kiện'
    // Mong đợi: Return: blocker recorded; status stays InProgress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 A2 (Work Order remains open); FE-06 6.2.2 Blocker / Issue
    // Ghi chú : hệ thống không có tham số "type"; ghi vướng mắc bằng thao tác cập nhật tiến độ với ghi chú.
    [Fact(DisplayName = "BF07 UTC46 - Ghi vuong mac 'Thieu linh kien': van In Progress")]
    public async Task UTC46_RecordBlocker()
    {
        var wo = await world.WorkOrderInProgressAsync(await ReportAsync(), world.StaffS1);

        await world.As(world.StaffS1).ActAsync(wo, "progress", new WorkOrderAction(world.WorkOrder(wo).Version, "Blocker: Thiếu linh kiện"),
            Guid.NewGuid(), default);

        Assert.Contains(world.Repository.Activities, a => a.WorkOrderId == wo && a.Note.Contains("Thiếu linh kiện"));
        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo).Status);
    }

    // UTC47 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order In Progress assigned to Staff S1
    // Đầu vào : result='Đã thay gioăng, hết rỉ'; afterPhotos=1 image
    // Mong đợi: Return: Work Order status=Pending Verification; Owner notified; Exception: N/A; Log Message: "Repair result submitted for Owner verification."
    // Căn cứ  : UC-29 NF 16-20; MSG14
    // Ghi chú : MSG14 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC47 - Gui ket qua kem anh sau sua: Pending Verification, Owner duoc bao")]
    public async Task UTC47_SubmitForVerification()
    {
        var wo = await world.WorkOrderInProgressAsync(await ReportAsync(), world.StaffS1);
        world.ResetNotifications();

        await world.SubmitResultAsync(wo, world.StaffS1, "Đã thay gioăng, hết rỉ");

        Assert.Equal(WorkOrderStatus.PendingVerification, world.WorkOrder(wo).Status);
        Assert.True(world.Notified(world.Owner), "Owner chưa được thông báo.");
    }

    // UTC48 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order In Progress
    // Đầu vào : result='Đã sửa'; afterPhotos=0
    // Mong đợi: Return: submission for verification blocked; Work Order remains In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 NF 17 (at least one after-handling photo), A7
    [Fact(DisplayName = "BF07 UTC48 - Gui ket qua khong co anh: bi chan")]
    public async Task UTC48_SubmitWithoutPhoto()
    {
        var wo = await world.WorkOrderInProgressAsync(await ReportAsync(), world.StaffS1);

        await Rejection.AssertRejectedAsync(() => world.As(world.StaffS1).ActAsync(wo, "submit",
            new WorkOrderAction(world.WorkOrder(wo).Version, "Đã sửa", []), Guid.NewGuid(), default));

        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo).Status);
    }

    // UTC49 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order In Progress
    // Đầu vào : result='Đã sửa'; photos=1 before-repair image only
    // Mong đợi: Return: submission for verification blocked; after-handling evidence required; Work Order remains In Progress; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 NF 17, A7
    [Fact(DisplayName = "BF07 UTC49 - Gui ket qua chi co anh truoc sua: bi chan")]
    public async Task UTC49_SubmitWithBeforePhotoOnly()
    {
        var wo = await world.WorkOrderInProgressAsync(await ReportAsync(), world.StaffS1);
        // Ảnh trước khi sửa = ảnh kiểm tra đã gửi kèm đề xuất sửa chữa.
        var beforePhoto = world.Repository.Evidence.First(e => e.WorkOrderId == wo && e.Kind == IncidentEvidenceKind.Inspection).Id;

        var error = await Rejection.AssertRejectedAsync(() => world.As(world.StaffS1).ActAsync(wo, "submit",
            new WorkOrderAction(world.WorkOrder(wo).Version, "Đã sửa", [beforePhoto]), Guid.NewGuid(), default));

        Rejection.AssertIdentifies(error, "image", "photo", "evidence", "completion");
        Assert.Equal(WorkOrderStatus.InProgress, world.WorkOrder(wo).Status);
    }

    // UTC50 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Asset Active and linked to a Submitted report
    // Đầu vào : Owner creates Work Order with the Asset linked; Staff starts the approved work
    // Mong đợi: Return: Asset=Needs Repair after Work Order creation; Asset=Under Repair after start; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-28 NF 10; UC-29 NF 13; Asset lifecycle
    [Fact(DisplayName = "BF07 UTC50 - Tai san: Needs Repair khi tao Work Order, Under Repair khi bat dau")]
    public async Task UTC50_AssetStatusDuringRepair()
    {
        var asset = world.AddAsset(world.RoomA, AssetStatus.Active);
        var wo = await world.AssignAsync(await ReportAsync(asset.Id), world.StaffS1);
        Assert.Equal(AssetStatus.NeedsRepair, asset.Status);

        await world.ProposeAsync(wo, world.StaffS1, 200_000m);
        await world.DecidePlanAsync(wo, approve: true);
        await world.StartAsync(wo, world.StaffS1);

        Assert.Equal(AssetStatus.UnderRepair, asset.Status);
    }

    // UTC51 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Asset Under Repair; linked Work Order Pending Verification
    // Đầu vào : Owner confirms the result (Verified)
    // Mong đợi: Return: Asset=Active; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 NF 5; Asset lifecycle
    [Fact(DisplayName = "BF07 UTC51 - Owner nghiem thu: tai san ve Active")]
    public async Task UTC51_AssetActiveAfterVerification()
    {
        var asset = world.AddAsset(world.RoomA, AssetStatus.Active);
        var wo = await world.WorkOrderPendingVerificationAsync(await ReportAsync(asset.Id), world.StaffS1);
        Assert.Equal(AssetStatus.UnderRepair, asset.Status);

        await world.VerifyAsync(wo, 200_000m);

        Assert.Equal(AssetStatus.Active, asset.Status);
    }

    // UTC52 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order Assigned; Staff proposes retirement because the Asset cannot be repaired
    // Đầu vào : decision=Owner approves retirement
    // Mong đợi: Return: Asset=Retired; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-29 A5; Asset lifecycle
    // Ghi chú : không có thao tác riêng "đề xuất thanh lý"; Staff gửi đề xuất sửa chữa với giải pháp thanh lý, Owner duyệt kế hoạch.
    [Fact(DisplayName = "BF07 UTC52 - Owner duyet de xuat thanh ly tai san: Retired")]
    public async Task UTC52_ApproveAssetRetirement()
    {
        var asset = world.AddAsset(world.RoomA, AssetStatus.Active);
        var wo = await world.AssignAsync(await ReportAsync(asset.Id), world.StaffS1);
        await world.ProposeAsync(wo, world.StaffS1, null, "Thanh lý tài sản: không thể sửa chữa");

        await world.DecidePlanAsync(wo, approve: true);

        Assert.Equal(AssetStatus.Retired, asset.Status);
    }
}
