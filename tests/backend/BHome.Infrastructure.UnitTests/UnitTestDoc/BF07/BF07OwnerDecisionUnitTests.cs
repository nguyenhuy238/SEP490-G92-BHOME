using BHome.Application.IncidentMaintenance;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Infrastructure.UnitTests.UnitTestDoc.BF07;

// Sheet "BF-07 Incident" - nhóm Owner xử lý báo cáo: createWorkOrder, rejectIncidentReport, markDuplicateReport,
// resolveReportByOwner, reassignWorkOrder (UTC28-UTC37).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký).
// Log Message (MSG02/MSG19/MSG20/MSG22): hệ thống chỉ trả mã lỗi, không trả câu thông báo -> không quan sát được ở tầng unit.
public sealed class BF07OwnerDecisionUnitTests
{
    private readonly IncidentTestWorld world = new();

    private Task<Guid> TenantReportAsync(Guid? assetId = null, Guid? roomId = null) =>
        world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", roomId ?? world.RoomA, assetId: assetId);

    private Task DecideAsync(Guid id, string action, string reason, Guid? duplicateOf = null) =>
        world.As(world.Owner).DecideAsync(id, action, new IncidentDecision(world.Report(id).Version, reason, duplicateOf), Guid.NewGuid(), default);

    private bool ReasonRecorded(Guid id, string reason) =>
        world.Report(id).ResolutionNote == reason || world.Repository.Activities.Any(a => a.IncidentId == id && a.Note.Contains(reason));

    // UTC28 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Submitted status; Staff S1 actively assigned to the Location
    // Đầu vào : assignedStaff=S1; expectedOutcome='Không còn rỉ'; targetCompletionTime=tomorrow 17:00; category='Cấp thoát nước'
    // Mong đợi: Return: Work Order created in Assigned status and linked to the report; report status=In Progress; S1 notified; Exception: N/A; Log Message: "New Work Order at Location / Room. Target: time."
    // Căn cứ  : UC-28 NF 4-12; MSG20
    // Ghi chú : category được ghi qua bước phân loại của Owner; Log Message MSG20 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC28 - Owner tao Work Order giao S1: Assigned, bao cao In Progress, S1 duoc bao")]
    public async Task UTC28_CreateWorkOrder()
    {
        var id = await TenantReportAsync();
        await world.ClassifyAsync(id, category: "Cấp thoát nước");

        var wo = await world.AssignAsync(id, world.StaffS1, "Không còn rỉ");

        var workOrder = world.WorkOrder(wo);
        Assert.Equal(WorkOrderStatus.Assigned, workOrder.Status);
        Assert.Equal(id, workOrder.IncidentId);
        Assert.Equal(world.StaffS1, workOrder.AssignedStaffId);
        Assert.Equal("Không còn rỉ", workOrder.ExpectedOutcome);
        Assert.Equal("Cấp thoát nước", world.Report(id).Category);
        Assert.Equal(IncidentStatus.InProgress, world.Report(id).Status);
        Assert.True(world.Notified(world.StaffS1), "Staff S1 chưa được thông báo.");
    }

    // UTC29 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Rejected status
    // Đầu vào : assignedStaff=S1; expectedOutcome='Không còn rỉ'
    // Mong đợi: Return: Work Order not created; report remains Rejected; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-28 Pre 1 (Submitted or In Progress)
    [Fact(DisplayName = "BF07 UTC29 - Tao Work Order cho bao cao Rejected: khong tao")]
    public async Task UTC29_CreateWorkOrderOnRejectedReport()
    {
        var id = await TenantReportAsync();
        await DecideAsync(id, "reject", "Không phải sự cố");
        Assert.Equal(IncidentStatus.Rejected, world.Report(id).Status);

        await Rejection.AssertRejectedAsync(() => world.AssignAsync(id, world.StaffS1, "Không còn rỉ"));

        Assert.Empty(world.Repository.WorkOrders);
        Assert.Equal(IncidentStatus.Rejected, world.Report(id).Status);
    }

    // UTC30 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Staff S2 not assigned to the report's Location
    // Đầu vào : assignedStaff=S2; expectedOutcome='Thay ống nước'
    // Mong đợi: Return: Work Order not created; Staff eligibility/Location scope validation fails; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-28 NF 7-8; GBR-02
    [Fact(DisplayName = "BF07 UTC30 - Giao Work Order cho Staff khong thuoc Location: khong tao")]
    public async Task UTC30_StaffOutsideLocation()
    {
        var id = await TenantReportAsync();

        await Rejection.AssertRejectedAsync(() => world.AssignAsync(id, world.StaffS2, "Thay ống nước"));

        Assert.Empty(world.Repository.WorkOrders);
    }

    // UTC31 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Submitted status
    // Đầu vào : decision=Reject; reason='Không phải sự cố'
    // Mong đợi: Return: report status=Rejected with reason recorded; reporter notified; Exception: N/A; Log Message: "Your report  was closed: reason."
    // Căn cứ  : UC-28 A1; MSG19
    // Ghi chú : Log Message MSG19 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC31 - Owner tu choi bao cao co ly do: Rejected, nguoi bao duoc bao")]
    public async Task UTC31_RejectReport()
    {
        var id = await TenantReportAsync();

        await DecideAsync(id, "reject", "Không phải sự cố");

        Assert.Equal(IncidentStatus.Rejected, world.Report(id).Status);
        Assert.True(ReasonRecorded(id, "Không phải sự cố"), "Lý do từ chối chưa được ghi nhận.");
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC32 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Submitted status
    // Đầu vào : decision=Reject; reason=''
    // Mong đợi: Return: rejection not saved; reason identified as mandatory; report remains Submitted; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-28 A1 (mandatory reason); FE-06 6.1.3 Rejection / Duplicate Reason; MSG02
    // Ghi chú : Log Message MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC32 - Tu choi khong co ly do: khong luu")]
    public async Task UTC32_RejectWithoutReason()
    {
        var id = await TenantReportAsync();

        var error = await Rejection.AssertRejectedAsync(() => DecideAsync(id, "reject", ""));

        Rejection.AssertIdentifies(error, "reason");
        Assert.Equal(IncidentStatus.Submitted, world.Report(id).Status);
    }

    // UTC33 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Reports A and B in Submitted status
    // Đầu vào : reportId=B; originalReport=A
    // Mong đợi: Return: report B status=Duplicate linked to original report A; reporter of B notified; Exception: N/A; Log Message: "Your report  was closed: reason."
    // Căn cứ  : UC-28 A2; IncidentReport duplicate-of reference; MSG19
    // Ghi chú : hàm nhận một lý do; sheet không ghi lý do nên dùng 'Trùng với báo cáo đã có'. MSG19 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC33 - Danh dau B trung voi A: Duplicate, lien ket A, nguoi bao B duoc bao")]
    public async Task UTC33_MarkDuplicate()
    {
        var a = await TenantReportAsync();
        var b = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi bồn rửa vẫn rỉ nước liên tục", world.RoomA);
        world.ResetNotifications();

        await DecideAsync(b, "duplicate", "Trùng với báo cáo đã có", a);

        Assert.Equal(IncidentStatus.Duplicate, world.Report(b).Status);
        Assert.Equal(a, world.Report(b).DuplicateOfId);
        Assert.True(world.Notified(world.Tenant), "Người báo của B chưa được thông báo.");
    }

    // UTC34 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Submitted status with related Asset linked
    // Đầu vào : handling=Direct; action='Đã thay vòi'; photos=1 completion image; actualCost=150,000; assetCondition=Active
    // Mong đợi: Return: no Work Order created; Asset=Active; OperatingExpense of category Maintenance (150,000) linked to report, Location, Room and Asset; maintenance history updated; report status=Resolved; reporter notified; Exception: N/A; Log Message: "Your report  has been resolved."
    // Căn cứ  : UC-28 A4; GBR-12; DBR-10; MSG22
    // Ghi chú : Log Message MSG22 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC34 - Owner xu ly truc tiep: khong tao Work Order, chi phi Maintenance 150.000, Resolved")]
    public async Task UTC34_OwnerResolvesDirectly()
    {
        var asset = world.AddAsset(world.RoomA);
        var id = await TenantReportAsync(asset.Id);
        await world.ClassifyAsync(id);
        world.ResetNotifications();
        var photo = await world.UploadAsync(world.Owner, id, null, IncidentEvidenceKind.Direct);

        await world.As(world.Owner).DirectAsync(id, new DirectCompletion(world.Report(id).Version, 150_000m, "Đã thay vòi", [photo], "Tốt", AssetStatus.Active),
            Guid.NewGuid(), default);

        Assert.Empty(world.Repository.WorkOrders);
        Assert.Equal(AssetStatus.Active, asset.Status);
        var expense = Assert.Single(world.Repository.Expenses);
        Assert.Equal("Maintenance", expense.Category);
        Assert.Equal(150_000m, expense.Amount);
        Assert.Equal(id, expense.IncidentId);
        Assert.Equal(world.LocationX, expense.LocationId);
        Assert.Equal(world.RoomA, expense.RoomId);
        Assert.Equal(asset.Id, expense.AssetId);
        Assert.Contains(world.Repository.Histories, h => h.IncidentId == id && h.AssetId == asset.Id);
        Assert.Equal(IncidentStatus.Resolved, world.Report(id).Status);
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC35 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Submitted status
    // Đầu vào : handling=Direct; action='Đã thay vòi'; photos=0; actualCost=150,000
    // Mong đợi: Return: completion not confirmed; completion evidence (at least one photo) required; report remains Submitted; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-28 A4 (at least one photo); MSG02
    // Ghi chú : Log Message MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC35 - Xu ly truc tiep khong co anh: khong xac nhan hoan thanh")]
    public async Task UTC35_DirectWithoutPhoto()
    {
        var id = await TenantReportAsync();
        await world.ClassifyAsync(id);

        var error = await Rejection.AssertRejectedAsync(() => world.As(world.Owner).DirectAsync(id,
            new DirectCompletion(world.Report(id).Version, 150_000m, "Đã thay vòi", [], null, AssetStatus.Active), Guid.NewGuid(), default));

        Rejection.AssertIdentifies(error, "image", "photo", "evidence");
        Assert.Equal(IncidentStatus.Submitted, world.Report(id).Status);
    }

    // UTC36 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report in Submitted status
    // Đầu vào : handling=No operational handling required; resolutionNote='Không cần xử lý'
    // Mong đợi: Return: report status=Resolved with resolution note; reporter notified; Exception: N/A; Log Message: "Your report  has been resolved."
    // Căn cứ  : UC-28 A7; MSG22
    // Ghi chú : Log Message MSG22 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC36 - Khong can xu ly: Resolved voi ghi chu")]
    public async Task UTC36_ResolveWithoutHandling()
    {
        var id = await TenantReportAsync();
        world.ResetNotifications();

        await DecideAsync(id, "resolve", "Không cần xử lý");

        Assert.Equal(IncidentStatus.Resolved, world.Report(id).Status);
        Assert.Equal("Không cần xử lý", world.Report(id).ResolutionNote);
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC37 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order assigned to Staff S1; Staff S2 eligible for the Location
    // Đầu vào : newStaff=S2; reason='Staff cũ nghỉ phép'
    // Mong đợi: Return: Work Order assigned to S2; previous assignment history retained; S2 notified; Exception: N/A; Log Message: "New Work Order at Location / Room. Target: time."
    // Căn cứ  : UC-28 A6; MSG20
    // Ghi chú : Log Message MSG20 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC37 - Giao lai Work Order cho S2: giu lich su giao cu, S2 duoc bao")]
    public async Task UTC37_ReassignWorkOrder()
    {
        world.AssignStaff(world.StaffS2, world.LocationX);
        var id = await TenantReportAsync();
        var wo = await world.AssignAsync(id, world.StaffS1);
        var historyBefore = world.Repository.Activities.Where(a => a.IncidentId == id).Select(a => a.Id).ToArray();

        await world.As(world.Owner).ReassignAsync(wo, new WorkOrderReassign(world.WorkOrder(wo).Version, world.StaffS2, "Staff cũ nghỉ phép"),
            Guid.NewGuid(), default);

        Assert.Equal(world.StaffS2, world.WorkOrder(wo).AssignedStaffId);
        Assert.NotEmpty(historyBefore);
        Assert.All(historyBefore, a => Assert.Contains(world.Repository.Activities, x => x.Id == a));
        Assert.True(world.Notified(world.StaffS2), "Staff S2 chưa được thông báo.");
    }
}
