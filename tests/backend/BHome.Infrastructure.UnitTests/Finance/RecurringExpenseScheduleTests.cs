using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Finance;

namespace BHome.Infrastructure.UnitTests.Finance;

public sealed class RecurringExpenseScheduleTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static RecurringRuleRow Rule(params RecurringExpenseRuleData[] revisions)
    {
        var actor = Guid.NewGuid();
        var id = Guid.NewGuid();
        var history = revisions.Select((data, i) => new
        {
            actorId = actor,
            document = new
            {
                id,
                locationId = Guid.NewGuid(),
                kind = "RecurringExpenseRule",
                status = data.Active ? "Active" : "Inactive",
                version = i + 1,
                data,
                recordedBy = actor
            }
        }).ToArray();
        return new()
        {
            Id = id,
            LocationId = Guid.NewGuid(),
            HistoryJson = JsonSerializer.Serialize(history, Json),
            CurrentJson = JsonSerializer.Serialize(history[^1].document, Json)
        };
    }

    [Fact]
    public void MissedPeriodsUseTimeEffectivePricesAndClampDayOfMonth()
    {
        var rule = Rule(
            new("Phí", 100_000, "MONTHLY", 31, new(2026, 1, 1), null, true, new(2026, 1, 1)),
            new("Phí", 200_000, "MONTHLY", 15, new(2026, 1, 1), null, true, new(2026, 3, 10)));
        var due = RecurringExpenseJob.DuePeriods(rule, new DateOnly(2026, 4, 30)).ToArray();
        Assert.Equal(new[]
        {
            new DateOnly(2026, 1, 31), new DateOnly(2026, 2, 28),
            new DateOnly(2026, 3, 15), new DateOnly(2026, 4, 15)
        }, due.Select(e => e.Due));
        Assert.Equal(new[] { 100_000m, 100_000m, 200_000m, 200_000m },
            due.Select(e => e.Revision.Value.Amount));
        Assert.All(due, e => Assert.NotEqual(Guid.Empty, e.Revision.Actor));
    }

    [Fact]
    public void FromYearlyToMonthlyAndInactive_HistoryDoesNotRepricePast()
    {
        var rule = Rule(
            new("An ninh", 900_000, "YEARLY", 10, new(2026, 1, 1), null, true, new(2026, 1, 1)),
            new("An ninh", 100_000, "MONTHLY", 10, new(2026, 1, 1), null, true, new(2026, 4, 1)),
            new("An ninh", 100_000, "MONTHLY", 10, new(2026, 1, 1), null, false, new(2026, 6, 1)));
        var due = RecurringExpenseJob.DuePeriods(rule, new DateOnly(2026, 8, 31)).ToArray();
        Assert.Equal(new[]
        {
            new DateOnly(2026, 1, 10), new DateOnly(2026, 4, 10),
            new DateOnly(2026, 5, 10)
        }, due.Select(e => e.Due));
        Assert.Equal(new[] { 900_000m, 100_000m, 100_000m },
            due.Select(e => e.Revision.Value.Amount));
    }

    [Fact]
    public void Monthly_StartDateAnchorsEveryMonth_ClampsShortMonthsWithoutDrifting()
    {
        var rule = Rule(new RecurringExpenseRuleData("Internet", 150_000, "MONTHLY", 31,
            new(2026, 1, 31), null, true, new(2026, 1, 31)));
        var due = RecurringExpenseJob.DuePeriods(rule, new(2026, 5, 30)).ToArray();
        Assert.Equal(new[]
        {
            new DateOnly(2026, 1, 31), new DateOnly(2026, 2, 28),
            new DateOnly(2026, 3, 31), new DateOnly(2026, 4, 30)
        }, due.Select(period => period.Due));
        Assert.All(due, period => Assert.Equal(150_000m, period.Revision.Value.Amount));
    }

    [Fact]
    public void Quarterly_StartDateAnchorsEveryThirdMonth_AndEndsOnIsInclusive()
    {
        var rule = Rule(new RecurringExpenseRuleData("Vệ sinh", 240_000, "QUARTERLY", 31,
            new(2025, 10, 31), new(2026, 7, 30), true, new(2025, 10, 31)));
        var due = RecurringExpenseJob.DuePeriods(rule, new(2026, 12, 31)).Select(e => e.Due).ToArray();
        Assert.Equal(new[]
        {
            new DateOnly(2025, 10, 31), new DateOnly(2026, 1, 31),
            new DateOnly(2026, 4, 30)
        }, due);
    }

    [Fact]
    public void Yearly_February29Start_UsesFeb28ExceptInLeapYears()
    {
        var rule = Rule(new RecurringExpenseRuleData("Kiểm định", 600_000, "YEARLY", 29,
            new(2024, 2, 29), null, true, new(2024, 2, 29)));
        var due = RecurringExpenseJob.DuePeriods(rule, new(2028, 2, 29)).Select(e => e.Due).ToArray();
        Assert.Equal(new[]
        {
            new DateOnly(2024, 2, 29), new DateOnly(2025, 2, 28),
            new DateOnly(2026, 2, 28), new DateOnly(2027, 2, 28),
            new DateOnly(2028, 2, 29)
        }, due);
    }

    [Fact]
    public void PriceEditedAfterDue_DoesNotRetroactivelyAlterBackfilledMissedPeriods()
    {
        var rule = Rule(
            new("Phí trông xe", 100_000, "MONTHLY", 15,
                new(2026, 1, 15), null, true, new(2026, 1, 15)),
            new("Phí trông xe", 180_000, "MONTHLY", 15,
                new(2026, 1, 15), null, true, new(2026, 3, 20)));
        var due = RecurringExpenseJob.DuePeriods(rule, new(2026, 5, 14)).ToArray();
        Assert.Equal(new[] { 100_000m, 100_000m, 100_000m, 180_000m },
            due.Select(e => e.Revision.Value.Amount));
        Assert.Equal(new[]
        {
            new DateOnly(2026, 1, 15), new DateOnly(2026, 2, 15),
            new DateOnly(2026, 3, 15), new DateOnly(2026, 4, 15)
        }, due.Select(e => e.Due));
    }

    [Fact]
    public void LegacyDifferentDayRemainsUnchanged_AndMissingDayDefaultsToStartDay()
    {
        var legacy = Rule(new RecurringExpenseRuleData("Cũ", 100_000, "MONTHLY", 31,
            new(2026, 1, 1), null, true, new(2026, 1, 1)));
        Assert.Equal(new[] { new DateOnly(2026, 1, 31), new DateOnly(2026, 2, 28) },
            RecurringExpenseJob.DuePeriods(legacy, new(2026, 2, 28)).Select(e => e.Due));
        var imported = Rule(new RecurringExpenseRuleData("Thiếu dayOfMonth", 100_000, "MONTHLY", 0,
            new(2026, 1, 15), null, true, new(2026, 1, 15)));
        Assert.Equal(new[] { new DateOnly(2026, 1, 15), new DateOnly(2026, 2, 15) },
            RecurringExpenseJob.DuePeriods(imported, new(2026, 2, 15)).Select(e => e.Due));
    }
}
