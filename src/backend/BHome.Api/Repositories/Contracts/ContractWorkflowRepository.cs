using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using BHome.Infrastructure.IdentityAccess;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractWorkflowRepository(BHomePersistenceContext db, IIdentityProtection? protection = null) : IContractWorkflowRepository
{

    public async Task<ContractPreparation> PreparationAsync(ContractListScope scope, Guid? locationId, CancellationToken t)
    {
        if (db is Compact24DbContext) return await NativePreparationAsync(scope, locationId, t);
        var locations = db.Locations.AsNoTracking().Where(l => l.IsActive &&
            (scope.Owner || scope.Staff && db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) &&
             db.StaffLocationAssignments.Any(a => a.LocationId == l.Id && a.StaffUserId == scope.ActorId &&
                a.StartDate <= scope.Today && a.EndDate >= scope.Today)));
        var choices = await locations.OrderBy(l => l.Name).Take(100).Select(l => new ContractChoice(l.Id, l.Name)).ToArrayAsync(t);
        if (locationId is not null && !await locations.AnyAsync(l => l.Id == locationId, t)) throw ContractException.Missing();
        var rooms = await db.Set<Room>().AsNoTracking().Where(r => locationId != null && r.LocationId == locationId &&
            (r.Status == RoomStatus.Available || r.Status == RoomStatus.Occupied || r.Status == RoomStatus.OnHold) && locations.Any(l => l.Id == r.LocationId))
            .OrderBy(r => r.RoomNumber).Take(100).Select(r => new ContractRoomChoice(r.Id, r.RoomNumber, r.LocationId, r.Status.ToString())).ToArrayAsync(t);
        var ids = rooms.Select(r => r.Id).ToArray();
        var people = await db.Set<Resident>().AsNoTracking().Where(r => r.RoomId != null && ids.Contains(r.RoomId.Value))
            .OrderBy(r => r.DisplayLabel).Take(500).ToArrayAsync(t);
        var residents = people.Select(r =>
        {
            var identity = ContractResidentDisplay.Read(r, protection);
            // Full identity number is restricted to the authorized Owner's selection UI.
            var number = identity.Number is { Length: >= 4 } ? scope.Owner ? identity.Number : "********" + identity.Number[^4..] : null;
            var label = number is not null ? $"{identity.Name} · {number}" : identity.Name;
            return new ContractResidentChoice(r.Id, r.RoomId!.Value, label, r.TenantUserId,
                ContractResidentEligibility.Ready(r, r.HouseholdRepresentativeId ?? r.Id), r.ResidentType.ToString());
        }).ToArray();
        var owners = await (from account in db.Users.AsNoTracking()
                            join grant in db.UserRoles on account.Id equals grant.UserId
                            join role in db.Roles on grant.RoleId equals role.Id
                            where account.IsActive && role.Name == Roles.Owner
                            orderby account.UserName
                            select new ContractChoice(account.Id, account.UserName!)).Take(100).ToArrayAsync(t);
        return new(choices, rooms, residents, owners);
    }

    private async Task<ContractPreparation> NativePreparationAsync(ContractListScope scope, Guid? locationId, CancellationToken t)
    {
        var assigned = db.Database.SqlQuery<Guid>($"""
            SELECT l.id AS "Value" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
            WHERE (a->>'staffUserId')::uuid={scope.ActorId} AND (a->>'startDate')::date<={scope.Today} AND (a->>'endDate')::date>={scope.Today}
            """);
        var locations = db.Set<BHome.Domain.Locations.Location>().AsNoTracking().Where(l => l.IsActive &&
            (scope.Owner || scope.Staff && db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) && assigned.Contains(l.Id)));
        var choices = await locations.OrderBy(l => l.Name).Take(100).Select(l => new ContractChoice(l.Id, l.Name)).ToArrayAsync(t);
        if (locationId is not null && !await locations.AnyAsync(l => l.Id == locationId, t)) throw ContractException.Missing();
        var roomRows = await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => locationId != null && r.LocationId == locationId &&
            (r.Status == RoomStatus.Available || r.Status == RoomStatus.Occupied || r.Status == RoomStatus.OnHold) &&
            locations.Any(l => l.Id == r.LocationId)).OrderBy(r => r.RoomNumber).Take(100).ToArrayAsync(t);
        var rooms = roomRows.Select(r => new ContractRoomChoice(r.Id, r.RoomNumber, r.LocationId, ((RoomStatus)r.Status).ToString())).ToArray();
        var ids = rooms.Select(r => r.Id).ToArray();
        var people = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(r => r.RoomId != null && ids.Contains(r.RoomId.Value))
            .OrderBy(r => r.DisplayLabel).Take(500).ToArrayAsync(t);
        var residents = people.Select(NativeResidentPersistence.Read).Select(r =>
        {
            var identity = ContractResidentDisplay.Read(r, protection);
            var number = identity.Number is { Length: >= 4 } ? scope.Owner ? identity.Number : "********" + identity.Number[^4..] : null;
            var label = number is not null ? $"{identity.Name} · {number}" : identity.Name;
            return new ContractResidentChoice(r.Id, r.RoomId!.Value, label, r.TenantUserId,
                ContractResidentEligibility.Ready(r, r.HouseholdRepresentativeId ?? r.Id), r.ResidentType.ToString());
        }).ToArray();
        return new(choices, rooms, residents, await NativeAccountsAsync(Roles.Owner, t));
    }

    private async Task<IReadOnlyList<ContractChoice>> NativeAccountsAsync(string role, CancellationToken t) =>
        await db.Users.AsNoTracking().Where(a => a.IsActive && EF.Property<string[]>(a, "roles").Contains(role))
            .OrderBy(a => a.UserName).Take(100).Select(a => new ContractChoice(a.Id, a.UserName!)).ToArrayAsync(t);

    public async Task<IReadOnlyList<ContractChoice>> TenantAccountsAsync(CancellationToken t) =>
        db is Compact24DbContext ? await NativeAccountsAsync(Roles.Tenant, t) : await (from account in db.Users.AsNoTracking()
                                                                                       join grant in db.UserRoles on account.Id equals grant.UserId
                                                                                       join role in db.Roles on grant.RoleId equals role.Id
                                                                                       where account.IsActive && role.Name == Roles.Tenant
                                                                                       orderby account.UserName
                                                                                       select new ContractChoice(account.Id, account.UserName!)).Take(100).ToArrayAsync(t);

    public async Task LinkTenantAsync(Guid residentId, Guid tenantId, Guid actor, DateTimeOffset at, CancellationToken t)
    {
        if (db is Compact24DbContext native)
        {
            await NativeLinkTenantAsync(native, residentId, tenantId, actor, at, t);
            return;
        }
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

    private async Task NativeLinkTenantAsync(Compact24DbContext native, Guid residentId, Guid tenantId, Guid actor, DateTimeOffset at, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var roomId = await db.Set<BHome.Domain.TenantContracts.Resident>().Where(r => r.Id == residentId).Select(r => r.RoomId).SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM rooms WHERE id={roomId} FOR UPDATE").SingleAsync(t);
        var row = await db.Set<BHome.Domain.TenantContracts.Resident>().FromSqlInterpolated($"SELECT * FROM residents WHERE id={residentId} FOR UPDATE")
            .AsNoTracking().SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
        if (row.RoomId != roomId) throw ContractException.Conflict("resident_room_changed");
        var valid = await db.Users.AsNoTracking().AnyAsync(a => a.Id == tenantId && a.IsActive && EF.Property<string[]>(a, "roles").Contains(Roles.Tenant), t);
        if (!valid || row.VerificationStatus != IdentityVerificationStatus.Verified) throw ContractException.Invalid("verified_tenant_account_required");
        if (row.TenantUserId is not null && row.TenantUserId != tenantId || await db.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(c =>
            c.RepresentativeResidentId == residentId && c.TenantUserId != tenantId &&
            (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal || c.Kind == BHome.Domain.TenantContracts.ContractKind.Holding || c.Kind == BHome.Domain.TenantContracts.ContractKind.Addendum), t))
            throw ContractException.Conflict("resident_account_already_linked");
        if (row.TenantUserId is null)
        {
            await NativeResidentPersistence.LinkAsync(native, NativeResidentPersistence.Read(row), tenantId, t);
            await SecurityAuditWrites.AppendAsync(db, new(Guid.NewGuid(), actor, null, null, "ContractTenantAccountLinked", true, at, "Resident", residentId), t);
        }
        await tx.CommitAsync(t);
    }

    public async Task<ContractDocumentFile?> PreviewAsync(Guid id, string hash, string template, int version, CancellationToken t) =>
        (await ContractDocumentPersistence.ListAsync(db, id, t)).SingleOrDefault(f => f.Kind == ContractFileKind.Preview &&
            f.SnapshotHash == hash && f.TemplateId == template && f.TemplateVersion == version);
    public async Task<ContractDocumentFile?> FileAsync(Guid contractId, Guid fileId, CancellationToken t) =>
        (await ContractDocumentPersistence.ListAsync(db, contractId, t)).SingleOrDefault(f => f.Id == fileId);
    public async Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid contractId, ContractFileKind kind, CancellationToken t) =>
        (await ContractDocumentPersistence.ListAsync(db, contractId, t)).Where(f => f.Kind == kind)
            .OrderByDescending(f => f.RecordedAt).Take(50).ToArray();
    public async Task<IReadOnlyList<ContractHistoryView>> HistoryAsync(Guid id, CancellationToken t) =>
        db is Compact24DbContext ? await db.Set<Native.Notification>().AsNoTracking()
            .Where(a => a.RecordKind == "AUDIT" && a.RelatedEntityId == id && a.RelatedEntityType == "Contract" &&
                a.EventData.GetProperty("recordType").GetString() == "SecurityAuditRecord")
            .OrderByDescending(a => a.EventAt).Take(100).Select(a => new ContractHistoryView(a.NotificationType, a.ActorUserId, a.EventAt)).ToArrayAsync(t) :
        await db.SecurityAudit.AsNoTracking().Where(a => a.TargetId == id && a.TargetType == "Contract")
            .OrderByDescending(a => a.OccurredAt).Take(100).Select(a => new ContractHistoryView(a.Event, a.UserId, a.OccurredAt)).ToArrayAsync(t);
    public async Task<IReadOnlyList<DepositVerificationView>> DepositsAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext)
            return await db.Set<DepositVerification>().AsNoTracking().Where(d => d.ContractId == id).OrderByDescending(d => d.VerifiedAt)
                .Select(d => new DepositVerificationView(d.Id, d.BankTransactionReference, d.Amount, d.VerificationReason, d.VerifiedByUserId, d.VerifiedAt)).ToArrayAsync(t);
        var legacy = await db.Database.SqlQuery<DepositVerificationView>($"""
            SELECT (h->'state'->>'id')::uuid AS "Id", h->'state'->>'bankTransactionReference' AS "BankTransactionReference",
                (h->'state'->>'amount')::numeric AS "Amount",h->'state'->>'verificationReason' AS "VerificationReason",
                (h->'state'->>'verifiedByUserId')::uuid AS "VerifiedByUserId",(h->'state'->>'verifiedAt')::timestamptz AS "VerifiedAt"
            FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE h->>'recordType'='DepositVerification' AND h->'state'->>'contractId'={id.ToString()}
            AND COALESCE(h->>'deleted','false')<>'true'
            """).ToArrayAsync(t);
        var receipts = await db.Database.SqlQuery<DepositVerificationView>($"""
            SELECT a.id AS "Id",p.transaction_reference AS "BankTransactionReference",a.amount AS "Amount",a.reason AS "VerificationReason",
              a.created_by_user_id AS "VerifiedByUserId",a.allocated_at AS "VerifiedAt"
            FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
            WHERE a.target_deposit_contract_id={id} AND p.status='VERIFIED'
              AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='DepositVerification')
            """).ToArrayAsync(t);
        return legacy.Concat(receipts).OrderByDescending(d => d.VerifiedAt).ThenBy(d => d.Id).ToArray();
    }
}
