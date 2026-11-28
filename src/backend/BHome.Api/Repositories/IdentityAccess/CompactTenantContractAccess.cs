using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class CompactTenantContractAccess(BHomePersistenceContext db) : ITenantContractAccess
{
    public Task<bool> SharesContractAsync(Guid tenantUserId, Guid representativeUserId, Guid locationId,
        CancellationToken cancellationToken)
    {
        if (db is Compact24DbContext)
        {
            var memberships = db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking();
            var residents = db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking();
            var nativeContracts =
                from currentMember in memberships
                join currentResident in residents on currentMember.ResidentId equals currentResident.Id
                join representativeMember in memberships on currentMember.ContractId equals representativeMember.ContractId
                join representative in residents on representativeMember.ResidentId equals representative.Id
                join contract in db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking() on currentMember.ContractId equals contract.Id
                join room in db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking() on contract.RoomId equals room.Id
                where currentResident.TenantUserId == tenantUserId
                    && representative.TenantUserId == representativeUserId
                    && room.LocationId == locationId
                    && (contract.Kind == BHome.Domain.TenantContracts.ContractKind.Main || contract.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal || contract.Kind == BHome.Domain.TenantContracts.ContractKind.Addendum)
                    && currentMember.ResidentId != representativeMember.ResidentId
                select currentMember.ContractId;

            return nativeContracts.AnyAsync(cancellationToken);
        }

        // Archived-schema integration hosts retain their original authorization graph.
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
