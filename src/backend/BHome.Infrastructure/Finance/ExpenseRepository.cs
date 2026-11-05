using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed class ExpenseRepository(Compact24DbContext db) : IExpenseRepository
{
    private const string Columns = """
        SELECT id AS "Id", location_id AS "LocationId", room_id AS "RoomId", expense_type AS "ExpenseType",
          category AS "Category", amount AS "Amount", occurred_on AS "OccurredOn", note AS "Note",
          jsonb_array_length(history) AS "Version", source_key AS "SourceKey",
          (history->0->>'fingerprint') AS "Fingerprint" FROM expenses
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
        row.Category, row.Amount, row.OccurredOn, row.Note, row.Version, row.SourceKey?.StartsWith("expense:", StringComparison.Ordinal) == true);
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
        var id = Guid.NewGuid();
        var history = JsonSerializer.Serialize(new[] { new { action = "Created", actorId = actor, occurredAt = now, fingerprint, after = input } });
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO expenses(id,location_id,room_id,expense_type,category,amount,occurred_on,note,source_key,recorded_by_user_id,history)
            VALUES({id},{input.LocationId},{input.RoomId},{input.ExpenseType},{input.Category},{input.Amount},{input.OccurredOn},{input.Note},{source},{actor},{history}::jsonb)
            """, token);
        await tx.CommitAsync(token);
        return new(id, input.LocationId, input.RoomId, input.ExpenseType, input.Category, input.Amount, input.OccurredOn, input.Note, 1, true);
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
        if (previous.LocationId != value.LocationId || previous.RoomId != value.RoomId || previous.ExpenseType != value.ExpenseType)
            throw new FinanceException(409, "expense_scope_immutable");
        var history = JsonSerializer.Serialize(new[] { new { action = "Updated", actorId = actor, occurredAt = now, input.Reason, before = previous, after = value } });
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE expenses SET category={value.Category}, amount={value.Amount}, occurred_on={value.OccurredOn}, note={value.Note}, history=history||{history}::jsonb WHERE id={id}
            """, token);
        await tx.CommitAsync(token);
        return previous with { Category = value.Category, Amount = value.Amount, OccurredOn = value.OccurredOn, Note = value.Note, Version = previous.Version + 1 };
    }
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
}
