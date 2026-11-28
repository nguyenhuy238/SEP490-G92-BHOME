using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed class FinanceException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
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
            filter.RoomId == Guid.Empty || filter.ExpenseType is not (null or "INITIAL_INVESTMENT" or "OPERATING") || filter.Category?.Length > 60)
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
    public Task<ExpensePage> ListInvestmentsAsync(ExpenseFilter filter, CancellationToken token) =>
        ListAsync(filter with { ExpenseType = "INITIAL_INVESTMENT", OnlyOtherInvestments = true }, token);

    public async Task<IReadOnlyList<ExpenseView>> CreateInvestmentsAsync(BulkInvestmentInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        if (input is null || input.Items is not { Length: > 0 and <= 100 } ||
            input.Items.Any(i => i is null))
            throw new FinanceException(400, "invalid_investment_batch");
        var items = input.Items.Select(i => new ExpenseInput(input.LocationId, null, "INITIAL_INVESTMENT",
            i.Category, i.Amount, input.OccurredOn, i.Note)).ToArray();
        foreach (var item in items) await ValidateAsync(item, token);
        return await repository.CreateInvestmentsAsync(items, actor, key, clock.GetUtcNow(), token);
    }
}
