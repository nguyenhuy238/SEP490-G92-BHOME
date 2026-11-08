using BHome.Application.PaymentsDebt;
using static BHome.Application.UnitTests.UnitTestDoc.BF06.BF06TestWorld;

namespace BHome.Application.UnitTests.UnitTestDoc.BF06;

// Unit test cho sheet "BF-06 Payment Debt" - nhóm sendDebtReminders / getOverdueDebts (UTC23-UTC29).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: JOB-01, UC-23, FE-05 5.2.1, DBR-01, GBR-02, MSG04).
// Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký):
//   - sendDebtReminders -> KHÔNG có hàm/job tương ứng trong danh mục chữ ký.
//   - getOverdueDebts   -> PaymentService.DebtAsync(PaymentQuery). Dữ liệu công nợ do kho (giả lập) cung cấp; kho chỉ trả
//                          dữ liệu theo phạm vi người gọi mà hàm truyền xuống (Owner toàn chuỗi, Staff theo Location được giao).
// Log Message (MSG04) không quan sát được ở tầng unit.
public sealed class BF06DebtUnitTests
{
    private readonly BF06TestWorld world = new();

    private static DebtInvoiceView Overdue(Guid invoiceId, Guid locationId, string location, string room) =>
        new(invoiceId, locationId, Guid.NewGuid(), location, room, new DateOnly(2026, 11, 1), new DateOnly(2026, 12, 5),
            4_270_000m, 0m, 4_270_000m, "Overdue", 1, 4_270_000m, 0m, 0m);

    private void OverdueInvoicesInL1AndL2()
    {
        world.Payments.DebtRows.Add(Overdue(Inv204, L1, "Location L1", "204"));
        world.Payments.DebtRows.Add(Overdue(Guid.NewGuid(), L2, "Location L2", "305"));
        world.SetNow(new DateTimeOffset(2026, 12, 6, 9, 0, 0, TimeSpan.FromHours(7)));
    }

    private static PaymentQuery Query(Guid? locationId = null) => new() { Page = 1, PageSize = 50, OverdueOnly = true, LocationId = locationId };

    // UTC23 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: INV-204 Finalized; Due Date 2026-12-05; outstanding 4,270,000
    // Đầu vào : runDate=2026-12-06
    // Mong đợi: Return: Invoice status Overdue; overdue days 1; payment reminder sent to Tenant and applicable Owner/Staff; reminder status recorded; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-01 Required Processing; UC-23 NF 3-5; BF-06B end condition; FE-05 5.2.1 Reminder Status
    [Fact(DisplayName = "BF06 UTC23 - Qua han 1 ngay: Overdue va gui nhac no")]
    public void UTC23_SendOverdueReminder() =>
        Assert.Fail("Chưa tìm thấy chức năng sendDebtReminders trong hệ thống (danh mục chữ ký)");

    // UTC24 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Overdue reminder for INV-204 already sent on 2026-12-06
    // Đầu vào : runDate=2026-12-06 (job runs again)
    // Mong đợi: Return: no duplicate reminder for the same Invoice and reminder window; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-01 Failure/Idempotency; GBR-18; NFR 2.2 Idempotency
    [Fact(DisplayName = "BF06 UTC24 - Job chay lai cung ngay: khong gui nhac trung")]
    public void UTC24_NoDuplicateReminder() =>
        Assert.Fail("Chưa tìm thấy chức năng sendDebtReminders trong hệ thống (danh mục chữ ký)");

    // UTC25 (Boundary) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: INV-204 Finalized; Due Date 2026-12-05; outstanding 4,270,000
    // Đầu vào : runDate=2026-12-05 (due date)
    // Mong đợi: Return: Invoice not treated as overdue; outstanding 4,270,000 still tracked; no overdue reminder sent; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-23 A2; JOB-01 ('past the due date')
    [Fact(DisplayName = "BF06 UTC25 - Dung ngay den han: chua qua han, khong gui nhac")]
    public void UTC25_DueDateIsNotOverdue() =>
        Assert.Fail("Chưa tìm thấy chức năng sendDebtReminders trong hệ thống (danh mục chữ ký)");

    // UTC26 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: INV-204 Due Date 2026-12-05; status Paid
    // Đầu vào : runDate=2026-12-06
    // Mong đợi: Return: no reminder; Invoice not treated as outstanding debt; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-23 A1; JOB-01 (outstanding balance required)
    [Fact(DisplayName = "BF06 UTC26 - Hoa don da Paid: khong nhac no")]
    public void UTC26_PaidInvoiceNoReminder() =>
        Assert.Fail("Chưa tìm thấy chức năng sendDebtReminders trong hệ thống (danh mục chữ ký)");

    // UTC27 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; overdue invoices exist in several Locations
    // Đầu vào : userId=owner1
    // Mong đợi: Return: debt list of all Locations with Location/Room, Invoice, Due Date, Total, Paid, Outstanding Amount, Overdue Status and Reminder Status; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-23 NF 7; Permission Matrix Payment/Debt (Owner Full); FE-05 5.2.1
    [Fact(DisplayName = "BF06 UTC27 - Owner xem cong no: tat ca Location, du cac cot ke ca Reminder Status")]
    public async Task UTC27_OwnerSeesAllLocations()
    {
        OverdueInvoicesInL1AndL2();
        world.AsOwner();

        var page = await world.PaymentService().DebtAsync(Query(), default);

        Assert.Contains(page.Items, r => r.LocationId == L1);
        Assert.Contains(page.Items, r => r.LocationId == L2);
        var row = page.Items.First(r => r.LocationId == L1);
        Assert.False(string.IsNullOrEmpty(row.LocationName));
        Assert.False(string.IsNullOrEmpty(row.RoomNumber));
        Assert.Equal(Inv204, row.InvoiceId);
        Assert.Equal(new DateOnly(2026, 12, 5), row.DueDate);
        Assert.Equal(4_270_000m, row.PayableAmount);
        Assert.Equal(0m, row.PaidAmount);
        Assert.Equal(4_270_000m, row.OutstandingAmount);
        Assert.True(row.OverdueDays > 0);
        Assert.True(typeof(DebtInvoiceView).GetProperties().Any(p => p.Name.Contains("Reminder", StringComparison.OrdinalIgnoreCase)),
            "Danh sách công nợ không có cột Reminder Status (FE-05 5.2.1)");
    }

    // UTC28 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff staff1 assigned only to Location L1; overdue invoices exist in L1 and L2
    // Đầu vào : userId=staff1
    // Mong đợi: Return: only L1 debt records required for follow-up are returned; no L2 records; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-23 NF 8, Postcondition 4; FE-05 5.2.1; DBR-01; GBR-02; Permission Matrix (Staff Restricted debt follow-up)
    [Fact(DisplayName = "BF06 UTC28 - Staff chi duoc giao L1: chi thay cong no L1")]
    public async Task UTC28_StaffSeesOnlyAssignedLocation()
    {
        OverdueInvoicesInL1AndL2();
        world.Payments.StaffAssignments.Add((Staff1, L1));
        world.AsStaff();

        var page = await world.PaymentService().DebtAsync(Query(), default);

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, r => Assert.Equal(L1, r.LocationId));
    }

    // UTC29 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff staff1 assigned only to Location L1
    // Đầu vào : userId=staff1; locationId=L2
    // Mong đợi: Return: no L2 debt data returned; Exception: N/A; Log Message: "This Location is outside your assigned scope."
    // Căn cứ  : DBR-01; GBR-02; NFR 2.3 Authorization; MSG04
    // Ghi chú : Log Message (MSG04) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF06 UTC29 - Staff xem cong no L2 ngoai pham vi: khong tra du lieu L2")]
    public async Task UTC29_StaffQueriesOutOfScopeLocation()
    {
        OverdueInvoicesInL1AndL2();
        world.Payments.StaffAssignments.Add((Staff1, L1));
        world.AsStaff();

        IReadOnlyList<DebtInvoiceView> items = [];
        await Capture(async () => items = (await world.PaymentService().DebtAsync(Query(L2), default)).Items);

        Assert.DoesNotContain(items, r => r.LocationId == L2);
    }
}
