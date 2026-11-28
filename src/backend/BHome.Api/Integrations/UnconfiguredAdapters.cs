using BHome.Application.Common;
using BHome.Application.Integrations;
using Microsoft.Extensions.Logging;

namespace BHome.Infrastructure.Integrations;

// Deliberately no provider SDK/HTTP payload until a provider's real API is selected.
internal sealed class UnconfiguredBankProvider(ILogger<UnconfiguredBankProvider> logger) : IBankTransactionProvider
{
    public Task<BankTransactionPage> GetTransactionsAsync(string? cursor, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        logger.LogWarning("Bank provider is unconfigured; reconciliation requires manual review");
        throw new IntegrationUnavailableException("bank transactions");
    }
}

internal sealed class UnconfiguredNotificationProvider(ILogger<UnconfiguredNotificationProvider> logger) : INotificationProvider
{
    public Task<string> DeliverAsync(NotificationDelivery delivery, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        logger.LogWarning("Notification provider is unconfigured; delivery remains pending");
        throw new IntegrationUnavailableException("notifications");
    }
}

internal sealed class UnconfiguredElectronicContractProvider(ILogger<UnconfiguredElectronicContractProvider> logger)
    : IElectronicContractProvider
{
    public Task<SigningStatus> RequestSigningAsync(SigningRequest request, CancellationToken cancellationToken)
        => Unavailable(cancellationToken);

    public Task<SigningStatus> GetStatusAsync(string providerReference, CancellationToken cancellationToken)
        => Unavailable(cancellationToken);

    private Task<SigningStatus> Unavailable(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        logger.LogWarning("Electronic contract provider is unconfigured; signing is unavailable");
        throw new IntegrationUnavailableException("electronic contracts");
    }
}
