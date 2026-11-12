namespace BHome.Application.PaymentsDebt.SePay;

public sealed record SePayPage(IReadOnlyList<SePayTransaction> Items, bool HasMore);
public sealed record SePayPollingCursor(string? SinceId = null, int Page = 1, string? CandidateId = null, DateTimeOffset? SynchronizedAt = null);
public interface ISePayTransactionClient
{
    Task<SePayPage> GetAsync(SePayPollingCursor cursor, CancellationToken token);
}
