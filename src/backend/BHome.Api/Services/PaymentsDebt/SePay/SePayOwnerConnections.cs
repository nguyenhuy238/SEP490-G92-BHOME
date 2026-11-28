using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt.SePay;

public sealed record SePayConnectionInput(string BankIdentifier, string Gateway, string AccountNumber,
    string AccountHolder, bool Enabled, bool HumanVerified, int ExpectedAccountVersion, int ExpectedVersion,
    string? ApiToken = null, string? WebhookSecret = null);
public sealed record SePayConnectionView(string Mode, int Version, bool HasApiToken, bool HasWebhookSecret,
    string Status, string WebhookPath, string? Gateway, DateTimeOffset? VerifiedAt, ReceivingBankAccount? Account);
public sealed record SePayConnectionCheck(bool Connected, string Code);
public sealed record SePayOwnerProfile(Guid? OwnerId, string Mode, int PollIntervalSeconds);
public interface ISePayOwnerConnections
{
    Task<SePayConnectionView> GetAsync(Guid ownerId, string mode, CancellationToken token);
    Task<SePayConnectionView> SaveAsync(Guid ownerId, string mode, SePayConnectionInput input, CancellationToken token);
    Task<SePayConnectionCheck> CheckAsync(Guid ownerId, string mode, CancellationToken token);
    Task ApplyOwnerAsync(Guid ownerId, CancellationToken token);
    Task ApplyLocationAsync(Guid locationId, CancellationToken token);
    Task<IReadOnlyList<SePayOwnerProfile>> ProfilesAsync(CancellationToken token);
}
