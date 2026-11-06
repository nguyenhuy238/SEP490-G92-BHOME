using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed class ExpenseRepository(BHomePersistenceContext db) : IExpenseRepository
{
    private const string Columns = """
        SELECT e.id AS "Id", e.location_id AS "LocationId", e.room_id AS "RoomId", e.expense_type AS "ExpenseType",
          e.category AS "Category", e.amount AS "Amount", e.occurred_on AS "OccurredOn", e.note AS "Note",
          jsonb_array_length(e.history) AS "Version", e.source_key AS "SourceKey",e.asset_id AS "AssetId",e.task_id AS "TaskId",
          a.name AS "AssetName",t.title AS "TaskTitle",(e.history->0->>'fingerprint') AS "Fingerprint"
        FROM expenses e LEFT JOIN assets a ON a.id=e.asset_id LEFT JOIN operational_tasks t ON t.id=e.task_id
        """;
    private IQueryable<ExpenseRow> Rows => db.Database.SqlQueryRaw<ExpenseRow>(Columns);
    public async Task<bool> ValidScopeAsync(Guid locationId, Guid? roomId, CancellationToken token) =>
        await db.Set<BHome.Domain.Locations.Location>().AnyAsync(l => l.Id == locationId, token) &&
        (roomId is null || await db.Set<BHome.Domain.PropertyManagement.Room>().AnyAsync(r => r.Id == roomId && r.LocationId == locationId, token));
    public async Task<ExpensePage> ListAsync(ExpenseFilter filter, CancellationToken token)
    {
        var query = Rows;
        if (filter.LocationId is { } location) query = query.Where(e => e.LocationId == location);
        if (filter.From is { } from) query = query.Where(e => e.OccurredOn >= from);
        if (filter.To is { } to) query = query.Where(e => e.OccurredOn <= to);
        if (filter.ExpenseType is { } type) query = query.Where(e => e.ExpenseType == type);
        if (filter.Category is { } category) query = query.Where(e => e.Category == category);
        var total = await query.LongCountAsync(token);
        var rows = await query.OrderByDescending(e => e.OccurredOn).ThenBy(e => e.Id)
            .Skip(checked((filter.Page - 1) * filter.PageSize)).Take(filter.PageSize).ToArrayAsync(token);
        return new(rows.Select(View).ToArray(), total, filter.Page, filter.PageSize);
    }
    private static ExpenseView View(ExpenseRow row) => new(row.Id, row.LocationId, row.RoomId, row.ExpenseType,
        row.Category, row.Amount, row.OccurredOn, row.Note, row.Version, row.SourceKey?.StartsWith("expense:", StringComparison.Ordinal) == true,
        row.AssetId, row.TaskId, row.AssetName, row.TaskTitle);
    public async Task<ExpenseView?> GetAsync(Guid id, CancellationToken token) =>
        await Rows.SingleOrDefaultAsync(e => e.Id == id, token) is { } row ? View(row) : null;
    public async Task<ExpenseView> CreateAsync(ExpenseInput input, Guid actor, Guid key, DateTimeOffset now, CancellationToken token)
    {
        var source = $"expense:{actor}:{key}";
        var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input)));
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({source},0))", token);
        if (await Rows.SingleOrDefaultAsync(e => e.SourceKey == source, token) is { } existing)
        {
            if (existing.Fingerprint != fingerprint) throw new FinanceException(409, "expense_idempotency_conflict");
            await tx.CommitAsync(token); return View(existing);
        }
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({input.LocationId.ToString()},0))", token);
        if (!await ValidScopeAsync(input.LocationId, input.RoomId, token) || !await ValidReferencesAsync(input, token))
            throw new FinanceException(404, "expense_reference_not_found");
        var id = Guid.NewGuid();
        var history = JsonSerializer.Serialize(new[] { new { action = "Created", actorId = actor, occurredAt = now, fingerprint, after = input } });
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO expenses(id,location_id,room_id,asset_id,task_id,incident_report_id,expense_type,category,amount,occurred_on,note,source_key,recorded_by_user_id,history)
            VALUES({id},{input.LocationId},{input.RoomId},{input.AssetId},{input.TaskId},(SELECT incident_report_id FROM operational_tasks WHERE id={input.TaskId}),{input.ExpenseType},{input.Category},{input.Amount},{input.OccurredOn},{input.Note},{source},{actor},{history}::jsonb)
            """, token);
        await tx.CommitAsync(token);
        return (await GetAsync(id, token))!;
    }
    public async Task<ExpenseView> UpdateAsync(Guid id, ExpenseUpdate input, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        // Lock before reading the version/snapshot. Keep evidence and source links untouched.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var previous = await GetAsync(id, token) ?? throw new FinanceException(404, "expense_not_found");
        if (!previous.CanEdit) throw new FinanceException(409, "expense_source_managed");
        if (previous.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        var value = input.Expense;
        if (previous.LocationId != value.LocationId || previous.RoomId != value.RoomId || previous.ExpenseType != value.ExpenseType ||
            previous.AssetId != value.AssetId || previous.TaskId != value.TaskId)
            throw new FinanceException(409, "expense_scope_immutable");
        var history = JsonSerializer.Serialize(new[] { new { action = "Updated", actorId = actor, occurredAt = now, input.Reason, before = previous, after = value } });
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE expenses SET category={value.Category}, amount={value.Amount}, occurred_on={value.OccurredOn}, note={value.Note}, history=history||{history}::jsonb WHERE id={id}
            """, token);
        await tx.CommitAsync(token);
        return previous with { Category = value.Category, Amount = value.Amount, OccurredOn = value.OccurredOn, Note = value.Note, Version = previous.Version + 1 };
    }
    private async Task<bool> ValidReferencesAsync(ExpenseInput input, CancellationToken t)
    {
        if (input.AssetId is { } asset && !await db.Set<BHome.Domain.PropertyManagement.Asset>().AnyAsync(a => a.Id == asset && a.LocationId == input.LocationId && a.RoomId == input.RoomId, t)) return false;
        if (input.TaskId is null) return true;
        return await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM operational_tasks t JOIN incident_reports i ON i.id=t.incident_report_id
              WHERE t.id={input.TaskId} AND t.task_type='WORK_ORDER' AND t.location_id={input.LocationId}
                AND t.room_id IS NOT DISTINCT FROM {input.RoomId}::uuid AND i.location_id=t.location_id
                AND (i.room_id IS NULL OR i.room_id IS NOT DISTINCT FROM t.room_id)
                AND (t.asset_id IS NULL OR t.asset_id={input.AssetId})) AS "Value"
            """).SingleAsync(t);
    }
    public async Task<ExpenseReferences> ReferencesAsync(Guid locationId, Guid? roomId, CancellationToken t)
    {
        var rooms=await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r=>r.LocationId==locationId).OrderBy(r=>r.RoomNumber)
            .Select(r=>new ExpenseReference(r.Id,r.RoomNumber,r.Id,null)).Take(501).ToArrayAsync(t);
        var assets=await db.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking().Where(a=>a.LocationId==locationId&&a.RoomId==roomId).OrderBy(a=>a.Name)
            .Select(a=>new ExpenseReference(a.Id,a.Name,a.RoomId,a.Id)).Take(501).ToArrayAsync(t);
        var tasks=await db.Database.SqlQuery<WorkOrderReferenceRow>($"""
            SELECT t.id AS "Id",COALESCE(NULLIF(t.title,''),'Work Order chưa có tên') AS "Label",t.room_id AS "RoomId",t.asset_id AS "AssetId"
            FROM operational_tasks t JOIN incident_reports i ON i.id=t.incident_report_id
            WHERE t.task_type='WORK_ORDER' AND t.location_id={locationId} AND t.room_id IS NOT DISTINCT FROM {roomId}::uuid
              AND i.location_id=t.location_id AND (i.room_id IS NULL OR i.room_id IS NOT DISTINCT FROM t.room_id)
            ORDER BY t.title,t.id LIMIT 501
            """).ToArrayAsync(t);
        return new(rooms.Take(500).ToArray(),assets.Take(500).ToArray(),tasks.Take(500).Select(w=>new ExpenseReference(w.Id,w.Label,w.RoomId,w.AssetId)).ToArray(),rooms.Length>500||assets.Length>500||tasks.Length>500);
    }
}
public sealed class WorkOrderReferenceRow
{
    public Guid Id { get; set; } public string Label { get; set; } = ""; public Guid? RoomId { get; set; } public Guid? AssetId { get; set; }
}
public sealed class ExpenseRow
{
    public Guid Id { get; set; }
    public Guid LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public string ExpenseType { get; set; } = "";
    public string Category { get; set; } = "";
    public decimal Amount { get; set; }
    public DateOnly OccurredOn { get; set; }
    public string Note { get; set; } = "";
    public int Version { get; set; }
    public string? SourceKey { get; set; }
    public string? Fingerprint { get; set; }
    public Guid? AssetId { get; set; }
    public Guid? TaskId { get; set; }
    public string? AssetName { get; set; }
    public string? TaskTitle { get; set; }
}
