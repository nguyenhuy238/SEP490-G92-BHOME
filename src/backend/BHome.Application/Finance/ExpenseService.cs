using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed class FinanceException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
public sealed record ExpenseInput(Guid LocationId, Guid? RoomId, string ExpenseType, string Category,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly OccurredOn, string Note,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? AssetId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? TaskId = null);
public sealed record ExpenseUpdate(ExpenseInput Expense, int ExpectedVersion, string Reason);
public sealed record ExpenseFilter(Guid? LocationId = null, DateOnly? From = null, DateOnly? To = null,
    string? ExpenseType = null, string? Category = null, int Page = 1, int PageSize = 25);
public sealed record ExpenseView(Guid Id, Guid LocationId, Guid? RoomId, string ExpenseType, string Category,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    DateOnly OccurredOn, string Note, int Version, bool CanEdit, Guid? AssetId = null, Guid? TaskId = null,
    string? AssetName = null, string? TaskTitle = null);
public sealed record ExpensePage(IReadOnlyList<ExpenseView> Items, long Total, int Page, int PageSize);
public sealed record ExpenseReference(Guid Id, string Label, Guid? RoomId = null, Guid? AssetId = null);
public sealed record ExpenseReferences(IReadOnlyList<ExpenseReference> Rooms, IReadOnlyList<ExpenseReference> Assets,
    IReadOnlyList<ExpenseReference> WorkOrders, bool Truncated);
public interface IExpenseRepository
{
    Task<bool> ValidScopeAsync(Guid locationId, Guid? roomId, CancellationToken token);
    Task<ExpensePage> ListAsync(ExpenseFilter filter, CancellationToken token);
    Task<ExpenseView?> GetAsync(Guid id, CancellationToken token);
    Task<ExpenseView> CreateAsync(ExpenseInput input, Guid actor, Guid key, DateTimeOffset now, CancellationToken token);
    Task<ExpenseView> UpdateAsync(Guid id, ExpenseUpdate input, Guid actor, DateTimeOffset now, CancellationToken token);
    Task<ExpenseReferences> ReferencesAsync(Guid locationId, Guid? roomId, CancellationToken token);
}
public sealed class ExpenseService(IExpenseRepository repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        return id;
    }
    private async Task ValidateAsync(ExpenseInput input, CancellationToken token)
    {
        if (input.LocationId == Guid.Empty || input.RoomId == Guid.Empty || input.AssetId == Guid.Empty || input.TaskId == Guid.Empty ||
            input.TaskId is not null && input.ExpenseType != "OPERATING" || input.ExpenseType is not ("INITIAL_INVESTMENT" or "OPERATING") ||
            string.IsNullOrWhiteSpace(input.Category) || input.Category.Length > 60 || input.Amount <= 0 ||
            input.Amount >= 1_000_000_000_000_000_000m || decimal.Truncate(input.Amount) != input.Amount || input.OccurredOn == default ||
            string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 4000)
            throw new FinanceException(400, "invalid_expense");
        if (!await repository.ValidScopeAsync(input.LocationId, input.RoomId, token)) throw new FinanceException(404, "expense_scope_not_found");
    }
    public Task<ExpensePage> ListAsync(ExpenseFilter filter, CancellationToken token)
    {
        _ = Owner();
        if (filter.Page < 1 || filter.PageSize is < 1 or > 100 || (long)(filter.Page - 1) * filter.PageSize > int.MaxValue || filter.From > filter.To || filter.LocationId == Guid.Empty ||
            filter.ExpenseType is not (null or "INITIAL_INVESTMENT" or "OPERATING") || filter.Category?.Length > 60)
            throw new FinanceException(400, "invalid_finance_filter");
        return repository.ListAsync(filter, token);
    }
    public async Task<ExpenseView> GetAsync(Guid id, CancellationToken token)
    { _ = Owner(); return await repository.GetAsync(id, token) ?? throw new FinanceException(404, "expense_not_found"); }
    public async Task<ExpenseReferences> ReferencesAsync(Guid locationId, Guid? roomId, CancellationToken token)
    {
        _ = Owner(); if (locationId == Guid.Empty || roomId == Guid.Empty) throw new FinanceException(400, "invalid_finance_filter");
        if (!await repository.ValidScopeAsync(locationId, roomId, token)) throw new FinanceException(404, "expense_scope_not_found");
        return await repository.ReferencesAsync(locationId, roomId, token);
    }
    public async Task<ExpenseView> CreateAsync(ExpenseInput input, Guid key, CancellationToken token)
    {
        var actor = Owner(); if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        await ValidateAsync(input, token);
        return await repository.CreateAsync(input, actor, key, clock.GetUtcNow(), token);
    }
    public async Task<ExpenseView> UpdateAsync(Guid id, ExpenseUpdate input, CancellationToken token)
    {
        var actor = Owner();
        if (input.Expense is null || input.ExpectedVersion < 0 || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 1000)
            throw new FinanceException(400, "invalid_expense_update");
        await ValidateAsync(input.Expense, token);
        return await repository.UpdateAsync(id, input, actor, clock.GetUtcNow(), token);
    }
}
