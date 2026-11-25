using System.Globalization;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record ReportFilter(DateOnly From, DateOnly To, Guid? LocationId = null, Guid? RoomId = null, bool IncludeComparison = false);
public sealed record FinanceTotals(string Issued, string ApprovedAdjustments, string VerifiedCollections,
    string OperatingExpenses, string OperatingProfit, string OutstandingNow, string InitialInvestment,
    string? NetOperatingCashFlow, int TotalRooms, int OccupiedRooms, FinanceManagementTotals? Management = null);
public sealed record SettlementFinanceSources(string ApprovedCharges, string OutstandingNow, string VerifiedBankCollections,
    string DepositOffsetsApplied, string HoldingForfeitures);
public sealed record LocationFinance(Guid LocationId, string LocationName, FinanceTotals Totals, SettlementFinanceSources? SettlementSources = null);
public sealed record CapitalRecovery(string InitialInvestment, string? NetRecovery, string? RemainingCapital,
    string? RecoveryPercent, string? EstimatedRemainingMonths, string? UnavailableReason);
public sealed record FinancialReport(ReportFilter Filter, DateTimeOffset SnapshotAt, FinanceTotals Total,
    IReadOnlyList<LocationFinance> Locations, CapitalRecovery Capital, bool HasUnclassifiedRefunds,
    HistoricalOccupancy? HistoricalOccupancy = null, string? VerifiedDepositReturns = null, SettlementFinanceSources? SettlementSources = null,
    FinanceComparison? Comparison = null, ReceiptReconciliation? ReceiptReconciliation = null,
    IReadOnlyList<FinanceTrendPoint>? Trend = null, string? TrendUnavailableReason = null);
public sealed record FinanceTrendPoint(DateOnly From, DateOnly To, string Revenue, string OperatingExpenses,
    string OperatingProfit, string ActualBusinessCollections, string OperatingPaymentsConfirmed, bool IsComplete);
public sealed record ReceiptReconciliation(string VerifiedBankReceipts, string UnallocatedAtReview, string ExcessRefundedInPeriod);
public sealed record BankReceiptSource(Guid Id, DateTimeOffset ReceivedAt, string Reference, string Amount,
    string Allocated, string GrossUnallocated);
public sealed record BankReceiptSourcePage(IReadOnlyList<BankReceiptSource> Items, long Total, int Page,
    int PageSize, string TotalReceived, string TotalGrossUnallocated, DateTimeOffset SnapshotAt);
public sealed record BankRefundSource(Guid Id, Guid PaymentId, DateTimeOffset ExecutedAt, string Amount, string? Reference);
public sealed record BankRefundSourcePage(IReadOnlyList<BankRefundSource> Items, long Total, int Page,
    int PageSize, string TotalAmount, DateTimeOffset SnapshotAt);
public sealed record FinanceBasis(Guid LocationId, string LocationName, decimal Issued = 0, decimal Adjustments = 0,
    decimal Collected = 0, decimal Operating = 0, decimal Debt = 0, decimal Investment = 0,
    decimal CumulativeCollected = 0, decimal CumulativeOperating = 0, int Rooms = 0, int Occupied = 0,
    decimal SettlementCharges = 0, decimal SettlementDebt = 0, decimal SettlementCollections = 0, decimal DepositOffsets = 0, decimal HoldingForfeitures = 0,
    FinanceManagementBasis? Management = null);
public sealed record ReportBasis(IReadOnlyList<FinanceBasis> Locations, bool HasUnclassifiedRefunds,
    HistoricalOccupancy? HistoricalOccupancy = null, decimal? VerifiedDepositReturns = null, FinanceComparison? Comparison = null,
    ReceiptReconciliation? ReceiptReconciliation = null,
    IReadOnlyList<FinanceTrendPoint>? Trend = null, string? TrendUnavailableReason = null);
public sealed record FinanceSourceRow(Guid Id, string Kind, Guid LocationId, Guid RoomId, string RoomNumber,
    Guid ContractId, DateOnly BasisDate, decimal Amount, Guid? PaymentId = null, DateTimeOffset? ReceivedAt = null,
    string? Reference = null, decimal? Original = null, decimal? Adjustments = null, decimal? Allocated = null);
public sealed record FinanceSourceItem(Guid Id, string Kind, Guid LocationId, Guid RoomId, string RoomNumber,
    Guid ContractId, DateOnly BasisDate, string Amount, Guid? PaymentId, DateTimeOffset? ReceivedAt,
    string? Reference, string? Original, string? Adjustments, string? Allocated);
public sealed record FinanceSourcePage(IReadOnlyList<FinanceSourceItem> Items, long Total, string TotalAmount, int Page, int PageSize, DateTimeOffset SnapshotAt);
public interface IFinancialReportRepository
{
    Task<ReportBasis> ReadAsync(ReportFilter filter, CancellationToken token);
    Task<(IReadOnlyList<FinanceSourceRow> Items, long Total, decimal Amount)> SourcesAsync(ReportFilter filter, string kind, int page, int pageSize, CancellationToken token);
    Task<DepreciationSourcePage> DepreciationSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token);
    Task<BankReceiptSourcePage> BankReceiptSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token);
    Task<BankRefundSourcePage> BankRefundSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token);
}
public sealed class FinancialReportService(IFinancialReportRepository repository, ICurrentUser user, TimeProvider clock)
{
    internal static string Number(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private void Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
    }
    private static void Validate(ReportFilter filter)
    {
        if (filter.From == default || filter.To == default || filter.To < filter.From || filter.To.Year >= 9999 ||
            filter.LocationId == Guid.Empty || filter.RoomId == Guid.Empty)
            throw new FinanceException(400, "invalid_finance_filter");
    }
    public async Task<FinancialReport> ReadAsync(ReportFilter filter, CancellationToken token)
    {
        Owner();
        Validate(filter);
        var basis = await repository.ReadAsync(filter, token);
        return Calculate(filter, basis, clock.GetUtcNow());
    }
    public Task<DepreciationSourcePage> DepreciationSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        Owner();
        Validate(filter);
        if (page < 1 || pageSize is < 1 or > 100 || (long)(page - 1) * pageSize > int.MaxValue)
            throw new FinanceException(400, "invalid_finance_filter");
        return repository.DepreciationSourcesAsync(filter, page, pageSize, token);
    }
    public Task<BankReceiptSourcePage> BankReceiptSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        Owner();
        Validate(filter);
        if (filter.LocationId is not null || filter.RoomId is not null || page < 1 ||
            pageSize is < 1 or > 100 || (long)(page - 1) * pageSize > int.MaxValue)
            throw new FinanceException(400, "invalid_finance_filter");
        return repository.BankReceiptSourcesAsync(filter, page, pageSize, token);
    }
    public Task<BankRefundSourcePage> BankRefundSourcesAsync(ReportFilter filter, int page, int pageSize, CancellationToken token)
    {
        Owner();
        Validate(filter);
        if (filter.LocationId is not null || filter.RoomId is not null || page < 1 ||
            pageSize is < 1 or > 100 || (long)(page - 1) * pageSize > int.MaxValue)
            throw new FinanceException(400, "invalid_finance_filter");
        return repository.BankRefundSourcesAsync(filter, page, pageSize, token);
    }
    public async Task<FinanceSourcePage> SourcesAsync(ReportFilter filter, string kind, int page, int pageSize, CancellationToken token)
    {
        Owner();
        Validate(filter);
        if (kind is not ("revenue" or "cash" or "debt" or "period-debt" or "deposit") || page < 1 ||
            pageSize is < 1 or > 100 || (long)(page - 1) * pageSize > int.MaxValue)
            throw new FinanceException(400, "invalid_finance_filter");
        var result = await repository.SourcesAsync(filter, kind, page, pageSize, token);
        string? Optional(decimal? value) => value is { } amount ? Number(amount) : null;
        return new(result.Items.Select(row => new FinanceSourceItem(row.Id, row.Kind, row.LocationId, row.RoomId, row.RoomNumber,
            row.ContractId, row.BasisDate, Number(row.Amount), row.PaymentId, row.ReceivedAt, row.Reference,
            Optional(row.Original), Optional(row.Adjustments), Optional(row.Allocated))).ToArray(),
            result.Total, Number(result.Amount), page, pageSize, clock.GetUtcNow());
    }
    public static FinancialReport Calculate(ReportFilter filter, ReportBasis basis, DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        SettlementFinanceSources Sources(FinanceBasis row) => new(Number(row.SettlementCharges), Number(row.SettlementDebt),
            Number(row.SettlementCollections), Number(row.DepositOffsets), Number(row.HoldingForfeitures));
        FinanceTotals Totals(FinanceBasis row) => new(Number(row.Issued), Number(row.Adjustments), Number(row.Collected), Number(row.Operating),
            Number(row.Issued + row.Adjustments - row.Operating), Number(row.Debt), Number(row.Investment),
            basis.HasUnclassifiedRefunds ? null : Number(row.Collected - row.Operating), row.Rooms, row.Occupied,
            FinanceManagementMath.Calculate(row, basis.HasUnclassifiedRefunds, filter, today));
        var values = basis.Locations;
        var total = new FinanceBasis(Guid.Empty, "", values.Sum(v => v.Issued), values.Sum(v => v.Adjustments), values.Sum(v => v.Collected),
            values.Sum(v => v.Operating), values.Sum(v => v.Debt), values.Sum(v => v.Investment), values.Sum(v => v.CumulativeCollected),
            values.Sum(v => v.CumulativeOperating), values.Sum(v => v.Rooms), values.Sum(v => v.Occupied),
            values.Sum(v => v.SettlementCharges), values.Sum(v => v.SettlementDebt), values.Sum(v => v.SettlementCollections), values.Sum(v => v.DepositOffsets), values.Sum(v => v.HoldingForfeitures),
            FinanceManagementMath.Combine(values));
        var recovered = total.CumulativeCollected - total.CumulativeOperating;
        var remaining = Math.Max(0, total.Investment - recovered);
        var fullMonths = filter.From.Day == 1 && filter.To.Day == DateTime.DaysInMonth(filter.To.Year, filter.To.Month) && filter.To < today;
        var months = (filter.To.Year - filter.From.Year) * 12 + filter.To.Month - filter.From.Month + 1;
        var monthly = (total.Collected - total.Operating) / months;
        var reason = basis.HasUnclassifiedRefunds ? "refund_classification_required" : total.Investment <= 0 ? "initial_investment_required" :
            !fullMonths ? "full_month_baseline_required" : remaining > 0 && monthly <= 0 ? "positive_cash_flow_required" : null;
        var capital = new CapitalRecovery(Number(total.Investment), basis.HasUnclassifiedRefunds ? null : Number(recovered),
            basis.HasUnclassifiedRefunds ? null : Number(remaining), basis.HasUnclassifiedRefunds || total.Investment <= 0 ? null : Number(recovered / total.Investment * 100),
            reason is not null ? null : Number(remaining == 0 ? 0 : remaining / monthly), reason);
        return new(filter, now, Totals(total), values.Select(v => new LocationFinance(v.LocationId, v.LocationName, Totals(v), Sources(v))).ToArray(), capital, basis.HasUnclassifiedRefunds, basis.HistoricalOccupancy,
            basis.VerifiedDepositReturns is { } returned ? Number(returned) : null, Sources(total), basis.Comparison, basis.ReceiptReconciliation,
            basis.Trend, basis.TrendUnavailableReason);
    }
}
