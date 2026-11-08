using BHome.Application.IncidentMaintenance;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Infrastructure.UnitTests.UnitTestDoc.BF07;

// Sheet "BF-07 Incident" - nhóm khẩn cấp: respondToEmergency, escalateUnacknowledgedEmergency (UTC20-UTC27).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký).
public sealed class BF07EmergencyUnitTests
{
    private readonly IncidentTestWorld world = new();

    private Task<Guid> TenantEmergencyAsync() =>
        world.SubmitAsync(world.Tenant, IncidentSeverity.Emergency, "Ống nước vỡ, nước tràn ra phòng", world.RoomA);

    private Task AcknowledgeAsync(Guid id, Guid staff) =>
        world.As(staff).AcknowledgeAsync(id, new WorkOrderAction(world.Report(id).Version), Guid.NewGuid(), default);

    private Task EntryAsync(Guid id, Guid staff, string note, Guid[]? evidence = null, decimal? cost = null) =>
        world.As(staff).EmergencyEntryAsync(id, new EmergencyEntry(world.Report(id).Version, note, evidence ?? [], cost), Guid.NewGuid(), default);

    // UTC20 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report in Submitted status; Staff actively assigned to the Location
    // Đầu vào : action=acknowledge; actor=eligible Staff
    // Mong đợi: Return: acknowledgement time recorded; reporter and Owner notified; report remains Submitted (open for Owner review); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 NF 4, 9; FE-06 6.1.2 Staff Acknowledgement
    [Fact(DisplayName = "BF07 UTC20 - Staff tiep nhan bao cao khan cap: ghi thoi diem, bao nguoi bao va Owner")]
    public async Task UTC20_StaffAcknowledgesEmergency()
    {
        var id = await TenantEmergencyAsync();
        world.ResetNotifications();

        await AcknowledgeAsync(id, world.StaffS1);

        var report = world.Report(id);
        Assert.NotNull(report.AcknowledgedAt);
        Assert.Equal(world.StaffS1, report.AcknowledgedById);
        Assert.True(world.Notified(world.Tenant), "Người báo chưa được thông báo.");
        Assert.True(world.Notified(world.Owner), "Owner chưa được thông báo.");
        Assert.Equal(IncidentStatus.Submitted, report.Status);
    }

    // UTC21 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Normal report in Submitted status
    // Đầu vào : action=acknowledge; actor=eligible Staff
    // Mong đợi: Return: emergency acknowledgement not available for a Normal report; report follows Owner review (UC-28); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 Pre 1 (Severity = Operational Emergency); GBR-11
    [Fact(DisplayName = "BF07 UTC21 - Tiep nhan khan cap cho bao cao Normal: khong cho phep")]
    public async Task UTC21_AcknowledgeNormalReport()
    {
        var id = await world.SubmitAsync(world.Tenant, IncidentSeverity.Normal, "Vòi nước bồn rửa bị rỉ liên tục", world.RoomA);

        await Rejection.AssertRejectedAsync(() => AcknowledgeAsync(id, world.StaffS1));

        Assert.Null(world.Report(id).AcknowledgedAt);
        Assert.Equal(IncidentStatus.Submitted, world.Report(id).Status);
    }

    // UTC22 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report acknowledged by Staff S1
    // Đầu vào : action 1='Khóa van tổng'; action 2='Ngắt aptomat', cost=50,000, receipt photo=1 image
    // Mong đợi: Return: Action History shows the acknowledgement and both actions in chronological order with actor and timestamp; earlier entries unchanged (append-only); cost 50,000 recorded with receipt photo for Owner confirmation in UC-28/UC-30; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 NF 6-8, A5; FE-06 6.1.2 Action History
    [Fact(DisplayName = "BF07 UTC22 - Lich su xu ly khan cap theo thu tu, chi them; chi phi 50.000 kem hoa don")]
    public async Task UTC22_EmergencyActionHistory()
    {
        var id = await TenantEmergencyAsync();
        world.Clock.Advance(TimeSpan.FromMinutes(1));
        var beforeAck = world.Repository.Activities.Select(a => a.Id).ToHashSet();
        await AcknowledgeAsync(id, world.StaffS1);
        var ackIds = world.Repository.Activities.Where(a => a.IncidentId == id && !beforeAck.Contains(a.Id)).Select(a => a.Id).ToHashSet();
        world.Clock.Advance(TimeSpan.FromMinutes(1));
        await EntryAsync(id, world.StaffS1, "Khóa van tổng");
        var before = world.Repository.Activities.Where(a => a.IncidentId == id).Select(a => (a.Id, a.Note, a.OccurredAt, a.ActorId)).ToList();
        world.Clock.Advance(TimeSpan.FromMinutes(1));
        var receipt = await world.UploadAsync(world.StaffS1, id, null, IncidentEvidenceKind.EmergencyAction);
        await EntryAsync(id, world.StaffS1, "Ngắt aptomat", [receipt], 50_000m);

        var history = (await world.As(world.Owner).HistoryAsync(id, 1, 100, default)).Items.OrderBy(h => h.OccurredAt).ToList();
        var ack = history.FindIndex(h => ackIds.Contains(h.Id) && h.ActorId == world.StaffS1);
        var first = history.FindIndex(h => h.Note.Contains("Khóa van tổng"));
        var second = history.FindIndex(h => h.Note.Contains("Ngắt aptomat"));
        Assert.True(ack >= 0, "Lịch sử chưa có mục tiếp nhận của Staff S1.");
        Assert.True(first > ack && second > first, "Các mục không theo đúng thứ tự thời gian.");
        Assert.All(new[] { history[first], history[second] }, h => Assert.Equal(world.StaffS1, h.ActorId));
        foreach (var old in before)
            Assert.Contains(world.Repository.Activities, a => a.Id == old.Id && a.Note == old.Note && a.OccurredAt == old.OccurredAt && a.ActorId == old.ActorId);

        var cost = Assert.Single(await world.As(world.Owner).EmergencyActionsAsync(id, default), e => e.RequestedCost == 50_000m);
        Assert.Null(cost.CostApproved);
        Assert.Contains(world.Repository.Evidence, e => e.Id == receipt && e.ActivityId == cost.ActivityId);
    }

    // UTC23 (Abnormal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report acknowledged by Staff S1
    // Đầu vào : action=cannot safely handle; reason='Tủ điện bốc khói, không an toàn để tiếp cận'; containment='Đã sơ tán tầng 2'
    // Mong đợi: Return: reason and safe containment already performed recorded as emergency-action entries; report remains open for Owner review; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 A2; Postcondition (Unsuccessful)
    // Ghi chú : hệ thống không có thao tác riêng "cannot safely handle"; ghi lý do và biện pháp ngăn chặn bằng mục xử lý khẩn cấp.
    [Fact(DisplayName = "BF07 UTC23 - Khong the xu ly an toan: ghi ly do va bien phap ngan chan, bao cao van mo")]
    public async Task UTC23_CannotSafelyHandle()
    {
        var id = await TenantEmergencyAsync();
        await AcknowledgeAsync(id, world.StaffS1);

        await EntryAsync(id, world.StaffS1, "Tủ điện bốc khói, không an toàn để tiếp cận");
        await EntryAsync(id, world.StaffS1, "Đã sơ tán tầng 2");

        var actions = await world.As(world.Owner).EmergencyActionsAsync(id, default);
        var notes = world.Repository.Activities.Where(a => actions.Any(x => x.ActivityId == a.Id)).Select(a => a.Note).ToList();
        Assert.Contains(notes, n => n.Contains("Tủ điện bốc khói, không an toàn để tiếp cận"));
        Assert.Contains(notes, n => n.Contains("Đã sơ tán tầng 2"));
        Assert.True(world.Report(id).IsOpen);
        Assert.Equal(IncidentStatus.Submitted, world.Report(id).Status);
    }

    // UTC24 (Normal) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report acknowledged by Staff S1; situation becomes life-threatening
    // Đầu vào : action=record public emergency call; called=114; time=10:05; evidence=1 image
    // Mong đợi: Return: call, time and evidence stored as an append-only emergency-action entry; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 A3; GBR-11
    [Fact(DisplayName = "BF07 UTC24 - Ghi nhan cuoc goi 114 luc 10:05 kem anh")]
    public async Task UTC24_RecordPublicEmergencyCall()
    {
        var id = await TenantEmergencyAsync();
        await AcknowledgeAsync(id, world.StaffS1);
        var photo = await world.UploadAsync(world.StaffS1, id, null, IncidentEvidenceKind.EmergencyAction);

        await EntryAsync(id, world.StaffS1, "Đã gọi 114 lúc 10:05", [photo]);

        var action = Assert.Single(await world.As(world.Owner).EmergencyActionsAsync(id, default));
        var entry = Assert.Single(world.Repository.Activities, a => a.Id == action.ActivityId);
        Assert.Contains("114", entry.Note);
        Assert.Contains("10:05", entry.Note);
        Assert.Contains(world.Repository.Evidence, e => e.Id == photo && e.ActivityId == entry.Id);
    }

    // UTC25 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report submitted at 09:00; no Staff acknowledgement
    // Đầu vào : now=09:15 (15 minutes elapsed)
    // Mong đợi: Return: alert re-sent to the Owner and all Staff assigned to the Location; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 A1 (15 minutes)
    [Fact(DisplayName = "BF07 UTC25 - 15 phut chua tiep nhan: gui lai canh bao")]
    public void UTC25_ResendAlertAfterFifteenMinutes() =>
        Assert.Fail("Chưa tìm thấy chức năng escalateUnacknowledgedEmergency trong hệ thống (danh mục chữ ký)");

    // UTC26 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report submitted at 09:00; no Staff acknowledgement
    // Đầu vào : now=09:29
    // Mong đợi: Return: report not flagged "Acknowledgement overdue"; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 A1 (30 minutes)
    [Fact(DisplayName = "BF07 UTC26 - 29 phut: chua danh dau qua han tiep nhan")]
    public void UTC26_NotOverdueAtTwentyNineMinutes() =>
        Assert.Fail("Chưa tìm thấy chức năng escalateUnacknowledgedEmergency trong hệ thống (danh mục chữ ký)");

    // UTC27 (Boundary) - sheet "BF-07 Incident", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report submitted at 09:00; no Staff acknowledgement
    // Đầu vào : now=09:30
    // Mong đợi: Return: report flagged "Acknowledgement overdue"; Owner may handle or arrange immediate handling directly; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 A1 (30 minutes)
    [Fact(DisplayName = "BF07 UTC27 - 30 phut: danh dau qua han tiep nhan")]
    public void UTC27_OverdueAtThirtyMinutes() =>
        Assert.Fail("Chưa tìm thấy chức năng escalateUnacknowledgedEmergency trong hệ thống (danh mục chữ ký)");
}
