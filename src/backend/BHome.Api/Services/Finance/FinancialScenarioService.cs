using System.Globalization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed class FinancialScenarioService(IFinancialScenarioRepository repository, FinancialReportService reports, ICurrentUser user)
{
    public const string CalculationVersion = "management-cash-v2";
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required"); return id;
    }
    public Task<ScenarioDefaults> DefaultsAsync(ReportFilter filter, CancellationToken token)
    {
        _ = Owner();
        if (filter.RoomId is not null || filter.From.Day != 1 ||
            filter.To.Day != DateTime.DaysInMonth(filter.To.Year, filter.To.Month))
            throw new FinanceException(400, "full_month_baseline_required");
        return repository.ReadSnapshotAsync(() => ReadDefaultsAsync(filter, token), token);
    }
    private async Task<ScenarioDefaults> ReadDefaultsAsync(ReportFilter filter, CancellationToken token)
    {
        var report = await reports.ReadAsync(filter with { IncludeComparison = false }, token);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(report.SnapshotAt, "Asia/Ho_Chi_Minh").DateTime);
        if (filter.To >= today) throw new FinanceException(400, "completed_baseline_required");
        var management = report.Total.Management;
        var months = (filter.To.Year - filter.From.Year) * 12 + filter.To.Month - filter.From.Month + 1;
        decimal Parse(string value) => decimal.Parse(value, CultureInfo.InvariantCulture);
        string? Monthly(decimal? value) => value is { } amount
            ? FinancialReportService.Number(decimal.Round(amount / months, 0, MidpointRounding.AwayFromZero)) : null;
        var categories = management?.ExpenseCategories;
        // One exclusive bucket per category. Repair of electrical/water equipment is maintenance.
        static string Bucket(string label)
        {
            var category = label.Trim().ToLowerInvariant();
            if (category is "lương" or "thưởng" or "phụ cấp" or "chi phí nhân sự khác" || category.Contains("salary")) return "staff";
            if (category.Contains("bảo trì") || category.Contains("sửa chữa") || category.Contains("maintenance") || category.Contains("repair")) return "maintenance";
            if (category.Contains("điện") || category.Contains("nước") || category.Contains("utilit") || category.Contains("internet")) return "utilities";
            return "other";
        }
        var categorized = categories?.GroupBy(c => Bucket(c.Category)).ToDictionary(g => g.Key, g => g.Sum(c => Parse(c.Amount)));
        decimal? Cost(string bucket) => categorized?.GetValueOrDefault(bucket);
        var nextMonth = new DateOnly(today.Year, today.Month, 1).AddMonths(1);
        var obligations = await repository.ObligationsAsync(filter, nextMonth, token);
        var nextDepreciation = await reports.DepreciationSourcesAsync(
            new(nextMonth, nextMonth.AddMonths(1).AddDays(-1), filter.LocationId), 1, 1, token);
        var historicRecurring = Parse(obligations.HistoricalGeneratedRecurring);
        var historicSalary = Parse(obligations.HistoricalAllocatedSalary);
        var manualSalary = (categories?.Where(c => c.Category == "Lương").Sum(c => Parse(c.Amount)) ?? 0) - historicSalary;
        var other = Cost("other") is { } otherCost
            && otherCost >= historicRecurring
            ? FinancialReportService.Number(decimal.Round((otherCost - historicRecurring) / months + Parse(obligations.RecurringDue), 0, MidpointRounding.AwayFromZero)) : null;
        var staff = obligations.ContractualSalary is { } salary && Cost("staff") is { } staffCost
            && staffCost >= historicSalary && manualSalary == 0
            ? FinancialReportService.Number(decimal.Round((staffCost - historicSalary) / months + Parse(salary), 0, MidpointRounding.AwayFromZero)) : null;
        return new(filter, report.SnapshotAt, obligations.RentCoverage?.MonthlyRent,
            obligations.RentCoverage?.OccupancyPercent, management?.CollectionRatePercent is { } rate
                ? FinancialReportService.Number(Math.Clamp(Parse(rate), 0, 100)) : null,
            Monthly(Cost("utilities")), staff, Monthly(Cost("maintenance")), other,
            nextDepreciation.TotalAmount,
            ["Giá thuê và tỷ lệ lấp đầy dự kiến theo số ngày phòng có hợp đồng MAIN đang hiệu lực trong tháng kế tiếp; mỗi phòng chỉ tính một lần. Không giả định hợp đồng chưa kích hoạt hoặc khách thuê mới.",
             "Giá thuê là bình quân theo ngày có hợp đồng; dự báo theo tỷ lệ ngày, không thay thế quy tắc lập hóa đơn. Nếu hợp đồng cùng phòng có giá khác nhau hoặc thiếu giá, cần Chủ trọ xác nhận.",
             "Chi phí định kỳ và lương hợp đồng được dự kiến cho tháng lịch kế tiếp; thay thế phần tương ứng trong kỳ nền, không cộng trùng. Các chi phí khác lấy bình quân kỳ nền.",
             "Lương thiếu thông tin, hợp đồng không đủ tháng hoặc chưa có phân bổ nhiều cơ sở cần Chủ trọ xác nhận; không tự chia đều.",
             "Khoản lương nhập thủ công chưa có nguồn phân bổ được giữ ngoài giả định tự động để tránh tính trùng hợp đồng.",
             "Kịch bản dùng giả định tháng không đổi; cần điều chỉnh nếu nghĩa vụ thay đổi trong các tháng sau.",
             "Doanh thu ngoài tiền thuê lấy bình quân dòng hóa đơn đã phát hành và điều chỉnh có thể quy thuộc; gồm điện, nước và dịch vụ. Không bao gồm cọc, bồi thường hay thu thanh lý.",
             "Tỷ lệ thực chi lấy số tiền đã trả đến cuối kỳ của các khoản chi phát sinh trong kỳ nền; không lấy tiền trả nợ kỳ trước chia cho chi phí kỳ này. Thiếu lịch sử thì cần xác nhận.",
             "Khấu hao dự kiến theo cấu hình có hiệu lực của lô hiện có trong tháng kế tiếp; chưa bao gồm đầu tư mới giả định. Báo cáo nền, nghĩa vụ và khấu hao dùng cùng ảnh chụp dữ liệu.",
             "Đầu tư bổ sung cần được xác nhận riêng."], obligations,
            Monthly(obligations.HistoricalNonRentRevenue is { } service ? Parse(service) : null),
            obligations.HistoricalOperatingPaymentPercent);
    }
    public async Task<ScenarioView> AnalyzeAsync(ScenarioInput input, CancellationToken token)
    {
        _ = Owner();
        if (input.Baseline is null || input.Assumptions is null || string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || input.ForecastMonths is < 1 or > short.MaxValue || input.Baseline.RoomId is not null)
            throw new FinanceException(400, "invalid_scenario");
        var a = input.Assumptions;
        if (a.OccupancyPercent is < 0 or > 100 || a.CollectionPercent is < 0 or > 100 ||
            a.OperatingPaymentPercent is < 0 or > 100 || a.CostIncreasePercent is < 0 or > 1000 ||
            new[] { a.MonthlyRent, a.MonthlyUtilityServiceCost, a.MonthlyStaffCost, a.MonthlyMaintenanceCost, a.MonthlyOtherCost,
                a.MonthlyServiceRevenue, a.AdditionalInvestment, a.MonthlyDepreciation ?? 0 }.Any(v => v < 0 || v >= 1_000_000_000_000_000_000m || decimal.Truncate(v) != v))
            throw new FinanceException(400, "invalid_scenario_assumptions");
        var baseline = await reports.ReadAsync(input.Baseline, token);
        if (baseline.Total.TotalRooms == 0) throw new FinanceException(400, "scenario_rooms_required");
        if (input.Baseline.From.Day != 1 || input.Baseline.To.Day != DateTime.DaysInMonth(input.Baseline.To.Year, input.Baseline.To.Month))
            throw new FinanceException(400, "full_month_baseline_required");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(baseline.SnapshotAt, "Asia/Ho_Chi_Minh").DateTime);
        if (input.Baseline.To >= today) throw new FinanceException(400, "completed_baseline_required");
        return new(null, input, baseline, Calculate(input, baseline), CalculationVersion);
    }
    public static ScenarioResult Calculate(ScenarioInput input, FinancialReport baseline)
    {
        try
        {
            var a = input.Assumptions;
            decimal Money(decimal value) => decimal.Round(value, 0, MidpointRounding.AwayFromZero);
            var revenue = Money(baseline.Total.TotalRooms * a.OccupancyPercent / 100 * a.MonthlyRent + a.MonthlyServiceRevenue);
            var collected = Money(revenue * a.CollectionPercent / 100);
            var costs = Money((a.MonthlyUtilityServiceCost + a.MonthlyStaffCost + a.MonthlyMaintenanceCost + a.MonthlyOtherCost) * (1 + a.CostIncreasePercent / 100));
            var paid = Money(costs * a.OperatingPaymentPercent / 100);
            var profit = revenue - costs; var cash = collected - paid;
            var forecast = cash * input.ForecastMonths;
            // Historical saved v1 snapshots are still readable. New reports use the actual-cash basis.
            var recovery = baseline.Total.Management is null ? baseline.Capital : baseline.Total.Management.CashCapital;
            var capital = recovery?.RemainingCapital is { } amount ? decimal.Parse(amount, CultureInfo.InvariantCulture) + a.AdditionalInvestment : (decimal?)null;
            // A known zero historical investment is different from an unknown basis.
            // Explicit new investment supplies the capital for this scenario only.
            var hasCapitalBasis = recovery?.RecoveryPercent is not null ||
                a.AdditionalInvestment > 0 && recovery?.UnavailableReason == "initial_investment_required";
            var reason = baseline.HasUnclassifiedRefunds ? "refund_classification_required" : capital is null || !hasCapitalBasis ? recovery?.UnavailableReason ?? "initial_investment_required" :
                capital > 0 && cash <= 0 ? "positive_cash_flow_required" : null;
            var months = (input.Baseline.To.Year - input.Baseline.From.Year) * 12 + input.Baseline.To.Month - input.Baseline.From.Month + 1;
            var baselineProfit = decimal.Parse(baseline.Total.OperatingProfit, CultureInfo.InvariantCulture) / months;
            var baselineOpex = decimal.Parse(baseline.Total.OperatingExpenses, CultureInfo.InvariantCulture) / months;
            var warnings = new List<string>();
            if (baseline.Total.Management is { } management)
            {
                if (decimal.Parse(management.CurrentOutstanding, CultureInfo.InvariantCulture) > 0) warnings.Add("outstanding_debt");
                if (management.CashFlowUnavailableReason is not null) warnings.Add("incomplete_cash_history");
            }
            if (a.MonthlyDepreciation is null) warnings.Add("missing_depreciation");
            if (costs > baselineOpex) warnings.Add("higher_operating_cost");
            if (profit < baselineProfit) warnings.Add("lower_operating_profit");
            if (cash <= 0 || forecast - a.AdditionalInvestment < 0) warnings.Add("cash_shortfall_risk");
            return new(FinancialReportService.Number(revenue), FinancialReportService.Number(collected), FinancialReportService.Number(costs),
                FinancialReportService.Number(profit), FinancialReportService.Number(cash), FinancialReportService.Number(forecast),
                capital is null || baseline.HasUnclassifiedRefunds || !hasCapitalBasis
                    ? null : FinancialReportService.Number(Math.Max(0, capital.Value - forecast)),
                reason is not null ? null : FinancialReportService.Number(capital == 0 ? 0 : capital!.Value / cash),
                FinancialReportService.Number(profit - baselineProfit), reason,
                a.MonthlyDepreciation is { } depreciation ? FinancialReportService.Number(profit - depreciation) : null,
                revenue > 0 ? FinancialReportService.Number(decimal.Round(profit / revenue * 100, 2, MidpointRounding.AwayFromZero)) : null,
                FinancialReportService.Number(paid), FinancialReportService.Number(forecast - a.AdditionalInvestment), warnings);
        }
        catch (OverflowException) { throw new FinanceException(400, "scenario_out_of_range"); }
    }
    public async Task<ScenarioView> SaveAsync(ScenarioInput input, Guid key, CancellationToken token)
    {
        var actor = Owner(); if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        // Replay returns the saved baseline/result even if actual prices/ledgers have changed.
        if (await repository.GetAsync(key, actor, token) is { } previous)
        {
            if (previous.Input != input) throw new FinanceException(409, "scenario_idempotency_conflict");
            return previous;
        }
        var view = await AnalyzeAsync(input, token); return await repository.SaveAsync(key, actor, view, token);
    }
    public Task<IReadOnlyList<ScenarioSummary>> ListAsync(int page, int pageSize, CancellationToken token)
    {
        var actor = Owner(); if (page < 1 || pageSize is < 1 or > 100 || (long)(page - 1) * pageSize > int.MaxValue) throw new FinanceException(400, "invalid_finance_filter");
        return repository.ListAsync(actor, page, pageSize, token);
    }
    public async Task<ScenarioView> GetAsync(Guid id, CancellationToken token)
    { var actor = Owner(); return await repository.GetAsync(id, actor, token) ?? throw new FinanceException(404, "scenario_not_found"); }
}
