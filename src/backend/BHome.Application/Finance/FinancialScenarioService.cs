using System.Globalization;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record ScenarioAssumptions(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal OccupancyPercent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal CollectionPercent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyUtilityServiceCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyStaffCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyMaintenanceCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyOtherCost);
public sealed record ScenarioInput(string Name, ReportFilter Baseline, int ForecastMonths, ScenarioAssumptions Assumptions);
public sealed record ScenarioResult(string MonthlyRevenue, string MonthlyCollections, string MonthlyOperatingExpenses,
    string MonthlyProfit, string MonthlyNetCashFlow, string ForecastNetCashFlow, string? RemainingCapitalAtEnd,
    string? EstimatedRemainingMonths, string MonthlyProfitDifference, string? UnavailableReason);
public sealed record ScenarioView(Guid? Id, ScenarioInput Input, FinancialReport Baseline, ScenarioResult Result, string CalculationVersion);
public sealed record ScenarioSummary(Guid Id, string Name, Guid? LocationId, DateOnly BaselineFrom, DateOnly BaselineTo, int ForecastMonths, DateTimeOffset CalculatedAt);
public interface IFinancialScenarioRepository
{
    Task<ScenarioView> SaveAsync(Guid key, Guid actor, ScenarioView view, CancellationToken token);
    Task<IReadOnlyList<ScenarioSummary>> ListAsync(Guid actor, int page, int pageSize, CancellationToken token);
    Task<ScenarioView?> GetAsync(Guid id, Guid actor, CancellationToken token);
}
public sealed class FinancialScenarioService(IFinancialScenarioRepository repository, FinancialReportService reports, ICurrentUser user)
{
    public const string CalculationVersion = "management-constant-v1";
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required"); return id;
    }
    public async Task<ScenarioView> AnalyzeAsync(ScenarioInput input, CancellationToken token)
    {
        _ = Owner();
        if (input.Baseline is null || input.Assumptions is null || string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || input.ForecastMonths is < 1 or > short.MaxValue || input.Baseline.RoomId is not null)
            throw new FinanceException(400, "invalid_scenario");
        var a = input.Assumptions;
        if (a.OccupancyPercent is < 0 or > 100 || a.CollectionPercent is < 0 or > 100 ||
            new[] { a.MonthlyRent, a.MonthlyUtilityServiceCost, a.MonthlyStaffCost, a.MonthlyMaintenanceCost, a.MonthlyOtherCost }.Any(v => v < 0 || v >= 1_000_000_000_000_000_000m || decimal.Truncate(v) != v))
            throw new FinanceException(400, "invalid_scenario_assumptions");
        var baseline = await reports.ReadAsync(input.Baseline, token);
        if (baseline.Total.TotalRooms == 0) throw new FinanceException(400, "scenario_rooms_required");
        if (input.Baseline.From.Day != 1 || input.Baseline.To.Day != DateTime.DaysInMonth(input.Baseline.To.Year, input.Baseline.To.Month))
            throw new FinanceException(400, "full_month_baseline_required");
        return new(null, input, baseline, Calculate(input, baseline), CalculationVersion);
    }
    public static ScenarioResult Calculate(ScenarioInput input, FinancialReport baseline)
    {
        try
        {
            var a = input.Assumptions;
            decimal Money(decimal value) => decimal.Round(value, 0, MidpointRounding.AwayFromZero);
            var revenue = Money(baseline.Total.TotalRooms * a.OccupancyPercent / 100 * a.MonthlyRent);
            var collected = Money(revenue * a.CollectionPercent / 100);
            var costs = a.MonthlyUtilityServiceCost + a.MonthlyStaffCost + a.MonthlyMaintenanceCost + a.MonthlyOtherCost;
            var profit = revenue - costs; var cash = collected - costs;
            var forecast = cash * input.ForecastMonths;
            var capital = baseline.Capital.RemainingCapital is { } amount ? decimal.Parse(amount, CultureInfo.InvariantCulture) : (decimal?)null;
            var reason = baseline.HasUnclassifiedRefunds ? "refund_classification_required" : capital is null || baseline.Capital.RecoveryPercent is null ? "initial_investment_required" :
                capital > 0 && cash <= 0 ? "positive_cash_flow_required" : null;
            var months = (input.Baseline.To.Year - input.Baseline.From.Year) * 12 + input.Baseline.To.Month - input.Baseline.From.Month + 1;
            var baselineProfit = decimal.Parse(baseline.Total.OperatingProfit, CultureInfo.InvariantCulture) / months;
            return new(FinancialReportService.Number(revenue), FinancialReportService.Number(collected), FinancialReportService.Number(costs),
                FinancialReportService.Number(profit), FinancialReportService.Number(cash), FinancialReportService.Number(forecast),
                capital is null ? null : FinancialReportService.Number(Math.Max(0, capital.Value - forecast)),
                reason is not null ? null : FinancialReportService.Number(capital == 0 ? 0 : capital!.Value / cash),
                FinancialReportService.Number(profit - baselineProfit), reason);
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
