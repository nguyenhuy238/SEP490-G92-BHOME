using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Jobs;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF08;

// Unit test cho recordMaintenanceExpense - sheet "BF-08 Finance Reporting".
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: UC-30, UC-28 A4, DBR-10, GBR-12, NFR 2.4).
// Chỉ dùng danh mục chữ ký để biết cách gọi: IncidentService.VerifyAsync (Owner xác nhận Work Order) và
// IncidentService.DirectAsync (Owner tự xử lý sự cố không qua Work Order).
// Kho dữ liệu sự cố là bản trong bộ nhớ (InMemoryIncidentRepository) dựng theo Điều kiện của sheet;
// các phụ thuộc còn lại (file, hàng đợi job, phân công Staff) giả lập bằng NSubstitute.
public sealed class MaintenanceExpenseUnitTests
{
    private readonly InMemoryIncidentRepository repository = new() { OwnerId = Bf08.Owner1 };

    private IncidentService Service()
    {
        var user = Bf08.OwnerUser();
        var permissions = new PermissionAccess(user, new ResourceAccess(user, Substitute.For<IStaffLocationAccess>()));
        return new IncidentService(repository, user, permissions, Substitute.For<IIncidentFiles>(),
            Substitute.For<IBackgroundJobQueue>(), Bf08.Clock());
    }

    private IncidentReport Incident(IncidentStatus status)
    {
        var incident = new IncidentReport
        {
            LocationId = Bf08.L1,
            RoomId = Bf08.Room1,
            AssetId = Bf08.Asset1,
            ReporterId = Bf08.Owner1,
            ReporterRole = Roles.Owner,
            Description = "Voi nuoc ro ri",
            Severity = IncidentSeverity.Normal,
            Status = status,
            Type = "Repair",
            Category = "Plumbing",
            Version = 1
        };
        Bf08.SetId(incident, Guid.NewGuid());
        repository.Incidents[incident.Id] = incident;
        repository.Assets[Bf08.Asset1] = Bf08.SetId(new Asset
        {
            LocationId = Bf08.L1,
            RoomId = Bf08.Room1,
            Name = "Voi nuoc",
            Category = "Plumbing",
            Condition = "Hong",
            Status = AssetStatus.UnderRepair,
            Version = 1
        }, Bf08.Asset1);
        return incident;
    }

    private MaintenanceWorkOrder WorkOrder(IncidentReport incident, WorkOrderStatus status, decimal? actualCost = null)
    {
        var workOrder = new MaintenanceWorkOrder
        {
            IncidentId = incident.Id,
            LocationId = Bf08.L1,
            RoomId = Bf08.Room1,
            AssetId = Bf08.Asset1,
            AssignedStaffId = Bf08.Staff1,
            ExpectedOutcome = "Het ro ri",
            TargetCompletionAt = Bf08.Now.AddDays(1),
            Status = status,
            InspectionResult = "Hong gioang",
            ProposedSolution = "Thay gioang",
            EstimatedMinutes = 60,
            EstimatedCost = 1_000_000m,
            ProposalVersion = 1,
            ApprovedProposalVersion = 1,
            ApprovedById = Bf08.Owner1,
            ApprovedAt = Bf08.Now.AddDays(-1),
            Result = "Da thay gioang",
            ActualCost = actualCost,
            Version = 1
        };
        Bf08.SetId(workOrder, Guid.NewGuid());
        repository.WorkOrderStore[workOrder.Id] = workOrder;
        // SRS UC-30 Precondition 3 / UC-29 Postcondition: Work Order ở Pending Verification có sẵn bằng chứng hoàn thành.
        var completion = Guid.NewGuid();
        workOrder.CompletionActivityId = completion;
        repository.Evidence.Add(Bf08.SetId(new IncidentEvidence
        {
            IncidentId = incident.Id,
            WorkOrderId = workOrder.Id,
            ActivityId = completion,
            UploadedById = Bf08.Staff1,
            Kind = IncidentEvidenceKind.Completion,
            ObjectKey = $"incidents/{incident.Id}/completion.jpg",
            ContentType = "image/jpeg",
            Sha256 = new string('b', 64),
            Length = 1024
        }, Guid.NewGuid()));
        return workOrder;
    }

    // UTC08 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order WO1 Pending Verification; Owner confirms result; actual cost 1,000,000
    // Đầu vào : workOrderId=WO1; actualCost=1000000
    // Mong đợi: Return: Work Order Verified; OperatingExpense category Maintenance 1,000,000 created and linked to Location, Room, Asset and WO1; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 NF 4-6; DBR-10; GBR-12
    // Ghi chú : dữ liệu dựng thêm bằng chứng hoàn thành cho WO1 theo SRS UC-30 Precondition 3 ("Completion evidence is available").
    [Fact(DisplayName = "BF08 UTC08 - Owner xac nhan WO1, chi phi 1.000.000: WO1 Verified, tao chi phi Maintenance lien ket")]
    public async Task UTC08_VerifyingWorkOrderCreatesMaintenanceExpense()
    {
        var incident = Incident(IncidentStatus.InProgress);
        var wo1 = WorkOrder(incident, WorkOrderStatus.PendingVerification);

        await Service().VerifyAsync(wo1.Id, new MaintenanceVerification(wo1.Version, 1_000_000m, "Da sua xong", null, "Tot", AssetStatus.Active),
            Guid.NewGuid(), default);

        Assert.Equal(WorkOrderStatus.Verified, repository.WorkOrderStore[wo1.Id].Status);
        var expense = Assert.Single(repository.MaintenanceExpenses);
        Assert.Equal("Maintenance", expense.Category, ignoreCase: true);
        Assert.Equal(1_000_000m, expense.Amount);
        Assert.Equal(Bf08.L1, expense.LocationId);
        Assert.Equal(Bf08.Room1, expense.RoomId);
        Assert.Equal(Bf08.Asset1, expense.AssetId);
        Assert.Equal(wo1.Id, expense.WorkOrderId);
    }

    // UTC09 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Work Order WO1 already Verified with its Maintenance OperatingExpense
    // Đầu vào : workOrderId=WO1 (verification submitted again)
    // Mong đợi: Return: no second OperatingExpense; WO1 remains Verified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-30 Precondition 1 (Pending Verification required); NFR 2.4 Financial Consistency
    // Ghi chú : nếu dịch vụ từ chối bằng IncidentException (lỗi nghiệp vụ trả về người dùng) thì vẫn hợp lệ với "Exception: N/A";
    //           mọi loại lỗi khác (lỗi hệ thống) làm test thất bại.
    [Fact(DisplayName = "BF08 UTC09 - Gui xac nhan lai WO1 da Verified: khong tao chi phi thu hai, WO1 van Verified")]
    public async Task UTC09_SecondVerificationDoesNotDuplicateExpense()
    {
        var incident = Incident(IncidentStatus.InProgress);
        var wo1 = WorkOrder(incident, WorkOrderStatus.Verified, 1_000_000m);
        wo1.VerifiedById = Bf08.Owner1;
        wo1.VerifiedAt = Bf08.Now.AddHours(-1);
        repository.Added.Add(Bf08.SetId(new MaintenanceExpense
        {
            IncidentId = incident.Id,
            LocationId = Bf08.L1,
            RoomId = Bf08.Room1,
            AssetId = Bf08.Asset1,
            WorkOrderId = wo1.Id,
            Category = "Maintenance",
            SourceType = "WorkOrder",
            SourceId = wo1.Id,
            Amount = 1_000_000m,
            ExpenseDate = DateOnly.FromDateTime(Bf08.Now.Date),
            ConfirmedById = Bf08.Owner1,
            ConfirmedAt = Bf08.Now.AddHours(-1)
        }, Guid.NewGuid()));

        var error = await Record.ExceptionAsync(() => Service().VerifyAsync(wo1.Id,
            new MaintenanceVerification(wo1.Version, 1_000_000m, "Da sua xong", null, "Tot", AssetStatus.Active), Guid.NewGuid(), default));

        if (error is not null) Assert.IsType<IncidentException>(error);
        Assert.Single(repository.MaintenanceExpenses, e => e.WorkOrderId == wo1.Id);
        Assert.Equal(WorkOrderStatus.Verified, repository.WorkOrderStore[wo1.Id].Status);
    }

    // UTC10 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Incident I1 handled directly by Owner; actual cost 200,000; no Work Order
    // Đầu vào : incidentId=I1; actualCost=200000; evidence=1 photo
    // Mong đợi: Return: OperatingExpense category Maintenance 200,000 linked to I1, Location, Room and Asset; report Resolved; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-28 A4; DBR-10; GBR-12
    [Fact(DisplayName = "BF08 UTC10 - Owner tu xu ly I1, chi phi 200.000, 1 anh: tao chi phi Maintenance, I1 Resolved")]
    public async Task UTC10_DirectResolutionCreatesMaintenanceExpense()
    {
        var i1 = Incident(IncidentStatus.InProgress);
        var photo = Bf08.SetId(new IncidentEvidence
        {
            IncidentId = i1.Id,
            UploadedById = Bf08.Owner1,
            Kind = IncidentEvidenceKind.Direct,
            ObjectKey = $"incidents/{i1.Id}/direct.jpg",
            ContentType = "image/jpeg",
            Sha256 = new string('a', 64),
            Length = 1024
        }, Guid.NewGuid());
        repository.Evidence.Add(photo);

        await Service().DirectAsync(i1.Id, new DirectCompletion(i1.Version, 200_000m, "Owner da tu sua", [photo.Id], "Tot", AssetStatus.Active),
            Guid.NewGuid(), default);

        var expense = Assert.Single(repository.MaintenanceExpenses);
        Assert.Equal("Maintenance", expense.Category, ignoreCase: true);
        Assert.Equal(200_000m, expense.Amount);
        Assert.Equal(i1.Id, expense.IncidentId);
        Assert.Equal(Bf08.L1, expense.LocationId);
        Assert.Equal(Bf08.Room1, expense.RoomId);
        Assert.Equal(Bf08.Asset1, expense.AssetId);
        Assert.Null(expense.WorkOrderId);
        Assert.Equal(IncidentStatus.Resolved, repository.Incidents[i1.Id].Status);
    }
}
