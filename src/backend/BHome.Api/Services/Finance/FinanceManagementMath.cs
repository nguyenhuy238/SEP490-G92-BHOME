namespace BHome.Application.Finance;

public sealed record ExpenseCategoryAmount(string Category, string Amount);
public sealed record FinanceManagementTotals(
    string Revenue, string ActualBusinessCollections, string CurrentOutstanding, string OverdueInvoiceOutstanding,
    string PriorPeriodCollections, string DepositReceipts, string InitialRentAndFeeCollections, string AdvanceCollections,
    string? OperatingPaymentsConfirmed, string? OperatingUnpaidConfirmed, string? OperatingUnknownPaymentAmount,
    string? OperatingCashFlow, string? OperatingMarginPercent, string? Depreciation, string? ProfitAfterDepreciation,
    string? InvestmentPaymentsConfirmed, string? NetCashAfterInvestment, string? CollectionRatePercent,
    IReadOnlyList<ExpenseCategoryAmount> ExpenseCategories, string? CashFlowUnavailableReason,
    string PeriodOutstanding, string? InvestmentInPeriod, string? CumulativeOperatingCashFlow, CapitalRecovery? CashCapital,
    string? OperatingCostPerRoom = null, string? CurrentOccupancyPercent = null, string? ActiveMonthlyRentPerRoom = null,
    string? AssetDisposalReceipts = null);

// Nullable values deliberately distinguish incomplete source data from a verified zero.
public sealed record FinanceManagementBasis(
    decimal ActualBusinessCollections, decimal CurrentOutstanding, decimal OverdueInvoiceOutstanding,
    decimal PriorPeriodCollections, decimal DepositReceipts, decimal InitialRentAndFeeCollections,
    decimal AdvanceCollections, decimal PeriodVerifiedCollections,
    decimal? OperatingPaymentsConfirmed = null, decimal? OperatingUnpaidConfirmed = null,
    decimal? OperatingUnknownPaymentAmount = null, bool OperatingPaymentHistoryComplete = false,
    decimal? Depreciation = null, decimal? InvestmentPaymentsConfirmed = null,
    bool InvestmentPaymentHistoryComplete = false, IReadOnlyDictionary<string, decimal>? ExpenseCategories = null,
    decimal? InvestmentInPeriod = null, decimal? CumulativeBusinessCollections = null, decimal? CumulativeOperatingPayments = null,
    decimal? ActiveMonthlyRent = null, int ActiveRentRooms = 0,
    decimal AssetDisposalReceipts = 0, decimal CumulativeAssetDisposalReceipts = 0,
    bool InvestmentBasisComplete = true);

public static class FinanceManagementMath
{
    public static FinanceManagementTotals? Calculate(FinanceBasis row, bool unknownRefunds, ReportFilter? filter = null, DateOnly? today = null)
    {
        if (row.Management is not { } data) return null;
        var revenue = row.Issued + row.Adjustments;
        var profit = revenue - row.Operating;
        decimal? cash = !unknownRefunds && data.OperatingPaymentHistoryComplete && data.OperatingPaymentsConfirmed is { } paid
            ? data.ActualBusinessCollections - paid : null;
        decimal? afterInvestment = cash is { } operating && data.InvestmentPaymentHistoryComplete &&
            data.InvestmentPaymentsConfirmed is { } investment ? operating - investment + data.AssetDisposalReceipts : null;
        decimal? cumulative = !unknownRefunds && data.OperatingPaymentHistoryComplete &&
            data.CumulativeBusinessCollections is { } received && data.CumulativeOperatingPayments is { } spent ? received - spent : null;
        string? Number(decimal? amount) => amount is { } value ? FinancialReportService.Number(value) : null;
        string Percent(decimal numerator, decimal denominator) =>
            FinancialReportService.Number(decimal.Round(numerator / denominator * 100, 2, MidpointRounding.AwayFromZero));
        return new(FinancialReportService.Number(revenue), FinancialReportService.Number(data.ActualBusinessCollections),
            FinancialReportService.Number(data.CurrentOutstanding), FinancialReportService.Number(data.OverdueInvoiceOutstanding),
            FinancialReportService.Number(data.PriorPeriodCollections), FinancialReportService.Number(data.DepositReceipts),
            FinancialReportService.Number(data.InitialRentAndFeeCollections), FinancialReportService.Number(data.AdvanceCollections),
            Number(data.OperatingPaymentsConfirmed), Number(data.OperatingUnpaidConfirmed), Number(data.OperatingUnknownPaymentAmount),
            Number(cash), revenue > 0 ? Percent(profit, revenue) : null, Number(data.Depreciation),
            data.Depreciation is { } depreciation ? Number(profit - depreciation) : null,
            Number(data.InvestmentPaymentsConfirmed), Number(afterInvestment),
            revenue > 0 ? Percent(data.PeriodVerifiedCollections, revenue) : null,
            (data.ExpenseCategories ?? new Dictionary<string, decimal>()).OrderByDescending(c => c.Value).ThenBy(c => c.Key, StringComparer.Ordinal)
                .Select(c => new ExpenseCategoryAmount(c.Key, FinancialReportService.Number(c.Value))).ToArray(),
            unknownRefunds ? "refund_classification_required" : cash is null ? "expense_payment_history_required" : null,
            FinancialReportService.Number(row.Debt), Number(data.InvestmentInPeriod), Number(cumulative),
            filter is null ? null : CashRecovery(row.Investment, cumulative + data.CumulativeAssetDisposalReceipts, cash, filter, unknownRefunds, today, data.InvestmentBasisComplete),
            row.Rooms > 0 ? Number(decimal.Round(row.Operating / row.Rooms, 0, MidpointRounding.AwayFromZero)) : null,
            row.Rooms > 0 ? Percent(row.Occupied, row.Rooms) : null,
            data.ActiveRentRooms > 0 && data.ActiveMonthlyRent is { } rent
                ? Number(decimal.Round(rent / data.ActiveRentRooms, 0, MidpointRounding.AwayFromZero)) : null,
            Number(data.AssetDisposalReceipts));
    }

    private static CapitalRecovery CashRecovery(decimal investment, decimal? cumulative, decimal? cash, ReportFilter filter, bool unknownRefunds, DateOnly? today, bool investmentComplete)
    {
        string? Number(decimal? amount) => amount is { } value ? FinancialReportService.Number(value) : null;
        var remaining = investmentComplete && cumulative is { } recovered ? Math.Max(0, investment - recovered) : (decimal?)null;
        var months = (filter.To.Year - filter.From.Year) * 12 + filter.To.Month - filter.From.Month + 1;
        var average = cash / months;
        var reason = unknownRefunds ? "refund_classification_required" :
            cumulative is null ? "expense_payment_history_required" : !investmentComplete ? "investment_basis_required" : investment <= 0 ? "initial_investment_required" :
            filter.From.Day != 1 || filter.To.Day != DateTime.DaysInMonth(filter.To.Year, filter.To.Month) || filter.To >= today ? "full_month_baseline_required" :
            remaining > 0 && (average is null || average <= 0) ? "positive_cash_flow_required" : null;
        return new(FinancialReportService.Number(investment), Number(cumulative), Number(remaining),
            investmentComplete && investment > 0 ? Number(cumulative / investment * 100) : null,
            reason is null ? Number(remaining == 0 ? 0 : remaining / average) : null, reason);
    }

    public static FinanceManagementBasis? Combine(IReadOnlyList<FinanceBasis> locations)
    {
        if (locations.Any(l => l.Management is null)) return null;
        var rows = locations.Select(l => l.Management!).ToArray();
        decimal? SumKnown(Func<FinanceManagementBasis, decimal?> select) =>
            rows.All(r => select(r).HasValue) ? rows.Sum(r => select(r)!.Value) : null;
        return new(rows.Sum(r => r.ActualBusinessCollections), rows.Sum(r => r.CurrentOutstanding),
            rows.Sum(r => r.OverdueInvoiceOutstanding), rows.Sum(r => r.PriorPeriodCollections),
            rows.Sum(r => r.DepositReceipts), rows.Sum(r => r.InitialRentAndFeeCollections),
            rows.Sum(r => r.AdvanceCollections), rows.Sum(r => r.PeriodVerifiedCollections),
            SumKnown(r => r.OperatingPaymentsConfirmed), SumKnown(r => r.OperatingUnpaidConfirmed),
            SumKnown(r => r.OperatingUnknownPaymentAmount), rows.All(r => r.OperatingPaymentHistoryComplete),
            SumKnown(r => r.Depreciation), SumKnown(r => r.InvestmentPaymentsConfirmed),
            rows.All(r => r.InvestmentPaymentHistoryComplete),
            rows.SelectMany(r => r.ExpenseCategories ?? new Dictionary<string, decimal>())
                .GroupBy(c => c.Key, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Sum(c => c.Value), StringComparer.Ordinal),
            SumKnown(r => r.InvestmentInPeriod), SumKnown(r => r.CumulativeBusinessCollections), SumKnown(r => r.CumulativeOperatingPayments),
            SumKnown(r => r.ActiveMonthlyRent), rows.Sum(r => r.ActiveRentRooms),
            rows.Sum(r => r.AssetDisposalReceipts), rows.Sum(r => r.CumulativeAssetDisposalReceipts),
            rows.All(r => r.InvestmentBasisComplete));
    }
}
