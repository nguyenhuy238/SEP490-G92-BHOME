using BHome.Application.IdentityAccess;

namespace BHome.Infrastructure.IdentityAccess;

// Fail closed until the finalized staff assignment model is implemented.
internal sealed class UnconfiguredStaffLocationAccess : IStaffLocationAccess
{
    public Task<bool> IsAssignedAsync(Guid staffId, Guid ownerId, Guid locationId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(false);
    }
}
