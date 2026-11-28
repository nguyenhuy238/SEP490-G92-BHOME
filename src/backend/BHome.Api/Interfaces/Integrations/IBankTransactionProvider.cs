namespace BHome.Application.Integrations;

public sealed record BankTransaction(string ProviderReference, decimal AmountVnd, DateTimeOffset OccurredAt);
public sealed record BankTransactionPage(IReadOnlyList<BankTransaction> Items, string? NextCursor);

public interface IBankTransactionProvider
{
    Task<BankTransactionPage> GetTransactionsAsync(string? cursor, CancellationToken cancellationToken);
}
