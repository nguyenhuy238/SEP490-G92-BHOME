using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF08;

// Unit test cho getDashboardSummary và calculateWhatIfScenario - sheet "BF-08 Finance Reporting".
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: FE-08 8.2.1, 8.3.1, UC-32, UC-33, UC-34, GBR-15, DBR-11, MSG03).
// Chỉ dùng danh mục chữ ký để biết cách gọi: FinancialReportService(IFinancialReportRepository, ICurrentUser, TimeProvider).ReadAsync,
// FinancialScenarioService(IFinancialScenarioRepository, FinancialReportService, ICurrentUser).AnalyzeAsync/SaveAsync và
// FinancialScenarioService.Calculate. Dữ liệu thực tế của L1 (doanh thu, chi phí, phòng, công nợ, vốn đầu tư) được cấp qua
// IFinancialReportRepository giả lập (FinanceBasis) đúng theo Điều kiện của sheet.
// Ánh xạ trường: Revenue -> FinanceTotals.Issued; Operating Expenses -> OperatingExpenses; Operating Profit -> OperatingProfit;
// Occupancy -> OccupiedRooms/TotalRooms; Outstanding Debt -> OutstandingNow; Estimated Payback -> CapitalRecovery.EstimatedRemainingMonths.
public sealed class DashboardAndWhatIfUnitTests
{
    private readonly IFinancialReportRepository reports = Substitute.For<IFinancialReportRepository>();
    private readonly IFinancialScenarioRepository scenarios = Substitute.For<IFinancialScenarioRepository>();

    private void L1Has(FinanceBasis basis) =>
        reports.ReadAsync(Arg.Any<ReportFilter>(), Arg.Any<CancellationToken>()).Returns(new ReportBasis([basis], false));

    private FinancialReportService ReportService(ICurrentUser user) => new(reports, user, Bf08.Clock());

    private FinancialScenarioService ScenarioService(ICurrentUser user) => new(scenarios, ReportService(user), user);

    // Số liệu nền hợp lệ của L1 (có doanh thu, chi phí, vốn đầu tư 600.000.000) dùng cho What-if.
    private static FinanceBasis BaselineL1() => new(Bf08.L1, "L1", Issued: 38_000_000m, Collected: 38_000_000m, Operating: 9_500_000m,
        Investment: 600_000_000m, CumulativeCollected: 38_000_000m, CumulativeOperating: 9_500_000m, Rooms: 10, Occupied: 8);

    private static ScenarioAssumptions Assumptions(decimal rent, decimal occupancy, decimal utility, decimal staff, decimal maintenance, decimal other) =>
        new(rent, occupancy, 100m, utility, staff, maintenance, other);

    // UTC11 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; L1 2026-11: recorded revenue 38,000,000; Operating Expenses 9,500,000
    // Đầu vào : scope=L1; reportingPeriod=Month 2026-11
    // Mong đợi: Return: Revenue=38,000,000; Operating Expenses=9,500,000; Operating Profit=28,500,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-08 8.2.1 (Revenue, Operating Expenses, Operating Profit from revenue and operating expenses); UC-32
    [Fact(DisplayName = "BF08 UTC11 - Dashboard L1 11/2026: Revenue 38.000.000, OpEx 9.500.000, Profit 28.500.000")]
    public async Task UTC11_RevenueExpensesProfit()
    {
        L1Has(new FinanceBasis(Bf08.L1, "L1", Issued: 38_000_000m, Collected: 38_000_000m, Operating: 9_500_000m));

        var report = await ReportService(Bf08.OwnerUser()).ReadAsync(Bf08.Month202611(Bf08.L1), default);

        Assert.Equal(38_000_000m, Bf08.Money(report.Total.Issued));
        Assert.Equal(9_500_000m, Bf08.Money(report.Total.OperatingExpenses));
        Assert.Equal(28_500_000m, Bf08.Money(report.Total.OperatingProfit));
    }

    // UTC12 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: L1 has 10 Rooms: 8 Occupied, 1 On Hold, 1 Available
    // Đầu vào : scope=L1; reportingPeriod=Month 2026-11
    // Mong đợi: Return: Occupancy=8 occupied of 10 Rooms (80%); Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-08 8.2.1 Occupancy; Room lifecycle §3.2; UC-32
    // Ghi chú : ở tầng unit, kho dữ liệu báo cáo cung cấp sẵn 10 phòng / 8 đang ở. Việc phân loại phòng On Hold không tính là
    //           Occupied được thực hiện ở tầng truy vấn dữ liệu, không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF08 UTC12 - Dashboard L1: Occupancy 8/10 phong (80%)")]
    public async Task UTC12_Occupancy()
    {
        L1Has(new FinanceBasis(Bf08.L1, "L1", Rooms: 10, Occupied: 8));

        var report = await ReportService(Bf08.OwnerUser()).ReadAsync(Bf08.Month202611(Bf08.L1), default);

        Assert.Equal(10, report.Total.TotalRooms);
        Assert.Equal(8, report.Total.OccupiedRooms);
        Assert.Equal(80m, 100m * report.Total.OccupiedRooms / report.Total.TotalRooms);
    }

    // UTC13 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: L1 has unpaid Invoices with outstanding 2,270,000 and 4,270,000 and no other outstanding Invoice
    // Đầu vào : scope=L1; reportingPeriod=Month 2026-11
    // Mong đợi: Return: Outstanding Debt=6,540,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-08 8.2.1 Outstanding Debt; UC-32
    // Ghi chú : kho dữ liệu báo cáo trả về tổng công nợ của L1 (2.270.000 + 4.270.000); việc cộng từng hóa đơn nằm ở tầng truy vấn dữ liệu.
    [Fact(DisplayName = "BF08 UTC13 - Dashboard L1: Outstanding Debt 6.540.000")]
    public async Task UTC13_OutstandingDebt()
    {
        L1Has(new FinanceBasis(Bf08.L1, "L1", Debt: 2_270_000m + 4_270_000m));

        var report = await ReportService(Bf08.OwnerUser()).ReadAsync(Bf08.Month202611(Bf08.L1), default);

        Assert.Equal(6_540_000m, Bf08.Money(report.Total.OutstandingNow));
    }

    // UTC14 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; L1 operating profit = 0
    // Đầu vào : scope=L1; metric=Estimated Payback
    // Mong đợi: Return: Estimated Payback shown as unavailable; Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-08 8.2.1 Estimated Payback; UC-33; UC-34 A3 by analogy (see OQ)
    [Fact(DisplayName = "BF08 UTC14 - Loi nhuan van hanh = 0: Estimated Payback hien thi khong kha dung")]
    public async Task UTC14_PaybackUnavailableWhenProfitZero()
    {
        L1Has(new FinanceBasis(Bf08.L1, "L1", Issued: 5_000_000m, Collected: 5_000_000m, Operating: 5_000_000m, Investment: 600_000_000m,
            CumulativeCollected: 5_000_000m, CumulativeOperating: 5_000_000m, Rooms: 10, Occupied: 8));

        var report = await ReportService(Bf08.OwnerUser()).ReadAsync(Bf08.Month202611(Bf08.L1), default);

        Assert.Equal(0m, Bf08.Money(report.Total.OperatingProfit));
        Assert.Null(report.Capital.EstimatedRemainingMonths);
        Assert.False(string.IsNullOrWhiteSpace(report.Capital.UnavailableReason));
    }

    // UTC15 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff staff1 logged in
    // Đầu vào : scope=L1; reportingPeriod=Month 2026-11
    // Mong đợi: Return: no financial data returned; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Permission Matrix Finance/What-if (Staff No); UC-32 (Owner only); MSG03
    // Ghi chú : dịch vụ chỉ trả lỗi dạng mã nên câu MSG03 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF08 UTC15 - Staff xem dashboard tai chinh: khong tra du lieu")]
    public async Task UTC15_StaffGetsNoFinancialData()
    {
        L1Has(BaselineL1());
        FinancialReport? report = null;

        var error = await Record.ExceptionAsync(async () => report = await ReportService(Bf08.StaffUser()).ReadAsync(Bf08.Month202611(Bf08.L1), default));

        Assert.NotNull(error);
        Assert.Null(report);
        await reports.DidNotReceiveWithAnyArgs().ReadAsync(default!, default);
    }

    // UTC16 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; baseline financial data of L1 available
    // Đầu vào : scope=L1; rentalPrice=3500000; occupancyRate=90; staffCost=VALID; maintenanceCost=VALID; otherExpenses=VALID
    // Mong đợi: Return: projected revenue, OPEX, profit, net cash flow, remaining capital and estimated payback calculated and compared with actual baseline; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-34 NF 1-5; FE-08 8.3.1
    // Ghi chú : giá trị VALID chọn: Staff 5.000.000, Maintenance 1.000.000, Other 500.000, Utility 2.000.000, thu tiền 100%, dự báo 12 tháng.
    [Fact(DisplayName = "BF08 UTC16 - What-if L1 gia 3.500.000, lap day 90%: tinh du cac chi so va so sanh voi thuc te")]
    public async Task UTC16_WhatIfCalculatesAllProjections()
    {
        L1Has(BaselineL1());
        var input = new ScenarioInput("Tang gia 3.5tr", Bf08.Month202611(Bf08.L1), 12,
            Assumptions(3_500_000m, 90m, 2_000_000m, 5_000_000m, 1_000_000m, 500_000m));

        var view = await ScenarioService(Bf08.OwnerUser()).AnalyzeAsync(input, default);

        var result = view.Result;
        Assert.True(Bf08.Money(result.MonthlyRevenue) > 0, "projected revenue");
        Assert.True(Bf08.Money(result.MonthlyOperatingExpenses) > 0, "projected OPEX");
        Bf08.Money(result.MonthlyProfit);
        Bf08.Money(result.MonthlyNetCashFlow);
        Bf08.Money(result.RemainingCapitalAtEnd);
        Bf08.Money(result.EstimatedRemainingMonths);
        Bf08.Money(result.MonthlyProfitDifference);
        Assert.NotNull(view.Baseline);
        Assert.Equal(28_500_000m, Bf08.Money(view.Baseline.Total.OperatingProfit));
    }

    // UTC17 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in
    // Đầu vào : assumptions where projected OPEX greater than projected revenue
    // Mong đợi: Return: Projected Profit negative; Estimated Payback shown as unavailable; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-34 A3
    [Fact(DisplayName = "BF08 UTC17 - What-if OPEX lon hon doanh thu: Profit am, Payback khong kha dung")]
    public async Task UTC17_NegativeProfitMakesPaybackUnavailable()
    {
        L1Has(BaselineL1());
        // 10 phòng x 1.000.000 x 50% = 5.000.000 doanh thu/tháng < OPEX 20.000.000/tháng.
        var input = new ScenarioInput("Chi phi vuot doanh thu", Bf08.Month202611(Bf08.L1), 12,
            Assumptions(1_000_000m, 50m, 5_000_000m, 10_000_000m, 3_000_000m, 2_000_000m));

        var view = await ScenarioService(Bf08.OwnerUser()).AnalyzeAsync(input, default);

        Assert.True(Bf08.Money(view.Result.MonthlyOperatingExpenses) > Bf08.Money(view.Result.MonthlyRevenue), "Dieu kien: OPEX > doanh thu");
        Assert.True(Bf08.Money(view.Result.MonthlyProfit) < 0, "Projected Profit phai am");
        Assert.Null(view.Result.EstimatedRemainingMonths);
        Assert.False(string.IsNullOrWhiteSpace(view.Result.UnavailableReason));
    }

    // UTC18 (Abnormal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in
    // Đầu vào : rentalPrice=null; other assumptions valid
    // Mong đợi: Return: scenario marked incomplete or saved as Draft; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-34 A1
    // Ghi chú : ScenarioAssumptions.MonthlyRent có kiểu decimal (không nhận null) và ScenarioView/ScenarioResult không có trạng thái
    //           Incomplete/Draft, nên đầu vào rentalPrice=null không biểu diễn được ở tầng unit; cần kiểm tra ở tầng API.
    [Fact(DisplayName = "BF08 UTC18 - Thieu rentalPrice: kich ban danh dau chua du hoac luu Draft",
        Skip = "rentalPrice=null khong bieu dien duoc qua chu ky ScenarioAssumptions (decimal); can kiem tra o tang API")]
    public void UTC18_MissingRentalPrice() { }

    // UTC19 (Normal) - sheet "BF-08 Finance Reporting", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Scenario saved
    // Đầu vào : compare actual dashboard before/after save
    // Mong đợi: Return: actual Revenue/OpEx unchanged; no Contract, price, invoice, payment or expense written; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-15; DBR-11; UC-34 Postcondition; FE-08 8.3.1
    // Ghi chú : theo chữ ký, dịch vụ kịch bản chỉ phụ thuộc kho kịch bản và dịch vụ báo cáo (không có kho hợp đồng/hóa đơn/
    //           thanh toán/chi phí). Test kiểm tra: số liệu thực tế trước/sau như nhau, kho báo cáo chỉ bị đọc, chỉ kho kịch bản được ghi.
    [Fact(DisplayName = "BF08 UTC19 - Luu kich ban: so lieu thuc te khong doi, khong ghi du lieu thuc te")]
    public async Task UTC19_SavingScenarioDoesNotChangeActualData()
    {
        L1Has(BaselineL1());
        scenarios.SaveAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<ScenarioView>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<ScenarioView>() with { Id = Guid.NewGuid() });
        var owner = Bf08.OwnerUser();
        var before = await ReportService(owner).ReadAsync(Bf08.Month202611(Bf08.L1), default);

        await ScenarioService(owner).SaveAsync(new ScenarioInput("Kich ban luu", Bf08.Month202611(Bf08.L1), 12,
            Assumptions(3_500_000m, 90m, 2_000_000m, 5_000_000m, 1_000_000m, 500_000m)), Guid.NewGuid(), default);
        var after = await ReportService(owner).ReadAsync(Bf08.Month202611(Bf08.L1), default);

        Assert.Equal(before.Total.Issued, after.Total.Issued);
        Assert.Equal(before.Total.OperatingExpenses, after.Total.OperatingExpenses);
        await scenarios.Received(1).SaveAsync(Arg.Any<Guid>(), Bf08.Owner1, Arg.Any<ScenarioView>(), Arg.Any<CancellationToken>());
        Assert.All(reports.ReceivedCalls(), call => Assert.Equal(nameof(IFinancialReportRepository.ReadAsync), call.GetMethodInfo().Name));
    }
}
