using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class CompactTenantContractAccess(BHomePersistenceContext db) : ITenantContractAccess
{
    public Task<bool> SharesContractAsync(Guid tenantUserId, Guid representativeUserId, Guid locationId,
        CancellationToken cancellationToken)
    {
        // Use the persistence contract rather than the Compact24 concrete context so
        // the archived-schema integration host can validate the same authorization graph.
        // Both schemas expose these domain projections with their own table mappings.
        var sharedContracts =
            from currentMember in db.Set<ContractResident>()
            join currentResident in db.Set<Resident>() on currentMember.ResidentId equals currentResident.Id
            join representativeMember in db.Set<ContractResident>() on currentMember.ContractId equals representativeMember.ContractId
            join representative in db.Set<Resident>() on representativeMember.ResidentId equals representative.Id
            join contract in db.Set<Contract>() on currentMember.ContractId equals contract.Id
            join room in db.Set<Room>() on contract.RoomId equals room.Id
            where currentResident.TenantUserId == tenantUserId
                && representative.TenantUserId == representativeUserId
                && room.LocationId == locationId
                && contract.Kind != ContractKind.Holding
                && currentMember.ResidentId != representativeMember.ResidentId
            select currentMember.ContractId;

        return sharedContracts.AnyAsync(cancellationToken);
    }
}
