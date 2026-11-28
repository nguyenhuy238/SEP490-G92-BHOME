using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Billing;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

public sealed record LifecycleAttentionView(long UnsafeEquipment, long ExpiredLegalRecords, long OverdueTaxPeriods, long PendingPersonalDataRequests);
public interface ILifecycleAttentionRepository
{
    Task<LifecycleAttentionView> ReadAsync(DateOnly today, CancellationToken t);
}
public sealed class LifecycleAttentionService(ILifecycleAttentionRepository repository, ICurrentUser user, TimeProvider clock)
{
    public Task<LifecycleAttentionView> ReadAsync(CancellationToken t)
    {
        if (user.UserId is null) throw new OperationsException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden();
        return repository.ReadAsync(clock.BusinessToday(), t);
    }
}
