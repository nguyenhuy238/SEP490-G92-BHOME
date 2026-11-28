namespace BHome.Application.Finance;

public interface IExpenseRepository
{
    Task<bool> ValidScopeAsync(Guid locationId, Guid? roomId, CancellationToken token);
    Task<ExpensePage> ListAsync(ExpenseFilter filter, CancellationToken token);
    Task<ExpenseView?> GetAsync(Guid id, CancellationToken token);
    Task<ExpenseView> CreateAsync(ExpenseInput input, Guid actor, Guid key, DateTimeOffset now, CancellationToken token);
    Task<ExpenseView> UpdateAsync(Guid id, ExpenseUpdate input, Guid actor, DateTimeOffset now, CancellationToken token);
    Task<ExpenseReferences> ReferencesAsync(Guid locationId, Guid? roomId, CancellationToken token);
    Task<IReadOnlyList<ExpenseView>> CreateInvestmentsAsync(IReadOnlyList<ExpenseInput> items,
        Guid actor, Guid key, DateTimeOffset now, CancellationToken token);
}
