using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record ExpensePaymentInput(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly? PaidOn, int ExpectedVersion, string Note);
public sealed record ExpensePaymentEvent(Guid Key, Guid ActorId, DateTimeOffset RecordedAt,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly? PaidOn, string Note);
public sealed record ExpenseDueDateInput(DateOnly? DueOn, int ExpectedVersion, string Note);
public sealed record ExpenseDueDateEvent(Guid Key, Guid ActorId, DateTimeOffset RecordedAt, ExpenseDueDateInput Input);
public sealed record ExpensePaymentView(Guid ExpenseId, int Version,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PaidAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? RemainingAmount,
    string Status, IReadOnlyList<ExpensePaymentEvent> Events, DateOnly? DueOn = null,
    IReadOnlyList<ExpenseDueDateEvent>? DueHistory = null, string DueStatus = "Unknown");

public interface IExpensePaymentRepository
{
    Task<ExpensePaymentView?> ReadAsync(Guid id, CancellationToken token);
    Task<ExpensePaymentView> RecordAsync(Guid id, ExpensePaymentInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token);
    Task<ExpensePaymentView> SetDueDateAsync(Guid id, ExpenseDueDateInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token);
}

public sealed class ExpensePaymentService(IExpensePaymentRepository repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        return id;
    }

    public async Task<ExpensePaymentView> ReadAsync(Guid id, CancellationToken token)
    {
        _ = Owner();
        return WithDueStatus(await repository.ReadAsync(id, token) ?? throw new FinanceException(404, "expense_not_found"));
    }

    private ExpensePaymentView WithDueStatus(ExpensePaymentView view)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        return view with
        {
            DueStatus = view.Status is "Unknown" or "Paid" ? view.Status :
            view.DueOn is not { } due ? "Unknown" : due < today ? "Overdue" : due == today ? "DueToday" : "NotDue"
        };
    }

    public async Task<ExpensePaymentView> SetDueDateAsync(Guid id, ExpenseDueDateInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty || input.ExpectedVersion < 0 || input.DueOn == default(DateOnly) ||
            string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 1000)
            throw new FinanceException(400, "invalid_expense_due_date");
        return WithDueStatus(await repository.SetDueDateAsync(id, input, key, actor, clock.GetUtcNow(), token));
    }

    public async Task<ExpensePaymentView> RecordAsync(Guid id, ExpensePaymentInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        if (input.Amount < 0 || input.Amount >= 1_000_000_000_000_000_000m || decimal.Truncate(input.Amount) != input.Amount ||
            (input.Amount == 0 ? input.PaidOn is not null : input.PaidOn is null || input.PaidOn == default(DateOnly) || input.PaidOn > today) ||
            input.ExpectedVersion < 0 || string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 1000)
            throw new FinanceException(400, "invalid_expense_payment");
        return WithDueStatus(await repository.RecordAsync(id, input, key, actor, now, token));
    }
}
