using System.Globalization;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record ReportFilter(DateOnly From, DateOnly To, Guid? LocationId = null, Guid? RoomId = null);
public sealed record FinanceTotals(string Issued, string ApprovedAdjustments, string VerifiedCollections,
    string OperatingExpenses, string OperatingProfit, string OutstandingNow, string InitialInvestment,
    string? NetOperatingCashFlow, int TotalRooms, int OccupiedRooms);
public sealed record LocationFinance(Guid LocationId, string LocationName, FinanceTotals Totals);
public sealed record CapitalRecovery(string InitialInvestment, string? NetRecovery, string? RemainingCapital,
    string? RecoveryPercent, string? EstimatedRemainingMonths, string? UnavailableReason);
public sealed record FinancialReport(ReportFilter Filter, DateTimeOffset SnapshotAt, FinanceTotals Total,
    IReadOnlyList<LocationFinance> Locations, CapitalRecovery Capital, bool HasUnclassifiedRefunds,
    HistoricalOccupancy? HistoricalOccupancy = null, string? VerifiedDepositReturns = null);
public sealed record FinanceBasis(Guid LocationId, string LocationName, decimal Issued = 0, decimal Adjustments = 0,
    decimal Collected = 0, decimal Operating = 0, decimal Debt = 0, decimal Investment = 0,
    decimal CumulativeCollected = 0, decimal CumulativeOperating = 0, int Rooms = 0, int Occupied = 0);
public sealed record ReportBasis(IReadOnlyList<FinanceBasis> Locations, bool HasUnclassifiedRefunds,
    HistoricalOccupancy? HistoricalOccupancy = null, decimal? VerifiedDepositReturns = null);
public interface IFinancialReportRepository
{
    Task<ReportBasis> ReadAsync(ReportFilter filter, CancellationToken token);
}
public sealed class FinancialReportService(IFinancialReportRepository repository, ICurrentUser user, TimeProvider clock)
{
    internal static string Number(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private void Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401,"authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403,"finance_owner_required");
    }
    public async Task<FinancialReport> ReadAsync(ReportFilter filter, CancellationToken token)
    {
        Owner();
        if (filter.From == default || filter.To == default || filter.To < filter.From || filter.To.Year >= 9999 ||
            filter.LocationId == Guid.Empty || filter.RoomId == Guid.Empty)
            throw new FinanceException(400,"invalid_finance_filter");
        var basis = await repository.ReadAsync(filter,token);
        return Calculate(filter, basis, clock.GetUtcNow());
    }
    public static FinancialReport Calculate(ReportFilter filter, ReportBasis basis, DateTimeOffset now)
    {
        FinanceTotals Totals(FinanceBasis row) => new(Number(row.Issued),Number(row.Adjustments),Number(row.Collected),Number(row.Operating),
            Number(row.Issued+row.Adjustments-row.Operating),Number(row.Debt),Number(row.Investment),
            basis.HasUnclassifiedRefunds ? null : Number(row.Collected-row.Operating),row.Rooms,row.Occupied);
        var values=basis.Locations;
        var total=new FinanceBasis(Guid.Empty,"",values.Sum(v=>v.Issued),values.Sum(v=>v.Adjustments),values.Sum(v=>v.Collected),
            values.Sum(v=>v.Operating),values.Sum(v=>v.Debt),values.Sum(v=>v.Investment),values.Sum(v=>v.CumulativeCollected),
            values.Sum(v=>v.CumulativeOperating),values.Sum(v=>v.Rooms),values.Sum(v=>v.Occupied));
        var recovered=total.CumulativeCollected-total.CumulativeOperating;
        var remaining=Math.Max(0,total.Investment-recovered);
        var fullMonths=filter.From.Day==1 && filter.To.Day==DateTime.DaysInMonth(filter.To.Year,filter.To.Month);
        var months=(filter.To.Year-filter.From.Year)*12+filter.To.Month-filter.From.Month+1;
        var monthly=(total.Collected-total.Operating)/months;
        var reason=basis.HasUnclassifiedRefunds ? "refund_classification_required" : total.Investment<=0 ? "initial_investment_required" :
            !fullMonths ? "full_month_baseline_required" : remaining>0 && monthly<=0 ? "positive_cash_flow_required" : null;
        var capital=new CapitalRecovery(Number(total.Investment),basis.HasUnclassifiedRefunds ? null : Number(recovered),
            basis.HasUnclassifiedRefunds ? null : Number(remaining),basis.HasUnclassifiedRefunds || total.Investment<=0 ? null : Number(recovered/total.Investment*100),
            reason is not null ? null : Number(remaining==0 ? 0 : remaining/monthly),reason);
        return new(filter,now,Totals(total),values.Select(v=>new LocationFinance(v.LocationId,v.LocationName,Totals(v))).ToArray(),capital,basis.HasUnclassifiedRefunds,basis.HistoricalOccupancy,
            basis.VerifiedDepositReturns is {} returned ? Number(returned) : null);
    }
}
