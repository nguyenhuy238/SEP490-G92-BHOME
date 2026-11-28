namespace BHome.Application.Finance;

public sealed record FinanceChange(string Current, string Previous, string Change, string? ChangePercent);
public sealed record FinanceCategoryChange(string Category, string Current, string Previous, string Change, string? ChangePercent);
public sealed record FinanceComparison(DateOnly CurrentFrom, DateOnly CurrentTo, DateOnly PreviousFrom, DateOnly PreviousTo,
    FinanceChange Revenue, FinanceChange OperatingExpenses, FinanceChange OperatingProfit, IReadOnlyList<FinanceCategoryChange> ExpenseCategories);

public static class FinanceComparisonMath
{
    public static (ReportFilter Current, ReportFilter Previous)? Periods(ReportFilter filter, DateOnly today)
    {
        if (filter.From > today) return null;
        var current = filter with { To = filter.To < today ? filter.To : today, IncludeComparison = false };
        var wholeMonths = filter.From.Day == 1 && filter.To.Day == DateTime.DaysInMonth(filter.To.Year, filter.To.Month);
        var months = (filter.To.Year - filter.From.Year) * 12 + filter.To.Month - filter.From.Month + 1;
        if (wholeMonths || filter.From.Day == 1 && filter.To == today && months == 1)
        {
            if ((filter.From.Year - 1) * 12 + filter.From.Month - 1 < months) return null;
            var previousFrom = filter.From.AddMonths(-months);
            var previousEnd = filter.From.AddDays(-1);
            var previousTo = wholeMonths && current.To == filter.To ? previousEnd :
                previousFrom.AddDays(Math.Min(current.To.DayNumber - current.From.DayNumber, previousEnd.DayNumber - previousFrom.DayNumber));
            return (current, current with { From = previousFrom, To = previousTo });
        }
        var length = current.To.DayNumber - current.From.DayNumber + 1;
        if (current.From.DayNumber < length) return null;
        return (current, current with { From = current.From.AddDays(-length), To = current.From.AddDays(-1) });
    }

    public static FinanceComparison Calculate(ReportFilter currentFilter, ReportFilter previousFilter,
        IReadOnlyList<FinanceBasis> current, IReadOnlyList<FinanceBasis> previous)
    {
        static FinanceChange Change(decimal now, decimal before) => new(FinancialReportService.Number(now),
            FinancialReportService.Number(before), FinancialReportService.Number(now - before),
            before == 0 ? null : FinancialReportService.Number(decimal.Round((now - before) / Math.Abs(before) * 100, 2, MidpointRounding.AwayFromZero)));
        static Dictionary<string, decimal> Categories(IReadOnlyList<FinanceBasis> rows) =>
            rows.SelectMany(r => r.Management?.ExpenseCategories ?? new Dictionary<string, decimal>())
                .GroupBy(c => c.Key, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Sum(c => c.Value), StringComparer.Ordinal);
        var currentCategories = Categories(current);
        var previousCategories = Categories(previous);
        var categories = currentCategories.Keys.Union(previousCategories.Keys, StringComparer.Ordinal).Select(category =>
        {
            var change = Change(currentCategories.GetValueOrDefault(category), previousCategories.GetValueOrDefault(category));
            return new FinanceCategoryChange(category, change.Current, change.Previous, change.Change, change.ChangePercent);
        }).OrderByDescending(c => Math.Abs(decimal.Parse(c.Change, System.Globalization.CultureInfo.InvariantCulture)))
            .ThenBy(c => c.Category, StringComparer.Ordinal).ToArray();
        var revenue = current.Sum(r => r.Issued + r.Adjustments);
        var previousRevenue = previous.Sum(r => r.Issued + r.Adjustments);
        var expenses = current.Sum(r => r.Operating);
        var previousExpenses = previous.Sum(r => r.Operating);
        return new(currentFilter.From, currentFilter.To, previousFilter.From, previousFilter.To,
            Change(revenue, previousRevenue), Change(expenses, previousExpenses),
            Change(revenue - expenses, previousRevenue - previousExpenses), categories);
    }
}
