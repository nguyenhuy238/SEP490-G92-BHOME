using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Text.Json;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractRepository(BHomePersistenceContext db, ISetupWorkspaceStore? setup = null) : IContractRepository
{
    public async Task<ContractPage> ListAsync(ContractListScope scope, int page, int pageSize, Guid? locationId, ContractStatus? status, CancellationToken t)
    {
        var query = db.Set<Contract>().AsNoTracking().Where(c => scope.Owner ||
            (scope.Tenant && c.TenantUserId == scope.ActorId) ||
            (scope.Staff && db.StaffLocationAssignments.Any(a => a.StaffUserId == scope.ActorId &&
                a.LocationId == c.Room.LocationId && a.StartDate <= scope.Today && a.EndDate >= scope.Today)));
        if (locationId is { } location) query = query.Where(c => c.Room.LocationId == location);
        if (status is { } state) query = query.Where(c => c.Status == state);
        var total = await query.CountAsync(t);
        var items = await query.OrderByDescending(c => c.StartDate).ThenBy(c => c.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new
            {
                Summary = new ContractSummary(c.Id, c.RoomId, c.Room.LocationId, c.Room.Location.Name, c.Room.RoomNumber,
                c.Kind.ToString(), c.Status.ToString(), c.StartDate, c.EndDate, c.MonthlyRent,
                c.Kind == ContractKind.Main && c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft,
                c.RequiredDeposit, c.HoldingExpiryAt),
                c.AgreedPriceSnapshot
            }).ToArrayAsync(t);
        return new(items.Select(row =>
        {
            if (row.Summary.Kind != "Holding" || row.Summary.HoldingExpiresAt is not null) return row.Summary;
            // Legacy contracts retain the original expiry in their immutable price snapshot.
            try { return row.Summary with { HoldingExpiresAt = JsonSerializer.Deserialize<HoldingPriceSnapshot>(row.AgreedPriceSnapshot)?.HoldingExpiresAt }; }
            catch (JsonException) { return row.Summary; }
        }).ToArray(), page, pageSize, total);
    }
    public Task FlushAsync(CancellationToken t) => db.SaveChangesAsync(t);
    public async Task<IReadOnlyList<ContractFinalInspection>> FinalInspectionsAsync(Guid contractId, CancellationToken t) => await db.Set<ContractFinalInspection>().Where(i => i.ContractId == contractId).OrderByDescending(i => i.Version).Take(100).ToArrayAsync(t);
    public async Task<IReadOnlyList<HandoverReading>> FinalReadingsAsync(Guid contractId, Guid roomId, DateOnly today, CancellationToken t) => await
        (from r in db.Set<MeterReading>().AsNoTracking()
         join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
         join meter in db.Set<Meter>() on r.MeterId equals meter.Id
         join e in db.Set<MeterEvidence>() on r.EvidenceId equals e.Id
         where task.ContractId == contractId && meter.RoomId == roomId && meter.IsActive && task.Purpose == ReadingPurpose.Final && task.ReadingDate == today && task.Status == MeterTaskStatus.Completed && e.IsUploaded && e.IsLinked
         select new HandoverReading(r.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, r.ConfirmedValue, e.Id, e.ObjectKey, e.ImageHash)).ToArrayAsync(t);
    public Task<bool> StaffAssignedAsync(Guid staffId, Guid locationId, DateOnly today, CancellationToken t) => db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == staffId && a.LocationId == locationId && a.StartDate <= today && a.EndDate >= today, t);
    public async Task<IReadOnlyList<ContractMoveOutHistory>> MoveOutHistoryAsync(Guid contractId, CancellationToken t) => await db.Set<ContractMoveOutHistory>().AsNoTracking().Where(h => h.ContractId == contractId).OrderByDescending(h => h.Version).Take(100).ToArrayAsync(t);
    public async Task<IReadOnlyList<MoveOutAssignment>> AssignmentsAsync(Guid staffId, DateOnly today, CancellationToken t) => await
        (from m in db.Set<ContractMoveOut>().AsNoTracking()
         join c in db.Set<Contract>() on m.ContractId equals c.Id
         where m.InspectionStaffId == staffId && m.Status != MoveOutStatus.Completed && m.InspectionScheduledAt != null && c.Room.Location.IsActive &&
           db.StaffLocationAssignments.Any(a => a.StaffUserId == staffId && a.LocationId == c.Room.LocationId && a.StartDate <= today && a.EndDate >= today)
         orderby m.InspectionScheduledAt
         select new MoveOutAssignment(c.Id, c.RoomId, c.Room.RoomNumber, c.Room.Location.Name, m.Status.ToString(), m.ProposedDate, m.InspectionScheduledAt!.Value, m.Version)).Take(100).ToArrayAsync(t);
    public async Task<T> InTransactionAsync<T>(Guid roomId, Func<Task<T>> work, CancellationToken t)
    {
        // Order: payment ledger -> Location advisory -> Room row. Property and Invoice start at
        // Location and never acquire the ledger afterward. Re-read domain state only after locking.
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
            var locationId = await db.Set<Room>().AsNoTracking().Where(r => r.Id == roomId)
                .Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
            if (!await db.Locked<Room>(roomId).AnyAsync(t))
                throw ContractException.Missing();
            var value = await work();
            await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return value;
        }
        catch (DbUpdateConcurrencyException)
        { throw ContractException.Conflict("contract_concurrent_operation_retry"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23P01" or "23514" })
        { throw ContractException.Conflict("contract_concurrent_or_duplicate_operation"); }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01" or "23514" or "23505" or "23P01")
        { throw ContractException.Conflict("contract_concurrent_operation_retry"); }
    }
    public Task<Contract?> FindAsync(Guid id, CancellationToken t) => db.Set<Contract>().Include(c => c.Room).ThenInclude(r => r.Location)
        .Include(c => c.Room).ThenInclude(r => r.RoomType)
        .Include(c => c.Residents).Include(c => c.Signatures).AsSplitQuery().SingleOrDefaultAsync(c => c.Id == id, t);
    public Task<Room?> RoomAsync(Guid id, CancellationToken t) => db.Set<Room>().Include(r => r.Location).SingleOrDefaultAsync(r => r.Id == id, t);
    public async Task<IReadOnlyList<Resident>> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t)
        => await db.Set<Resident>().Where(r => r.RoomId == roomId && ids.Contains(r.Id)).ToArrayAsync(t);
    public Task<bool> ActiveUserInRoleAsync(Guid id, string role, CancellationToken t) =>
        (from u in db.Users
         join ur in db.UserRoles on u.Id equals ur.UserId
         join r in db.Roles on ur.RoleId equals r.Id
         where u.Id == id && u.IsActive && r.Name == role
         select u.Id).AnyAsync(t);
    public async Task<bool> ConflictsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, Guid[] residentIds, CancellationToken t)
    {
        var capacity = await db.Set<Room>().Where(r => r.Id == roomId).Select(r => r.Capacity).SingleAsync(t);
        var others = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).Where(c => c.RoomId == roomId && c.Id != exceptId &&
            c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.StartDate <= to && c.EndDate >= from).ToArrayAsync(t);
        if (others.Any(c => c.Residents.Any(r => residentIds.Contains(r.ResidentId)))) return true;
        var dates = others.Select(c => c.StartDate < from ? from : c.StartDate).Append(from).Distinct();
        return dates.Any(date => residentIds.Length + others.Where(c => c.StartDate <= date && c.EndDate >= date).SelectMany(c => c.Residents).Select(r => r.ResidentId).Distinct().Count() > capacity);
    }
    public Task<bool> HasOtherActiveContractsAsync(Guid roomId, Guid exceptId, CancellationToken t) =>
        db.Set<Contract>().AnyAsync(c => c.RoomId == roomId && c.Id != exceptId && c.Status == ContractStatus.Active, t);
    public Task<bool> OpenRenewalAsync(Guid contractId, CancellationToken t) => db.Set<Contract>().AnyAsync(c => c.PreviousContractId == contractId &&
        (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation), t);
    public async Task<IReadOnlyList<Contract>> VersionsAsync(Guid roomId, Guid tenantId, CancellationToken t) =>
        await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == roomId && c.TenantUserId == tenantId).OrderBy(c => c.StartDate).Take(501).ToArrayAsync(t);
    public async Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t)
    {
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            return await db.Database.SqlQuery<decimal>($"""
                SELECT COALESCE(sum(a.amount),0) AS "Value" FROM payment_allocations a
                JOIN payments p ON p.id=a.source_payment_id
                WHERE a.target_deposit_contract_id={contractId} AND p.status='VERIFIED'
                """).SingleAsync(t);
        return await db.Set<DepositVerification>().Where(d => d.ContractId == contractId).SumAsync(d => (decimal?)d.Amount, t) ?? 0;
    }
    public Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t) =>
        db.Set<DepositVerification>().SingleOrDefaultAsync(d => d.BankTransactionReference == reference, t);
    public async Task<ResolvedPrices> ResolvePricesAsync(Guid roomId, DateOnly effectiveOn, CancellationToken t)
    {
        var room = await db.Set<Room>().AsNoTracking().SingleAsync(r => r.Id == roomId, t);
        var candidates = await db.Set<BillingPolicy>().AsNoTracking().Where(x => x.LocationId == room.LocationId &&
            (x.RoomId == roomId || x.RoomTypeId == room.RoomTypeId && x.RoomTypeId != null || x.RoomId == null && x.RoomTypeId == null) &&
            x.EffectiveFrom <= effectiveOn && (x.EffectiveTo == null || x.EffectiveTo >= effectiveOn)).ToArrayAsync(t);
        var charges = candidates.GroupBy(x => x.ChargeCode).Select(g =>
            g.OrderByDescending(x => x.RoomId.HasValue ? 2 : x.RoomTypeId.HasValue ? 1 : 0).First())
            .OrderBy(x => x.ChargeCode, StringComparer.Ordinal).Select(PropertyService.Map).ToArray();
        return new(roomId, effectiveOn, charges, new[] { "RENT", "ELECTRICITY", "WATER" }.Except(charges.Select(x => x.ChargeCode)).ToArray());
    }
    public async Task<bool> HasUtilityProfileAsync(Guid roomId, DateOnly from, DateOnly to, CancellationToken t)
    {
        if (setup is null) return false;
        var location = await setup.RoomLocationAsync(roomId, t) ?? throw ContractException.Missing();
        var profiles = (await setup.ListAsync(location, "UtilityProfile", t))
            .Select(d => (d.Id, Profile: d.Data.Deserialize<UtilityProfileWrite>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!))
            .Where(d => d.Profile.RoomId == roomId).ToArray();
        return profiles.Any(d =>
        {
            var replacement = profiles.Where(next => next.Profile.ReplacesId == d.Id)
                .Select(next => (DateOnly?)next.Profile.EffectiveFrom).Min();
            var effectiveTo = d.Profile.EffectiveTo;
            if (replacement is { } next && (effectiveTo is null || effectiveTo >= next))
                effectiveTo = next.AddDays(-1);
            return d.Profile.EffectiveFrom <= to && (effectiveTo is null || effectiveTo >= from);
        });
    }
    public async Task<IReadOnlyList<Contract>> BindingContractsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t)
    {
        var contracts = db.Set<Contract>().AsNoTracking().Include(c => c.Residents)
            .Where(c => c.RoomId == roomId && c.Id != exceptId && c.Kind != ContractKind.Addendum &&
                c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            contracts = contracts.Where(c => c.Status == ContractStatus.Active ||
                c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation ||
                c.Kind == ContractKind.Holding && c.Status == ContractStatus.Draft && c.ApprovedAt != null);
        else
            contracts = contracts.Where(c => c.Status == ContractStatus.Active ||
                c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation);
        return await contracts.ToArrayAsync(t);
    }
    public Task<bool> HoldingConflictAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t)
    {
        var candidates = db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == roomId && c.Id != exceptId && c.StartDate <= to && c.EndDate >= from);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            return candidates.AnyAsync(c => c.Status == ContractStatus.Active ||
                c.Kind != ContractKind.Addendum &&
                (c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Draft) &&
                (c.Signatures.Any(s => s.Status != SignatureStatus.Failed) ||
                 db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.TargetDepositContractId == c.Id && a.Amount > 0)), t);
        return candidates.AnyAsync(c => c.Status == ContractStatus.Active ||
            c.Kind != ContractKind.Addendum &&
            (c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Draft) &&
            (c.Signatures.Any(s => s.Status != SignatureStatus.Failed) || db.Set<DepositVerification>().Any(d => d.ContractId == c.Id && d.Amount > 0)), t);
    }
    public Task<Contract?> MainForHoldingAsync(Guid holdingId, CancellationToken t) => db.Set<Contract>()
        .Include(c => c.Room).ThenInclude(r => r.Location).Include(c => c.Room).ThenInclude(r => r.RoomType)
        .Include(c => c.Residents).Include(c => c.Signatures).AsSplitQuery()
        .SingleOrDefaultAsync(c => c.HoldingContractId == holdingId, t);
    public Task<ContractMoveOut?> MoveOutAsync(Guid contractId, CancellationToken t) => db.Set<ContractMoveOut>().SingleOrDefaultAsync(m => m.ContractId == contractId, t);
    public async Task<IReadOnlyList<ContractInspectionEvidence>> InspectionEvidenceAsync(Guid contractId, CancellationToken t) =>
        await db.Set<ContractInspectionEvidence>().Where(e => e.ContractId == contractId).Take(50).ToArrayAsync(t);
    public async Task<IReadOnlyList<ContractSettlementReview>> SettlementReviewsAsync(Guid contractId, CancellationToken t) =>
        await db.Set<ContractSettlementReview>().AsNoTracking().Where(r => r.ContractId == contractId).OrderByDescending(r => r.ReviewedAt).ThenBy(r => r.Id).Take(100).ToArrayAsync(t);
    public Task<bool> ValidFinalReadingAsync(Guid readingId, Guid contractId, Guid roomId, UtilityType type, DateOnly readingDate, CancellationToken t) =>
        (from r in db.Set<MeterReading>()
         join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
         join meter in db.Set<Meter>() on r.MeterId equals meter.Id
         join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
         where r.Id == readingId && task.ContractId == contractId && meter.RoomId == roomId && meter.IsActive && meter.UtilityType == type &&
             task.ReadingDate == readingDate && task.Status == MeterTaskStatus.Completed && task.Purpose == ReadingPurpose.Final &&
             evidence.IsUploaded && evidence.IsLinked && r.ConfirmedAt != default
         select r.Id).AnyAsync(t);
    public Task<ContractOperation?> OperationAsync(Guid actorId, Guid key, string operation, CancellationToken t) =>
        db.Set<ContractOperation>().SingleOrDefaultAsync(o => o.ActorId == actorId && o.Key == key && o.Operation == operation, t);
    public void Add(object entity) => db.Add(entity);
    public async Task<IReadOnlyList<ContractOccupantView>> OccupantsAsync(Guid contractId, CancellationToken t) =>
        await (from cr in db.Set<ContractResident>().AsNoTracking()
               join resident in db.Set<Resident>() on cr.ResidentId equals resident.Id
               where cr.ContractId == contractId
               select new ContractOccupantView(resident.Id, resident.DisplayLabel, cr.Role == ResidentType.Representative)).ToArrayAsync(t);
    public async Task CloseResidenceAsync(Contract contract, DateOnly actualEndDate, Guid actorId, DateTimeOffset at, CancellationToken t)
    {
        // Only Compact24 is a deployed runtime. The offline legacy regression schema has a
        // required RoomId column and no actual-residence fields; it cannot assert this integration.
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) { await db.SaveChangesAsync(t); return; }
        var ids = contract.Residents.Select(r => r.ResidentId).ToArray();
        var retained = await db.Set<ContractResident>().Where(cr => ids.Contains(cr.ResidentId) && cr.ContractId != contract.Id &&
            (cr.ResidenceTo == null || cr.ResidenceTo >= actualEndDate) && db.Set<Contract>().Any(c => c.Id == cr.ContractId &&
                c.Status == ContractStatus.Active && c.Kind != ContractKind.Holding && c.StartDate <= actualEndDate &&
                (c.ActualEndDate ?? c.EndDate) >= actualEndDate)).Select(cr => cr.ResidentId).Distinct().ToArrayAsync(t);
        foreach (var resident in await db.Set<Resident>().Where(r => ids.Contains(r.Id) && r.RoomId == contract.RoomId && !retained.Contains(r.Id)).ToArrayAsync(t))
            resident.RoomId = null;
        await db.SaveChangesAsync(t);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contract_residents SET actual_move_out_date={actualEndDate},
                  registration_status=CASE WHEN registration_status='Completed' THEN registration_status ELSE 'Closed' END,
                  history=history||jsonb_build_array(jsonb_build_object('action','PhysicalResidenceClosed','actorId',{actorId},
                    'occurredAt',{at},'actualMoveOutDate',{actualEndDate},'previousRegistrationStatus',registration_status))
                WHERE contract_id={contract.Id} AND resident_id=ANY({ids})
                """, t);
    }
    public void AuditAnonymous(string action, Guid targetId, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = null, Event = action, TargetId = targetId, TargetType = "Contract", Succeeded = true, OccurredAt = at });
    public void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actorId, Event = action, TargetId = targetId, TargetType = "Contract", Succeeded = true, OccurredAt = at });
}
