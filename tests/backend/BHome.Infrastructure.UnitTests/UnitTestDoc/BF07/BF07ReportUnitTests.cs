using System.Text;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Infrastructure.UnitTests.UnitTestDoc.BF07;

// Sheet "BF-07 Incident" - nhóm báo cáo sự cố: submitIncidentReport, showEmergencyHotline, attachReportEvidence,
// viewIncidentReport, cancelIncidentReport (UTC01-UTC19).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký).
// Log Message: IncidentService báo lỗi bằng mã (IncidentException.Code), không trả câu thông báo cho người dùng,
// nên câu MSGxx trong sheet KHÔNG quan sát được ở tầng unit (ghi chú ở từng test).
public sealed class BF07ReportUnitTests
{
    private readonly IncidentTestWorld world = new();

    private static string Nfc(string text) => text.Normalize(NormalizationForm.FormC);

    // UTC01 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy; Room belongs to the tenancy
    // Đầu vào : role=Tenant; scope=own Room; severity=Normal; description='Vòi nước bồn rửa bị rỉ liên tục'
    // Mong đợi: Return: report created in Submitted status with reporter, source=Tenant, submission time, severity=Normal and evidence; Owner notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 3-11; DBR-09
    [Fact(DisplayName = "BF07 UTC01 - Tenant gui bao cao Normal cho phong cua minh: Submitted, Owner duoc bao")]
    public async Task UTC01_TenantSubmitsNormalReport()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA, photos: 1);

        var report = world.Report(id);
        Assert.Equal(IncidentStatus.Submitted, report.Status);
        Assert.Equal(world.Tenant, report.ReporterId);
        Assert.Equal(Roles.Tenant, report.ReporterRole);
        Assert.NotEqual(default, report.CreatedAt);
        Assert.Equal(IncidentSeverity.Normal, report.Severity);
        Assert.Single(world.Repository.Evidence, e => e.IncidentId == id);
        Assert.True(world.Notified(world.Owner), "Owner chưa được thông báo.");
    }

    // UTC02 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy; Room belongs to the tenancy
    // Đầu vào : role=Tenant; severity=Operational Emergency; description='Ống nước vỡ, nước tràn ra phòng'
    // Mong đợi: Return: report created in Submitted status with severity=Operational Emergency; UC-27 started: high-priority in-app and push notifications sent to Owner and eligible Staff of the Location; Exception: N/A; Log Message: "Emergency report submitted. Owner and responsible Staff have been notified."
    // Căn cứ  : UC-26 NF 12; UC-27 NF 1-3; GBR-11; MSG13
    // Ghi chú : Log Message MSG13 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC02 - Tenant gui bao cao khan cap: thong bao uu tien cao toi Owner va Staff")]
    public async Task UTC02_TenantSubmitsEmergency()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Emergency, "Ống nước vỡ, nước tràn ra phòng", world.RoomA);

        var report = world.Report(id);
        Assert.Equal(IncidentStatus.Submitted, report.Status);
        Assert.Equal(IncidentSeverity.Emergency, report.Severity);
        Assert.True(world.NotifiedHighPriority(world.Owner), "Owner chưa nhận thông báo ưu tiên cao.");
        Assert.True(world.NotifiedHighPriority(world.StaffS1), "Staff của Location chưa nhận thông báo ưu tiên cao.");
    }

    // UTC03 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff actively assigned to the Location
    // Đầu vào : role=Staff; severity=Operational Emergency; description='Ống nước vỡ, nước tràn ra hành lang tầng 2'
    // Mong đợi: Return: report created in Submitted status and recorded as acknowledged by the reporting Staff (acknowledgement time stored); UC-27 continues from immediate action; Owner notified; Exception: N/A; Log Message: "Emergency report submitted. Owner and responsible Staff have been notified."
    // Căn cứ  : UC-26 A7; UC-27 NF 3-4; MSG13
    // Ghi chú : Log Message MSG13 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC03 - Staff gui bao cao khan cap: tu dong ghi nhan da tiep nhan")]
    public async Task UTC03_StaffSubmitsEmergency()
    {
        var id = await world.SubmitAsync(world.StaffS1, IncidentSeverity.Emergency, "Ống nước vỡ, nước tràn ra hành lang tầng 2", world.RoomA);

        var report = world.Report(id);
        Assert.Equal(IncidentStatus.Submitted, report.Status);
        Assert.Equal(world.StaffS1, report.AcknowledgedById);
        Assert.NotNull(report.AcknowledgedAt);
        Assert.True(world.Notified(world.Owner), "Owner chưa được thông báo.");
    }

    // UTC04 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy
    // Đầu vào : severity=Normal; description=''
    // Mong đợi: Return: submission rejected; Description field identified for correction; no report created; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-26 NF 7, A1; MSG02
    // Ghi chú : Log Message MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC04 - Mo ta rong: bi tu choi, chi ra truong Description")]
    public async Task UTC04_EmptyDescription()
    {
        var error = await Rejection.AssertRejectedAsync(() => world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "", world.RoomA));

        Rejection.AssertIdentifies(error, "description");
        Assert.Empty(world.Repository.Reports);
    }

    // UTC05 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy
    // Đầu vào : severity=Normal; description='Rỉ nước!!' (9 characters)
    // Mong đợi: Return: submission rejected; Description identified for correction (at least 10 characters required); no report created; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 7 (at least 10 characters), A1
    [Fact(DisplayName = "BF07 UTC05 - Mo ta 9 ky tu: bi tu choi")]
    public async Task UTC05_DescriptionNineCharacters()
    {
        var description = Nfc("Rỉ nước!!");
        Assert.Equal(9, description.Length);

        var error = await Rejection.AssertRejectedAsync(() => world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, description, world.RoomA));

        Rejection.AssertIdentifies(error, "description");
        Assert.Empty(world.Repository.Reports);
    }

    // UTC06 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy
    // Đầu vào : severity=Normal; description='Vòi bị rỉ.' (10 characters)
    // Mong đợi: Return: report created in Submitted status; Owner notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 7 (at least 10 characters)
    [Fact(DisplayName = "BF07 UTC06 - Mo ta 10 ky tu: tao bao cao Submitted")]
    public async Task UTC06_DescriptionTenCharacters()
    {
        var description = Nfc("Vòi bị rỉ.");
        Assert.Equal(10, description.Length);

        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, description, world.RoomA);

        Assert.Equal(IncidentStatus.Submitted, world.Report(id).Status);
        Assert.True(world.Notified(world.Owner), "Owner chưa được thông báo.");
    }

    // UTC07 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in; Tenant has no active tenancy
    // Đầu vào : severity=Normal; description='Vòi nước bồn rửa bị rỉ liên tục'
    // Mong đợi: Return: submission rejected; no report created; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : UC-26 Pre 2, A2; GBR-02; MSG03
    // Ghi chú : Log Message MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC07 - Tenant khong co hop dong thue: bi tu choi")]
    public async Task UTC07_TenantWithoutTenancy()
    {
        await Rejection.AssertRejectedAsync(() =>
            world.SubmitAsync(world.TenantWithoutTenancy, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA));

        Assert.Empty(world.Repository.Reports);
    }

    // UTC08 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy in Room A
    // Đầu vào : scope=Room B (not in the Tenant's tenancy); severity=Normal; description='Vòi nước bồn rửa bị rỉ liên tục'
    // Mong đợi: Return: submission rejected; no report created; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : UC-26 Pre 4, A2; GBR-02; MSG03
    // Ghi chú : Log Message MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC08 - Tenant bao su co cho phong khong thue: bi tu choi")]
    public async Task UTC08_TenantReportsOtherRoom()
    {
        await Rejection.AssertRejectedAsync(() =>
            world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomB));

        Assert.Empty(world.Repository.Reports);
    }

    // UTC09 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff actively assigned only to Location X
    // Đầu vào : role=Staff; scope=Location Y; severity=Normal; photos=1 image
    // Mong đợi: Return: submission rejected; no report and no evidence stored; Exception: N/A; Log Message: "This Location is outside your assigned scope."
    // Căn cứ  : UC-26 Pre 3, A2; GBR-02; DBR-01; MSG04
    // Ghi chú : Log Message MSG04 không quan sát được ở tầng unit. Sheet không ghi mô tả; dùng mô tả hợp lệ để chỉ kiểm tra phạm vi Location.
    [Fact(DisplayName = "BF07 UTC09 - Staff bao su co o Location khong duoc giao: bi tu choi, khong luu anh")]
    public async Task UTC09_StaffOutsideLocation()
    {
        await Rejection.AssertRejectedAsync(() =>
            world.SubmitAsync(world.StaffS1, IncidentSeverity.Normal, "Ống nước rò rỉ dưới bồn", roomId: null, locationId: world.LocationY, photos: 1));

        Assert.Empty(world.Repository.Reports);
        Assert.Empty(world.Repository.Evidence);
        Assert.Empty(world.Files.Stored);
    }

    // UTC10 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy
    // Đầu vào : action=open issue-reporting function
    // Mong đợi: Return: emergency-hotline banner (114 Fire, 115 Ambulance, 113 Police, Location manager hotline) displayed before the report form; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 2; FE-06 6.1.1 Emergency Hotline; GBR-11
    [Fact(DisplayName = "BF07 UTC10 - Hien banner duong day nong khan cap truoc form bao cao")]
    public void UTC10_EmergencyHotlineBanner() =>
        Assert.Fail("Chưa tìm thấy chức năng showEmergencyHotline trong hệ thống (danh mục chữ ký)");

    // UTC11 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in with an active tenancy
    // Đầu vào : lifeSafety=true (a person is in immediate danger, e.g. fire)
    // Mong đợi: Return: emergency-hotline screen with one-tap call shown; report form not required; no report needs to be created at this time; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 A6; GBR-11; Permission Matrix Emergency Incident (life-safety guidance)
    [Fact(DisplayName = "BF07 UTC11 - Nguy hiem tinh mang: hien man hinh goi nhanh, khong can form")]
    public void UTC11_LifeSafetyHotline() =>
        Assert.Fail("Chưa tìm thấy chức năng showEmergencyHotline trong hệ thống (danh mục chữ ký)");

    // UTC12 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff actively assigned to the Location
    // Đầu vào : description='Ống nước rò rỉ dưới bồn'; photos=6 images
    // Mong đợi: Return: submission rejected; Evidence identified for correction (maximum 5 photos); no report created; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 8, A1; NFR Report Upload
    [Fact(DisplayName = "BF07 UTC12 - 6 anh: bi tu choi, toi da 5 anh")]
    public async Task UTC12_SixPhotos()
    {
        var error = await Rejection.AssertRejectedAsync(() =>
            world.SubmitAsync(world.StaffS1, IncidentSeverity.Normal, "Ống nước rò rỉ dưới bồn", world.RoomA, photos: 6));

        Rejection.AssertIdentifies(error, "image", "photo", "evidence");
        Assert.Empty(world.Repository.Reports);
    }

    // UTC13 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff actively assigned to the Location
    // Đầu vào : description='Ống nước rò rỉ dưới bồn'; photos=1 image of 5 MB + 1 byte
    // Mong đợi: Return: submission rejected; Evidence identified for correction (each photo at most 5 MB); no report created; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 8, A1; NFR Report Upload
    // Ghi chú : 5 MB = 5 x 1024 x 1024 byte.
    [Fact(DisplayName = "BF07 UTC13 - Anh 5 MB + 1 byte: bi tu choi")]
    public async Task UTC13_PhotoOverFiveMegabytes()
    {
        var images = new[] { new IncidentImage(IncidentTestWorld.Png(IncidentTestWorld.FiveMegabytes + 1)) };

        var error = await Rejection.AssertRejectedAsync(() => world.As(world.StaffS1).SubmitAsync(
            new IncidentSubmit(world.LocationX, world.RoomA, null, null, IncidentSeverity.Normal, "Ống nước rò rỉ dưới bồn"), images, Guid.NewGuid(), default));

        Rejection.AssertIdentifies(error, "image", "photo", "evidence", "size");
        Assert.Empty(world.Repository.Reports);
    }

    // UTC14 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff actively assigned to the Location
    // Đầu vào : description='Ống nước rò rỉ dưới bồn'; photos=5 images, each exactly 5 MB
    // Mong đợi: Return: report created in Submitted status with 5 photos stored as evidence; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 NF 8, 10; NFR Report Upload
    [Fact(DisplayName = "BF07 UTC14 - 5 anh, moi anh dung 5 MB: tao bao cao voi 5 anh")]
    public async Task UTC14_FivePhotosOfFiveMegabytes()
    {
        var images = Enumerable.Range(0, 5).Select(_ => new IncidentImage(IncidentTestWorld.Png(IncidentTestWorld.FiveMegabytes))).ToArray();

        var result = await world.As(world.StaffS1).SubmitAsync(
            new IncidentSubmit(world.LocationX, world.RoomA, null, null, IncidentSeverity.Normal, "Ống nước rò rỉ dưới bồn"), images, Guid.NewGuid(), default);

        Assert.Equal(IncidentStatus.Submitted, world.Report(result.IncidentId).Status);
        Assert.Equal(5, world.Repository.Evidence.Count(e => e.IncidentId == result.IncidentId));
    }

    // UTC15 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in; report was created by another Tenant
    // Đầu vào : reportId=report of another Tenant
    // Mong đợi: Return: report not displayed; access denied; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Permission Matrix Incident/Maintenance (Tenant: report/view own); GBR-02; MSG03
    // Ghi chú : Log Message MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC15 - Tenant xem bao cao cua Tenant khac: bi tu choi")]
    public async Task UTC15_TenantViewsOtherTenantReport()
    {
        var other = await world.SubmitAsync(world.OtherTenant, IncidentSeverity.Normal, "Bóng đèn phòng tắm bị cháy", world.RoomC);

        await Rejection.AssertRejectedAsync(() => world.As(world.Tenant).GetAsync(other, default));
    }

    // UTC16 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Report Submitted by the Tenant; Owner has not made a handling decision
    // Đầu vào : actor=reporter; action=cancel
    // Mong đợi: Return: report status=Cancelled; history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 A4; Postcondition (Cancelled with history retained)
    // Ghi chú : hàm hủy nhận một lý do; sheet không ghi lý do nên dùng 'Đã tự xử lý được'.
    [Fact(DisplayName = "BF07 UTC16 - Nguoi bao tu huy truoc khi Owner quyet dinh: Cancelled, giu lich su")]
    public async Task UTC16_ReporterCancelsBeforeDecision()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA);
        var historyBefore = world.Repository.Activities.Where(a => a.IncidentId == id).Select(a => a.Id).ToArray();

        await world.As(world.Tenant).DecideAsync(id, "cancel", new IncidentDecision(world.Report(id).Version, "Đã tự xử lý được"), Guid.NewGuid(), default);

        Assert.Equal(IncidentStatus.Cancelled, world.Report(id).Status);
        Assert.Contains(world.Repository.Reports, r => r.Id == id);
        Assert.All(historyBefore, a => Assert.Contains(world.Repository.Activities, x => x.Id == a));
    }

    // UTC17 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner has made the handling decision (Work Order created)
    // Đầu vào : actor=reporter; action=cancel
    // Mong đợi: Return: cancellation not allowed; report status unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 A5
    [Fact(DisplayName = "BF07 UTC17 - Nguoi bao huy sau khi Owner da tao Work Order: khong cho huy")]
    public async Task UTC17_ReporterCannotCancelAfterDecision()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA);
        await world.AssignAsync(id, world.StaffS1);
        var statusBefore = world.Report(id).Status;

        await Rejection.AssertRejectedAsync(() => world.As(world.Tenant)
            .DecideAsync(id, "cancel", new IncidentDecision(world.Report(id).Version, "Đã tự xử lý được"), Guid.NewGuid(), default));

        Assert.Equal(statusBefore, world.Report(id).Status);
    }

    // UTC18 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner has made the handling decision for the report
    // Đầu vào : actor=Owner; action=cancel; reason='Báo nhầm'
    // Mong đợi: Return: report status=Cancelled with reason 'Báo nhầm' recorded; reporter notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-26 A5; IncidentReport cancellation reason
    // Ghi chú : "handling decision" dựng giống UTC17 (Owner đã tạo Work Order).
    [Fact(DisplayName = "BF07 UTC18 - Owner huy bao cao voi ly do 'Bao nham': Cancelled, nguoi bao duoc bao")]
    public async Task UTC18_OwnerCancelsWithReason()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA);
        await world.AssignAsync(id, world.StaffS1);

        await world.As(world.Owner).DecideAsync(id, "cancel", new IncidentDecision(world.Report(id).Version, "Báo nhầm"), Guid.NewGuid(), default);

        var report = world.Report(id);
        Assert.Equal(IncidentStatus.Cancelled, report.Status);
        Assert.True(report.ResolutionNote == "Báo nhầm" || world.Repository.Activities.Any(a => a.IncidentId == id && a.Note.Contains("Báo nhầm")),
            "Lý do 'Báo nhầm' chưa được ghi nhận.");
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
    }

    // UTC19 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner has made the handling decision for the report
    // Đầu vào : actor=Owner; action=cancel; reason=''
    // Mong đợi: Return: cancellation rejected; reason identified as mandatory; report status unchanged; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-26 A5 (mandatory reason); MSG02
    // Ghi chú : Log Message MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF07 UTC19 - Owner huy khong ghi ly do: bi tu choi")]
    public async Task UTC19_OwnerCancelsWithoutReason()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA);
        await world.AssignAsync(id, world.StaffS1);
        var statusBefore = world.Report(id).Status;

        var error = await Rejection.AssertRejectedAsync(() => world.As(world.Owner)
            .DecideAsync(id, "cancel", new IncidentDecision(world.Report(id).Version, ""), Guid.NewGuid(), default));

        Rejection.AssertIdentifies(error, "reason");
        Assert.Equal(statusBefore, world.Report(id).Status);
    }
}
