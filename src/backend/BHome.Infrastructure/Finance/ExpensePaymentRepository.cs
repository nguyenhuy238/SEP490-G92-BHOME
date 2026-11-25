using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed class ExpensePaymentRepository(BHomePersistenceContext db) : IExpensePaymentRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ExpensePaymentView?> ReadAsync(Guid id, CancellationToken token)
    {
        var row = await db.Database.SqlQuery<ExpensePaymentRow>($"""
            SELECT id AS "Id", amount AS "Amount", jsonb_array_length(history) AS "Version", occurred_on AS "OccurredOn",
              CASE WHEN source_key LIKE 'recurring-expense:%' THEN occurred_on ELSE NULL END AS "RecurringDueOn",
              COALESCE((SELECT jsonb_agg(h->'state' ORDER BY n) FROM jsonb_array_elements(history) WITH ORDINALITY e(h,n)
                WHERE h->>'recordType'='ExpenseDueDateV1'),'[]'::jsonb)::text AS "DueHistory",
              COALESCE((SELECT jsonb_agg(h->'state' ORDER BY n) FROM jsonb_array_elements(history) WITH ORDINALITY e(h,n)
                WHERE h->>'recordType'='ExpensePaymentV1'),'[]'::jsonb)::text AS "Events"
            FROM expenses WHERE id={id}
            """).SingleOrDefaultAsync(token);
        if (row is null) return null;
        var events = JsonSerializer.Deserialize<ExpensePaymentEvent[]>(row.Events, Json) ?? [];
        var dueHistory = JsonSerializer.Deserialize<ExpenseDueDateEvent[]>(row.DueHistory, Json) ?? [];
        var paid = events.Sum(e => e.Amount);
        if (events.Any(e => e.Amount < 0 || e.Amount > 0 && e.PaidOn is null) || paid > row.Amount)
            throw new FinanceException(409, "expense_payment_history_requires_review");
        return new(id, row.Version, row.Amount, events.Length == 0 ? null : paid,
            events.Length == 0 ? null : row.Amount - paid,
            events.Length == 0 ? "Unknown" : paid == row.Amount ? "Paid" : paid == 0 ? "Unpaid" : "PartiallyPaid", events,
            dueHistory.Length == 0 ? row.RecurringDueOn : dueHistory[^1].Input.DueOn, dueHistory);
    }

    public async Task<ExpensePaymentView> RecordAsync(Guid id, ExpensePaymentInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var previous = await ReadAsync(id, token) ?? throw new FinanceException(404, "expense_not_found");
        if (previous.Events.SingleOrDefault(e => e.Key == key) is { } replay)
        {
            if (replay.ActorId != actor || replay.Amount != input.Amount || replay.PaidOn != input.PaidOn || replay.Note != input.Note)
                throw new FinanceException(409, "expense_idempotency_conflict");
            await transaction.CommitAsync(token);
            return previous;
        }
        if (previous.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        if (input.Amount == 0 && previous.Events.Count != 0 || input.Amount > previous.Amount - (previous.PaidAmount ?? 0))
            throw new FinanceException(409, "expense_payment_exceeds_balance");
        var payment = new ExpensePaymentEvent(key, actor, now, input.Amount, input.PaidOn, input.Note);
        var history = JsonSerializer.Serialize(new[] { new { schemaVersion = 1, recordType = "ExpensePaymentV1", state = payment } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE expenses SET history=history||{history}::jsonb WHERE id={id}", token);
        var result = (await ReadAsync(id, token))!;
        await transaction.CommitAsync(token);
        return result;
    }

    public async Task<ExpensePaymentView> SetDueDateAsync(Guid id, ExpenseDueDateInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", token);
        var previous = await ReadAsync(id, token) ?? throw new FinanceException(404, "expense_not_found");
        if (previous.DueHistory?.SingleOrDefault(e => e.Key == key) is { } replay)
        {
            if (replay.ActorId != actor || replay.Input != input)
                throw new FinanceException(409, "expense_idempotency_conflict");
            await transaction.CommitAsync(token);
            return previous;
        }
        if (previous.Version != input.ExpectedVersion) throw new FinanceException(409, "expense_version_changed");
        var occurred = await db.Database.SqlQuery<DateOnly>($"SELECT occurred_on AS \"Value\" FROM expenses WHERE id={id}").SingleAsync(token);
        if (input.DueOn is { } due && due < occurred)
            throw new FinanceException(400, "invalid_expense_due_date");
        var revision = new ExpenseDueDateEvent(key, actor, now, input);
        var history = JsonSerializer.Serialize(new[] { new { schemaVersion = 1, recordType = "ExpenseDueDateV1", state = revision } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE expenses SET history=history||{history}::jsonb WHERE id={id}", token);
        var result = (await ReadAsync(id, token))!;
        await transaction.CommitAsync(token);
        return result;
    }
}

public sealed class ExpensePaymentRow
{
    public Guid Id { get; set; }
    public decimal Amount { get; set; }
    public int Version { get; set; }
    public string Events { get; set; } = "[]";
    public DateOnly OccurredOn { get; set; }
    public DateOnly? RecurringDueOn { get; set; }
    public string DueHistory { get; set; } = "[]";
}
