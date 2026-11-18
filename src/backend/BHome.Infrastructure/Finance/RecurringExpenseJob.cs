using System.Text.Json;
using BHome.Application.Finance;
using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

// One immutable expense per rule/period. The rule's append-only versions are resolved
// as of each due date, so backfilling an old month never uses the latest edited price.
internal sealed class RecurringExpenseJob(BHomePersistenceContext db, IBackgroundJobQueue queue,
    TimeProvider clock) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "finance-recurring-expenses";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);

    public Task EnqueueDueAsync(CancellationToken token) =>
        queue.EnqueueAsync(new(Name, $"finance-recurring-expenses/{Today:yyyyMMdd}", "{}"), token);

    internal sealed record Version(RecurringExpenseRuleData Value, Guid Actor);
    private static (DateOnly Effective, Version Revision) ReadVersion(JsonElement doc)
    {
        var data = doc.GetProperty("data").Deserialize<RecurringExpenseRuleData>(Json)!;
        var actor = doc.TryGetProperty("recordedBy", out var recorded) &&
                    recorded.ValueKind == JsonValueKind.String ? recorded.GetGuid() : Guid.Empty;
        return (data.EffectiveFrom, new(data, actor));
    }
    private static IReadOnlyList<(DateOnly Effective, Version Revision)> Versions(RecurringRuleRow row)
    {
        using var history = JsonDocument.Parse(row.HistoryJson);
        var list = new List<(DateOnly Effective, Version Revision)>();
        foreach (var item in history.RootElement.EnumerateArray())
            if (item.TryGetProperty("document", out var doc) && doc.ValueKind == JsonValueKind.Object)
                list.Add(ReadVersion(doc));
        // Legacy Setup history can be absent on imported records.
        if (list.Count == 0)
        {
            using var current = JsonDocument.Parse(row.CurrentJson);
            list.Add(ReadVersion(current.RootElement));
        }
        return list.OrderBy(v => v.Effective).ToArray();
    }
    internal static IEnumerable<(DateOnly Due, Version Revision)> DuePeriods(RecurringRuleRow row, DateOnly today)
    {
        var versions = Versions(row);
        var first = versions[0].Revision.Value.StartsOn;
        var startMonth = new DateOnly(first.Year, first.Month, 1);
        var finishMonth = new DateOnly(today.Year, today.Month, 1);
        var yieldedMonths = new HashSet<(int Year, int Month)>();
        for (var month = startMonth; month <= finishMonth; month = month.AddMonths(1))
        {
            var monthOffset = (month.Year - startMonth.Year) * 12 + month.Month - startMonth.Month;
            // Calendar months are always counted from StartsOn, never from the
            // prior generated due date. Thus Jan 31 => Feb 28/29 => Mar 31,
            // quarterly Jan 31 => Apr 30, and Feb 29 yearly => Feb 28
            // in non-leap years. Existing non-anchored stored DayOfMonth values
            // are honoured as historical contracts; newly created rules use
            // StartsOn.Day. One invoice per rule/calendar period at most.
            for (var index = 0; index < versions.Count; index++)
            {
                var current = versions[index];
                var rule = current.Revision.Value;
                var cadence = rule.Frequency switch { "YEARLY" => 12, "QUARTERLY" => 3, _ => 1 };
                if (monthOffset % cadence != 0) continue;
                var day = rule.DayOfMonth is >= 1 and <= 31 ? rule.DayOfMonth : first.Day;
                var due = new DateOnly(month.Year, month.Month,
                    Math.Min(day, DateTime.DaysInMonth(month.Year, month.Month)));
                if (due < first && month == startMonth) due = first;
                var next = index + 1 < versions.Count ? versions[index + 1].Effective : DateOnly.MaxValue;
                if (due < rule.EffectiveFrom || due >= next || due > today ||
                    rule.EndsOn is { } end && due > end || !rule.Active ||
                    !yieldedMonths.Add((month.Year, month.Month)))
                    continue;
                yield return (due, current.Revision);
            }
        }
    }
    public async Task ExecuteAsync(JobExecution job, CancellationToken token)
    {
        var today = Today;
        var rows = await db.Database.SqlQuery<RecurringRuleRow>($"""
            SELECT id AS "Id",location_id AS "LocationId",
                   (task_data->'document')::text AS "CurrentJson",history::text AS "HistoryJson"
            FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupRecurringExpenseRule'
            ORDER BY id
            """).ToArrayAsync(token);
        foreach (var row in rows)
        {
            await using var tx = await db.Database.BeginTransactionAsync(token);
            // SetupWorkspaceStore.SaveAsync serializes updates on the Location advisory
            // lock. Reread the rule after obtaining that same lock so a concurrent
            // Owner change cannot generate a period from a stale policy snapshot.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({row.LocationId.ToString()},0))", token);
            var current = await db.Database.SqlQuery<RecurringRuleRow>($"""
                SELECT id AS "Id",location_id AS "LocationId",
                       (task_data->'document')::text AS "CurrentJson",history::text AS "HistoryJson"
                FROM operational_tasks
                WHERE id={row.Id} AND location_id={row.LocationId}
                  AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupRecurringExpenseRule'
                """).SingleOrDefaultAsync(token);
            if (current is null)
            {
                await tx.CommitAsync(token);
                continue;
            }
            var pending = DuePeriods(current, today).ToArray();
            if (pending.Length == 0)
            {
                await tx.CommitAsync(token);
                continue;
            }
            var lockKey = $"recurring-expense:{row.Id:N}";
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey},0))", token);
            var existing = await db.Database.SqlQuery<string>($"""
                SELECT source_key AS "Value" FROM expenses WHERE source_key LIKE {lockKey + ":%"}
                """).ToArrayAsync(token);
            var seen = existing.ToHashSet(StringComparer.Ordinal);
            foreach (var (due, revision) in pending)
            {
                var source = $"{lockKey}:{due:yyyyMM}";
                if (seen.Contains(source)) continue;
                var rule = revision.Value;
                if (revision.Actor == Guid.Empty) continue;
                var id = Guid.NewGuid();
                var history = JsonSerializer.Serialize(new[]
                {
                    new { action = "GeneratedFromRecurringRule", ruleId = row.Id,
                        actorId = revision.Actor, occurredAt = clock.GetUtcNow(),
                        period = $"{due:yyyyMM}", ruleSnapshot = rule }
                });
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO expenses(id,location_id,room_id,asset_id,task_id,incident_report_id,
                        expense_type,category,amount,occurred_on,note,source_key,recorded_by_user_id,history)
                    VALUES({id},{row.LocationId},NULL,NULL,NULL,NULL,'OPERATING','Chi phí định kỳ',
                        {rule.Amount},{due},{rule.Name},{source},{revision.Actor},{history}::jsonb)
                    """, token);
                seen.Add(source);
            }
            await tx.CommitAsync(token);
        }
    }
}

public sealed class RecurringRuleRow
{
    public Guid Id { get; set; }
    public Guid LocationId { get; set; }
    public string CurrentJson { get; set; } = "";
    public string HistoryJson { get; set; } = "[]";
}
