using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Finance;

public sealed class ExpenseRepository(BHomePersistenceContext db) : IExpenseRepository
{
    private Compact24DbContext Context => (Compact24DbContext)db;

    private static IQueryable<ExpenseView> Views(Compact24DbContext compact, IQueryable<Native.Expense> expenses) =>
        from expense in expenses
        join asset in compact.Set<Native.Asset>().AsNoTracking() on expense.AssetId equals asset.Id into assets
        from asset in assets.DefaultIfEmpty()
        join task in compact.Set<Native.OperationalTask>().AsNoTracking() on expense.TaskId equals task.Id into tasks
        from task in tasks.DefaultIfEmpty()
        select new ExpenseView(expense.Id, expense.LocationId, expense.RoomId, expense.ExpenseType, expense.Category,
            expense.Amount, expense.OccurredOn, expense.Note, expense.History.GetArrayLength(),
            expense.SourceKey != null && expense.SourceKey.StartsWith("expense:"), expense.AssetId, expense.TaskId,
            asset == null ? null : asset.Name, task == null ? null : task.Title);

    public async Task<bool> ValidScopeAsync(Guid locationId, Guid? roomId, CancellationToken token)
    {
        var compact = Context;
        return await compact.Set<Native.Location>().AsNoTracking().AnyAsync(l => l.Id == locationId, token) &&
            (roomId is null || await compact.Set<Native.Room>().AsNoTracking().AnyAsync(r => r.Id == roomId && r.LocationId == locationId, token));
    }

    public async Task<ExpensePage> ListAsync(ExpenseFilter filter, CancellationToken token)
    {
        await using var snapshot = filter.IncludeTotalAmount
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, token) : null;
        var compact = Context;
        var query = compact.Set<Native.Expense>().AsNoTracking();
        if (filter.LocationId is { } location) query = query.Where(e => e.LocationId == location);
        if (filter.RoomId is { } room) query = query.Where(e => e.RoomId == room);
        if (filter.From is { } from) query = query.Where(e => e.OccurredOn >= from);
        if (filter.To is { } to) query = query.Where(e => e.OccurredOn <= to);
        if (filter.ExpenseType is { } type) query = query.Where(e => e.ExpenseType == type);
        if (filter.Category is { } category) query = query.Where(e => e.Category == category);
        // Include older manual investments; exclude linked asset/task and capital-sync events.
        if (filter.OnlyOtherInvestments)
            query = query.Where(e => e.AssetId == null && e.TaskId == null &&
                (e.SourceKey == null || !e.SourceKey.StartsWith("asset-capital:")));
        var total = await query.LongCountAsync(token);
        var page = query.OrderByDescending(e => e.OccurredOn).ThenBy(e => e.Id)
            .Skip(checked((filter.Page - 1) * filter.PageSize)).Take(filter.PageSize);
        var rows = await Views(compact, page).ToArrayAsync(token);
        var totalAmount = filter.IncludeTotalAmount
            ? (await query.SumAsync(e => e.Amount, token)).ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture) : null;
        if (snapshot is not null) await snapshot.CommitAsync(token);
        return new(rows, total, filter.Page, filter.PageSize, totalAmount);
    }

    private static Task<ExpenseView?> GetAsync(Compact24DbContext compact, Guid id, CancellationToken token) =>
        Views(compact, compact.Set<Native.Expense>().AsNoTracking().Where(e => e.Id == id)).SingleOrDefaultAsync(token);

    public async Task<ExpenseView?> GetAsync(Guid id, CancellationToken token)
    {
        var compact = Context;
        return await GetAsync(compact, id, token);
    }

    private static string? Fingerprint(Native.Expense expense) =>
        expense.History.GetArrayLength() > 0 && expense.History[0].ValueKind == JsonValueKind.Object &&
        expense.History[0].TryGetProperty("fingerprint", out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static Native.Expense NewExpense(ExpenseInput input, Guid actor, string source, string fingerprint,
        DateTimeOffset now, Guid? incidentId) => new()
        {
            Id = Guid.NewGuid(),
            LocationId = input.LocationId,
            RoomId = input.RoomId,
            AssetId = input.AssetId,
            TaskId = input.TaskId,
            IncidentReportId = incidentId,
            ExpenseType = input.ExpenseType,
            Category = input.Category,
            Amount = input.Amount,
            OccurredOn = input.OccurredOn,
            Note = input.Note,
            SourceKey = source,
            RecordedByUserId = actor,
            Evidence = JsonSerializer.SerializeToElement(Array.Empty<object>()),
            History = JsonSerializer.SerializeToElement(new[] { new { action = "Created", actorId = actor, occurredAt = now, fingerprint, after = input } })
        };

    public async Task<ExpenseView> CreateAsync(ExpenseInput input, Guid actor, Guid key, DateTimeOffset now, CancellationToken token)
    {
        var source = $"expense:{actor}:{key}";
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input)));
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({source},0))", token);
        var compact = Context;
        if (await compact.Set<Native.Expense>().AsNoTracking().SingleOrDefaultAsync(e => e.SourceKey == source, token) is { } existing)
        {
            if (Fingerprint(existing) != fingerprint) throw new FinanceException(409, "expense_idempotency_conflict");
            var replay = (await GetAsync(compact, existing.Id, token))!;
            await tx.CommitAsync(token);
            return replay;
        }
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({input.LocationId.ToString()},0))", token);
        if (!await ValidScopeAsync(input.LocationId, input.RoomId, token) || !await ValidReferencesAsync(compact, input, token))
            throw new FinanceException(404, "expense_reference_not_found");
        var incidentId = await compact.Set<Native.OperationalTask>().AsNoTracking().Where(t => t.Id == input.TaskId)
            .Select(t => t.IncidentReportId).SingleOrDefaultAsync(token);
        var expense = NewExpense(input, actor, source, fingerprint, now, incidentId);
        compact.Add(expense);
        await compact.SaveChangesAsync(token);
        await tx.CommitAsync(token);
        return (await GetAsync(expense.Id, token))!;
    }

    public async Task<IReadOnlyList<ExpenseView>> CreateInvestmentsAsync(IReadOnlyList<ExpenseInput> items,
        Guid actor, Guid key, DateTimeOffset now, CancellationToken token)
    {
        var prefix = $"expense:batch:{actor}:{key}:";
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(items)));
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({prefix},0))", token);
        var compact = Context;
        var existing = await compact.Set<Native.Expense>().AsNoTracking().Where(e => e.SourceKey != null && e.SourceKey.StartsWith(prefix))
            .OrderBy(e => e.SourceKey).ToArrayAsync(token);
        if (existing.Length != 0)
        {
            if (existing.Length != items.Count || existing.Any(row => Fingerprint(row) != fingerprint))
                throw new FinanceException(409, "expense_idempotency_conflict");
            var replay = await BatchViewsAsync(compact, existing.Select(e => e.Id).ToArray(), token);
            await tx.CommitAsync(token);
            return replay;
        }
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({items[0].LocationId.ToString()},0))", token);
        if (!await ValidScopeAsync(items[0].LocationId, null, token))
            throw new FinanceException(404, "expense_scope_not_found");
        var results = new List<Guid>(items.Count);
        for (var i = 0; i < items.Count; ++i)
        {
            var item = items[i];
            var source = prefix + i.ToString("D4", System.Globalization.CultureInfo.InvariantCulture);
            var expense = NewExpense(item, actor, source, fingerprint, now, null);
            // The service always supplies initial investments without room, asset or task links.
            expense.ExpenseType = "INITIAL_INVESTMENT";
            expense.RoomId = null;
            expense.AssetId = null;
            expense.TaskId = null;
            compact.Add(expense);
            results.Add(expense.Id);
        }
        await compact.SaveChangesAsync(token);
        await tx.CommitAsync(token);
        return await BatchViewsAsync(compact, results.ToArray(), token);
    }

    private static async Task<ExpenseView[]> BatchViewsAsync(Compact24DbContext compact, Guid[] ids, CancellationToken token)
    {
        var rows = await Views(compact, compact.Set<Native.Expense>().AsNoTracking().Where(e => ids.Contains(e.Id))).ToArrayAsync(token);
        var byId = rows.ToDictionary(e => e.Id);
        return ids.Select(id => byId[id]).ToArray();
    }

    public async Task<ExpenseView> UpdateAsync(Guid id, ExpenseUpdate input, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        // Lock before reading the version/snapshot. Keep evidence and source links untouched.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var compact = Context;
        var previous = await GetAsync(compact, id, token) ?? throw new FinanceException(404, "expense_not_found");
        if (!previous.CanEdit) throw new FinanceException(409, "expense_source_managed");
        if (previous.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        var expense = await compact.Set<Native.Expense>().AsNoTracking().SingleAsync(e => e.Id == id, token);
        if (expense.History.EnumerateArray().Any(h => h.ValueKind == JsonValueKind.Object &&
            h.TryGetProperty("recordType", out var type) && type.ValueKind == JsonValueKind.String &&
            type.GetString() is "ExpensePaymentV1" or "DepreciationPlanV1"))
            throw new FinanceException(409, "expense_payment_history_locked");
        var value = input.Expense;
        // Preserve the existing PostgreSQL conversion/ordering for historical due-date entries.
        var dueDate = await db.Database.SqlQuery<DateOnly?>($"""
            SELECT (SELECT (h->'state'->'input'->>'dueOn')::date
              FROM jsonb_array_elements(history) WITH ORDINALITY e(h,n)
              WHERE h->>'recordType'='ExpenseDueDateV1' ORDER BY n DESC LIMIT 1) AS "Value"
            FROM expenses WHERE id={id}
            """).SingleAsync(token);
        if (dueDate is { } due && value.OccurredOn > due)
            throw new FinanceException(400, "invalid_expense_due_date");
        if (previous.LocationId != value.LocationId || previous.RoomId != value.RoomId || previous.ExpenseType != value.ExpenseType ||
            previous.AssetId != value.AssetId || previous.TaskId != value.TaskId)
            throw new FinanceException(409, "expense_scope_immutable");
        var entry = JsonSerializer.SerializeToElement(new { action = "Updated", actorId = actor, occurredAt = now, input.Reason, before = previous, after = value });
        var history = JsonSerializer.SerializeToElement(expense.History.EnumerateArray().Append(entry));
        compact.Attach(expense);
        expense.Category = value.Category;
        expense.Amount = value.Amount;
        expense.OccurredOn = value.OccurredOn;
        expense.Note = value.Note;
        expense.History = history;
        await compact.SaveChangesAsync(token);
        await tx.CommitAsync(token);
        return previous with { Category = value.Category, Amount = value.Amount, OccurredOn = value.OccurredOn, Note = value.Note, Version = previous.Version + 1 };
    }

    private static async Task<bool> ValidReferencesAsync(Compact24DbContext compact, ExpenseInput input, CancellationToken t)
    {
        if (input.AssetId is { } asset && !await compact.Set<Native.Asset>().AsNoTracking().AnyAsync(a => a.Id == asset && a.LocationId == input.LocationId && a.RoomId == input.RoomId, t)) return false;
        if (input.TaskId is null) return true;
        return await (from task in compact.Set<Native.OperationalTask>().AsNoTracking()
                      join incident in compact.Set<Native.IncidentReport>().AsNoTracking() on task.IncidentReportId equals incident.Id
                      where task.Id == input.TaskId && task.TaskType == "WORK_ORDER" && task.LocationId == input.LocationId &&
                            task.RoomId == input.RoomId && incident.LocationId == task.LocationId &&
                            (incident.RoomId == null || incident.RoomId == task.RoomId) &&
                            (task.AssetId == null || task.AssetId == input.AssetId)
                      select task.Id).AnyAsync(t);
    }

    public async Task<ExpenseReferences> ReferencesAsync(Guid locationId, Guid? roomId, CancellationToken t)
    {
        var compact = Context;
        var rooms = await compact.Set<Native.Room>().AsNoTracking().Where(r => r.LocationId == locationId).OrderBy(r => r.RoomNumber)
            .Select(r => new ExpenseReference(r.Id, r.RoomNumber, r.Id, null)).Take(501).ToArrayAsync(t);
        var assets = await compact.Set<Native.Asset>().AsNoTracking().Where(a => a.LocationId == locationId && a.RoomId == roomId).OrderBy(a => a.Name)
            .Select(a => new ExpenseReference(a.Id, a.Name, a.RoomId, a.Id)).Take(501).ToArrayAsync(t);
        var tasks = await (from task in compact.Set<Native.OperationalTask>().AsNoTracking()
                           join incident in compact.Set<Native.IncidentReport>().AsNoTracking() on task.IncidentReportId equals incident.Id
                           where task.TaskType == "WORK_ORDER" && task.LocationId == locationId && task.RoomId == roomId &&
                                 incident.LocationId == task.LocationId && (incident.RoomId == null || incident.RoomId == task.RoomId)
                           orderby task.Title, task.Id
                           select new ExpenseReference(task.Id, task.Title == null || task.Title == "" ? "Work Order chưa có tên" : task.Title,
                               task.RoomId, task.AssetId)).Take(501).ToArrayAsync(t);
        return new(rooms.Take(500).ToArray(), assets.Take(500).ToArray(), tasks.Take(500).ToArray(), rooms.Length > 500 || assets.Length > 500 || tasks.Length > 500);
    }
}
