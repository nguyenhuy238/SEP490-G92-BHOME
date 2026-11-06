using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractRepository(BHomePersistenceContext db) : IContractRepository
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
            .Select(c => new ContractSummary(c.Id, c.RoomId, c.Room.LocationId, c.Room.Location.Name, c.Room.RoomNumber,
                c.Kind.ToString(), c.Status.ToString(), c.StartDate, c.EndDate, c.MonthlyRent, c.DraftMetadata != "{}")).ToArrayAsync(t);
        return new(items, page, pageSize, total);
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
            c.Status == ContractStatus.Active && c.StartDate <= to && c.EndDate >= from).ToArrayAsync(t);
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
    public async Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t) =>
        await db.Set<DepositVerification>().Where(d => d.ContractId == contractId).SumAsync(d => (decimal?)d.Amount, t) ?? 0;
    public Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t) =>
        db.Set<DepositVerification>().SingleOrDefaultAsync(d => d.BankTransactionReference == reference, t);
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
    public void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actorId, Event = action, TargetId = targetId, TargetType = "Contract", Succeeded = true, OccurredAt = at });
}
