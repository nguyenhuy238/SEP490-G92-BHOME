using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
namespace BHome.Application.Contracts;

public sealed record ContractExpiryNoticeView(Guid Id, Guid ContractId, string RoomNumber, string LocationName, DateOnly EndDate, string Stage, DateTimeOffset CreatedAt);
public interface IContractExpiryRepository
{
    Task<IReadOnlyList<ContractExpiryNoticeView>> ListAsync(Guid actor, bool owner, CancellationToken t);
}
public sealed class ContractExpiryService(IContractExpiryRepository repository, ICurrentUser user)
{
    public Task<IReadOnlyList<ContractExpiryNoticeView>> ListAsync(CancellationToken t)
    {
        if (user.UserId is not { } actor || actor == Guid.Empty) throw new ContractException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner) && !user.IsInRole(Roles.Tenant)) throw new ContractException(403, "contract_role_forbidden");
        return repository.ListAsync(actor, user.IsInRole(Roles.Owner), t);
    }
}
