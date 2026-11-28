using System.Text.Json.Serialization;

namespace BHome.Application.Finance;

public sealed record ScenarioAssumptions(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyRent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal OccupancyPercent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal CollectionPercent,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyUtilityServiceCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyStaffCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyMaintenanceCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyOtherCost,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal MonthlyServiceRevenue = 0,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal AdditionalInvestment = 0,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal? MonthlyDepreciation = null,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal OperatingPaymentPercent = 100,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal CostIncreasePercent = 0);
public sealed record ScenarioInput(string Name, ReportFilter Baseline, int ForecastMonths, ScenarioAssumptions Assumptions);
public sealed record ScenarioResult(string MonthlyRevenue, string MonthlyCollections, string MonthlyOperatingExpenses,
    string MonthlyProfit, string MonthlyNetCashFlow, string ForecastNetCashFlow, string? RemainingCapitalAtEnd,
    string? EstimatedRemainingMonths, string MonthlyProfitDifference, string? UnavailableReason,
    string? MonthlyProfitAfterDepreciation = null, string? MonthlyMarginPercent = null,
    string? MonthlyOperatingPayments = null, string? ForecastCashAfterInvestment = null,
    IReadOnlyList<string>? Warnings = null);
public sealed record ScenarioView(Guid? Id, ScenarioInput Input, FinancialReport Baseline, ScenarioResult Result, string CalculationVersion);
public sealed record ScenarioSummary(Guid Id, string Name, Guid? LocationId, DateOnly BaselineFrom, DateOnly BaselineTo, int ForecastMonths, DateTimeOffset CalculatedAt);
public sealed record ScenarioDefaults(ReportFilter Baseline, DateTimeOffset SnapshotAt,
    string? MonthlyRent, string? OccupancyPercent, string? CollectionPercent, string? MonthlyUtilityServiceCost,
    string? MonthlyStaffCost, string? MonthlyMaintenanceCost, string? MonthlyOtherCost, string? MonthlyDepreciation,
    IReadOnlyList<string> Limitations, ForecastObligations? Obligations = null,
    string? MonthlyServiceRevenue = null, string? OperatingPaymentPercent = null);
public sealed record ForecastObligations(DateOnly From, DateOnly To, string RecurringDue,
    string? ContractualSalary, int RecurringCount, int StaffCount, int UnresolvedStaffCount,
    string HistoricalGeneratedRecurring = "0", string HistoricalAllocatedSalary = "0",
    string? HistoricalNonRentRevenue = null, string? HistoricalOperatingPaymentPercent = null,
    ForecastRentCoverage? RentCoverage = null);
public sealed record ForecastRentCoverage(int Rooms, int ContractedRooms, long OccupiedRoomDays,
    long PossibleRoomDays, int UnresolvedRooms, string? MonthlyRent, string? OccupancyPercent);
