using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractWorkflowRepository(BHomePersistenceContext db) : IContractWorkflowRepository
{
    public async Task<ContractPreparation> PreparationAsync(ContractListScope scope, Guid? locationId, CancellationToken t)
    {
        var locations = db.Locations.AsNoTracking().Where(l => l.IsActive && (scope.Owner || db.StaffLocationAssignments.Any(a =>
            a.LocationId == l.Id && a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today)));
        var choices = await locations.OrderBy(l => l.Name).Take(100).Select(l => new ContractChoice(l.Id, l.Name)).ToArrayAsync(t);
        if (locationId is not null && !await locations.AnyAsync(l => l.Id == locationId, t)) throw ContractException.Missing();
        var rooms = await db.Set<Room>().AsNoTracking().Where(r => locationId != null && r.LocationId == locationId &&
            (r.Status == RoomStatus.Available || r.Status == RoomStatus.Occupied) && r.RoomTypeId != null && r.RoomType!.IsActive && locations.Any(l => l.Id == r.LocationId))
            .OrderBy(r => r.RoomNumber).Take(100).Select(r => new ContractRoomChoice(r.Id, r.RoomNumber, r.LocationId, r.Status.ToString())).ToArrayAsync(t);
        var ids = rooms.Select(r => r.Id).ToArray();
        var residents = await db.Set<Resident>().AsNoTracking().Where(r => ids.Contains(r.RoomId))
            .OrderBy(r => r.DisplayLabel).Take(500).Select(r => new ContractResidentChoice(r.Id, r.RoomId, r.DisplayLabel, r.TenantUserId,
                r.VerificationStatus == IdentityVerificationStatus.Verified, r.ResidentType.ToString())).ToArrayAsync(t);
        var owners = await (from account in db.Users.AsNoTracking()
                            join grant in db.UserRoles on account.Id equals grant.UserId
                            join role in db.Roles on grant.RoleId equals role.Id
                            where account.IsActive && role.Name == Roles.Owner
                            orderby account.UserName
                            select new ContractChoice(account.Id, account.UserName!)).Take(100).ToArrayAsync(t);
        return new(choices, rooms, residents, owners);
    }

    public async Task<IReadOnlyList<ContractChoice>> TenantAccountsAsync(CancellationToken t) =>
        await (from account in db.Users.AsNoTracking()
               join grant in db.UserRoles on account.Id equals grant.UserId
               join role in db.Roles on grant.RoleId equals role.Id
               where account.IsActive && role.Name == Roles.Tenant
               orderby account.UserName
               select new ContractChoice(account.Id, account.UserName!)).Take(100).ToArrayAsync(t);

    public async Task LinkTenantAsync(Guid residentId, Guid tenantId, Guid actor, DateTimeOffset at, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        var roomId = await db.Set<Resident>().Where(r => r.Id == residentId).Select(r => (Guid?)r.RoomId).SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
        await db.Locked<Room>(roomId).SingleAsync(t);
        var resident = await db.Locked<Resident>(residentId).SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        if (resident.RoomId != roomId) throw ContractException.Conflict("resident_room_changed");
        var validAccount = await (from account in db.Users
                                  join grant in db.UserRoles on account.Id equals grant.UserId
                                  join role in db.Roles on grant.RoleId equals role.Id
                                  where account.Id == tenantId && account.IsActive && role.Name == Roles.Tenant
                                  select account.Id).AnyAsync(t);
        if (!validAccount || resident.VerificationStatus != IdentityVerificationStatus.Verified) throw ContractException.Invalid("verified_tenant_account_required");
        if (resident.TenantUserId is not null && resident.TenantUserId != tenantId ||
            await db.Set<Contract>().AnyAsync(c => c.RepresentativeResidentId == residentId && c.TenantUserId != tenantId, t))
            throw ContractException.Conflict("resident_account_already_linked");
        if (resident.TenantUserId is null)
        {
            resident.TenantUserId = tenantId;
            db.SecurityAudit.Add(new()
            {
                UserId = actor,
                Event = "ContractTenantAccountLinked",
                TargetId = residentId,
                TargetType = "Resident",
                Succeeded = true,
                OccurredAt = at
            });
            await db.SaveChangesAsync(t);
        }
        await transaction.CommitAsync(t);
    }

    public Task<ContractDocumentFile?> PreviewAsync(Guid id, string hash, string template, int version, CancellationToken t) =>
        db.Set<ContractDocumentFile>().SingleOrDefaultAsync(f => f.ContractId == id && f.Kind == ContractFileKind.Preview &&
            f.SnapshotHash == hash && f.TemplateId == template && f.TemplateVersion == version, t);
    public Task<ContractDocumentFile?> FileAsync(Guid contractId, Guid fileId, CancellationToken t) =>
        db.Set<ContractDocumentFile>().SingleOrDefaultAsync(f => f.ContractId == contractId && f.Id == fileId, t);
    public async Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid contractId, ContractFileKind kind, CancellationToken t) =>
        await db.Set<ContractDocumentFile>().AsNoTracking().Where(f => f.ContractId == contractId && f.Kind == kind)
            .OrderByDescending(f => f.RecordedAt).Take(50).ToArrayAsync(t);
    public async Task<IReadOnlyList<ContractHistoryView>> HistoryAsync(Guid id, CancellationToken t) =>
        await db.SecurityAudit.AsNoTracking().Where(a => a.TargetId == id && a.TargetType == "Contract")
            .OrderByDescending(a => a.OccurredAt).Take(100).Select(a => new ContractHistoryView(a.Event, a.UserId, a.OccurredAt)).ToArrayAsync(t);
    public async Task<IReadOnlyList<DepositVerificationView>> DepositsAsync(Guid id, CancellationToken t) =>
        await db.Set<DepositVerification>().AsNoTracking().Where(d => d.ContractId == id).OrderByDescending(d => d.VerifiedAt)
            .Select(d => new DepositVerificationView(d.Id, d.BankTransactionReference, d.Amount, d.VerificationReason, d.VerifiedByUserId, d.VerifiedAt)).ToArrayAsync(t);
}
