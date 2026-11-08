using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF08;

// Unit test cho recordExpense / recordInvestment / correctExpense - sheet "BF-08 Finance Reporting".
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: UC-31, FE-08 8.1.1, GBR-02, GBR-13, MSG02, MSG03).
// Chỉ dùng danh mục chữ ký để biết cách gọi: ExpenseService(IExpenseRepository, ICurrentUser, TimeProvider).CreateAsync/UpdateAsync.
// Giá trị Record Type / Category truyền đúng chữ trong sheet ("Operating Expense", "Initial Investment", "Electricity"...).
// Kho dữ liệu chi phí (IExpenseRepository) giả lập bằng NSubstitute theo Điều kiện của sheet.
public sealed class ExpenseRecordingUnitTests
{
    private readonly IExpenseRepository repository = Substitute.For<IExpenseRepository>();

    public ExpenseRecordingUnitTests()
    {
        // Điều kiện chung: Location L1 tồn tại.
        repository.ValidScopeAsync(Bf08.L1, Arg.Any<Guid?>(), Arg.Any<CancellationToken>()).Returns(true);
        repository.ReferencesAsync(Bf08.L1, Arg.Any<Guid?>(), Arg.Any<CancellationToken>())
            .Returns(new ExpenseReferences([], [], [], false));
        repository.CreateAsync(Arg.Any<ExpenseInput>(), Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(call => View(Guid.NewGuid(), call.Arg<ExpenseInput>(), 1));
    }

    private static ExpenseView View(Guid id, ExpenseInput input, int version) =>
        new(id, input.LocationId, input.RoomId, input.ExpenseType, input.Category, input.Amount, input.OccurredOn, input.Note, version, true,
            input.AssetId, input.TaskId);

    private ExpenseService Service(ICurrentUser user) => new(repository, user, Bf08.Clock());

    // UTC01 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; Location L1 exists
    // Đầu vào : locationId=L1; recordType=Operating Expense; category=Electricity; amount=1200000; date=2026-11-05
    // Mong đợi: Return: Operating Expense saved for L1 and available for reports, payback and What-if analysis; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-31 NF 1-4, 6; FE-08 8.1.1
    // Ghi chú : "available for reports..." kiểm tra ở tầng unit bằng việc bản ghi được lưu vào kho chi phí (nguồn dữ liệu của báo cáo).
    [Fact(DisplayName = "BF08 UTC01 - Owner ghi Operating Expense Electricity 1.200.000 cho L1: luu thanh cong")]
    public async Task UTC01_OwnerRecordsOperatingExpense()
    {
        var input = new ExpenseInput(Bf08.L1, null, "Operating Expense", "Electricity", 1_200_000m, new DateOnly(2026, 11, 5), "");

        var saved = await Service(Bf08.OwnerUser()).CreateAsync(input, Guid.NewGuid(), default);

        Assert.Equal(Bf08.L1, saved.LocationId);
        Assert.Equal("Operating Expense", saved.ExpenseType);
        Assert.Equal("Electricity", saved.Category);
        Assert.Equal(1_200_000m, saved.Amount);
        Assert.Equal(new DateOnly(2026, 11, 5), saved.OccurredOn);
        await repository.Received(1).CreateAsync(Arg.Is<ExpenseInput>(e => e.LocationId == Bf08.L1 && e.Amount == 1_200_000m),
            Bf08.Owner1, Arg.Any<Guid>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    // UTC02 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; Location L1 exists
    // Đầu vào : locationId=L1; recordType=Operating Expense; category=Electricity; amount=null; date=2026-11-05
    // Mong đợi: Return: record not saved; correction requested; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-31 A1; MSG02
    // Ghi chú : ExpenseInput.Amount có kiểu decimal (không nhận null) nên đầu vào amount=null không biểu diễn được ở tầng unit;
    //           trường hợp này phải kiểm tra ở tầng API (request JSON thiếu amount). Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF08 UTC02 - Thieu amount: khong luu, yeu cau nhap lai (MSG02)",
        Skip = "amount=null khong bieu dien duoc qua chu ky ExpenseInput (decimal); can kiem tra o tang API")]
    public void UTC02_MissingAmount() { }

    // UTC03 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; Location L1 exists
    // Đầu vào : locationId=L1; recordType=Operating Expense; category=Maintenance; amount=500000; relatedRecord=<non existent work order>
    // Mong đợi: Return: linkage rejected; record not saved with the invalid link; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-31 A2
    // Ghi chú : Related Record dạng công việc được truyền qua ExpenseInput.TaskId (trường liên kết duy nhất ngoài AssetId);
    //           danh sách tham chiếu hợp lệ của L1 không có id này.
    [Fact(DisplayName = "BF08 UTC03 - Lien ket Work Order khong ton tai: tu choi lien ket, khong luu")]
    public async Task UTC03_InvalidRelatedRecordRejected()
    {
        var ghostWorkOrder = Guid.NewGuid();
        var input = new ExpenseInput(Bf08.L1, null, "Operating Expense", "Maintenance", 500_000m, new DateOnly(2026, 11, 5), "", TaskId: ghostWorkOrder);

        var error = await Record.ExceptionAsync(() => Service(Bf08.OwnerUser()).CreateAsync(input, Guid.NewGuid(), default));

        Assert.NotNull(error);
        await repository.DidNotReceive().CreateAsync(Arg.Is<ExpenseInput>(e => e.TaskId == ghostWorkOrder),
            Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    // UTC04 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff staff1 logged in
    // Đầu vào : locationId=L1; recordType=Operating Expense; category=Electricity; amount=1200000
    // Mong đợi: Return: record not saved; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Permission Matrix Finance/What-if (Staff No); GBR-02; MSG03
    // Ghi chú : dịch vụ chỉ trả lỗi dạng mã (FinanceException.Code) nên câu MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF08 UTC04 - Staff ghi chi phi: khong luu (khong co quyen)")]
    public async Task UTC04_StaffCannotRecordExpense()
    {
        var input = new ExpenseInput(Bf08.L1, null, "Operating Expense", "Electricity", 1_200_000m, new DateOnly(2026, 11, 5), "");

        var error = await Record.ExceptionAsync(() => Service(Bf08.StaffUser()).CreateAsync(input, Guid.NewGuid(), default));

        Assert.NotNull(error);
        await repository.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default, default, default);
    }

    // UTC05 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; Location L1 exists
    // Đầu vào : locationId=L1; recordType=Initial Investment; category=Construction; amount=600000000; date=2026-01-10
    // Mong đợi: Return: Initial Investment saved for L1 and available for capital recovery and payback; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-31 NF 2, 4, 6; FE-08 8.1.1; UC-33
    [Fact(DisplayName = "BF08 UTC05 - Owner ghi Initial Investment 600.000.000 cho L1: luu thanh cong")]
    public async Task UTC05_OwnerRecordsInitialInvestment()
    {
        var input = new ExpenseInput(Bf08.L1, null, "Initial Investment", "Construction", 600_000_000m, new DateOnly(2026, 1, 10), "");

        var saved = await Service(Bf08.OwnerUser()).CreateAsync(input, Guid.NewGuid(), default);

        Assert.Equal(Bf08.L1, saved.LocationId);
        Assert.Equal("Initial Investment", saved.ExpenseType);
        Assert.Equal("Construction", saved.Category);
        Assert.Equal(600_000_000m, saved.Amount);
        await repository.Received(1).CreateAsync(Arg.Is<ExpenseInput>(e => e.ExpenseType == "Initial Investment" && e.Amount == 600_000_000m),
            Bf08.Owner1, Arg.Any<Guid>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    // UTC06 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; Operating Expense X1 amount 1,200,000
    // Đầu vào : expenseId=X1; amount=1100000; reason=<valid reason>
    // Mong đợi: Return: X1 updated to 1,100,000; correction retained in audit history with actor, timestamp, reason and before/after values; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-31 NF 5; GBR-13; NFR 2.3 Audit
    // Ghi chú : ở tầng unit kiểm tra được: giá trị mới, và lần sửa được giao cho tầng lưu trữ kèm actor, thời điểm, lý do.
    //           Việc lưu giá trị trước/sau vào lịch sử audit nằm ở tầng lưu trữ, không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF08 UTC06 - Sua X1 tu 1.200.000 thanh 1.100.000: cap nhat, luu actor/thoi diem/ly do")]
    public async Task UTC06_CorrectExpenseKeepsAudit()
    {
        var x1 = Guid.NewGuid();
        var original = new ExpenseInput(Bf08.L1, null, "Operating Expense", "Electricity", 1_200_000m, new DateOnly(2026, 11, 5), "");
        repository.GetAsync(x1, Arg.Any<CancellationToken>()).Returns(View(x1, original, 1));
        repository.UpdateAsync(x1, Arg.Any<ExpenseUpdate>(), Arg.Any<Guid>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(call => View(x1, call.Arg<ExpenseUpdate>().Expense, 2));
        const string reason = "Nhap sai so tien tren hoa don dien";
        var update = new ExpenseUpdate(original with { Amount = 1_100_000m }, 1, reason);

        var updated = await Service(Bf08.OwnerUser()).UpdateAsync(x1, update, default);

        Assert.Equal(1_100_000m, updated.Amount);
        await repository.Received(1).UpdateAsync(x1,
            Arg.Is<ExpenseUpdate>(u => u.Reason == reason && u.Expense.Amount == 1_100_000m),
            Bf08.Owner1, Bf08.Now, Arg.Any<CancellationToken>());
    }

    // UTC07 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; Maintenance expense X2 linked to Work Order WO1
    // Đầu vào : expenseId=X2; action=delete
    // Mong đợi: Return: X2 not destructively deleted; record preserved; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-31 A3
    // Ghi chú : kiểm tra rằng dịch vụ chi phí và kho chi phí không cung cấp thao tác xóa (Delete/Remove) nào,
    //           nên X2 không thể bị xóa vĩnh viễn qua tầng nghiệp vụ.
    [Fact(DisplayName = "BF08 UTC07 - Xoa chi phi X2 gan WO1: khong bi xoa vinh vien")]
    public void UTC07_LinkedExpenseCannotBeDeleted()
    {
        static IEnumerable<string> DeleteOperations(Type type) => type.GetMethods()
            .Select(m => m.Name)
            .Where(n => n.Contains("Delete", StringComparison.OrdinalIgnoreCase) || n.Contains("Remove", StringComparison.OrdinalIgnoreCase));

        Assert.Empty(DeleteOperations(typeof(ExpenseService)));
        Assert.Empty(DeleteOperations(typeof(IExpenseRepository)));
    }
}
