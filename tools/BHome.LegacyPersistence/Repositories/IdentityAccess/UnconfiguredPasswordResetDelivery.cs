using BHome.Application.Common;
using BHome.Application.IdentityAccess;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class UnconfiguredPasswordResetDelivery : IPasswordResetDelivery
{
    public bool IsAvailable => false;
    public Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken) =>
        throw new IntegrationUnavailableException("Password reset delivery is not configured.");
}
