using System.Linq.Expressions;
using BHome.Application.PropertyManagement;
using BHome.Domain.Common;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class PostgresPropertyRepository(BHomePersistenceContext db) : IPropertyRepository
{
    public async Task<RoomObligations> ObligationsAsync(Guid locationId, Guid? roomId, DateOnly today,
        CancellationToken token)
    {
        var rooms = db.Set<Room>().Where(r => r.LocationId == locationId &&
            (!roomId.HasValue || r.Id == roomId)).Select(r => r.Id);
        var contracts = db.Set<Contract>().Where(c => rooms.Contains(c.RoomId));
        var residents = await db.Set<Resident>().AnyAsync(r => rooms.Contains(r.RoomId), token);
        var occupancy = await contracts.AnyAsync(c => c.Status == ContractStatus.Active &&
            c.Residents.Any(r => r.ResidenceFrom <= today && (r.ResidenceTo == null || r.ResidenceTo >= today)), token);
        var active = await contracts.AnyAsync(c => c.Status == ContractStatus.Active, token);
        // Status alone is not a reservation. Protect signed evidence or verified money;
        // do not infer a Holding Contract or replace activation's stricter readiness checks.
        var pending = await contracts.AnyAsync(c =>
            (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation) &&
            (c.Signatures.Any(s => s.Status == SignatureStatus.Signed && s.SignedAt != null &&
                s.SignedObjectKey != null && s.SignedObjectKey != "" && s.SignedHash != null && s.SignedHash != "") ||
             db.Set<DepositVerification>().Any(d => d.ContractId == c.Id && d.Amount > 0)), token);
        return new(residents, occupancy, active, pending);
    }
    public async Task<T?> FindAsync<T>(Guid id, CancellationToken token) where T : AuditableEntity
    {
        var tracked = db.ChangeTracker.Entries<T>().SingleOrDefault(x => x.Entity.Id == id);
        if (tracked is not null)
        {
            await tracked.ReloadAsync(token);
            return tracked.State == EntityState.Detached ? null : tracked.Entity;
        }
        return await db.Set<T>().SingleOrDefaultAsync(x => x.Id == id, token);
    }
    public Task<bool> AnyAsync<T>(Expression<Func<T, bool>> predicate, CancellationToken token) where T : class =>
        db.Set<T>().AsNoTracking().AnyAsync(predicate, token);

    public async Task<PagedResult<TDto>> ListAsync<T, TDto>(Expression<Func<T, bool>> predicate,
        Expression<Func<T, TDto>> projection, PropertyQuery query, Guid? staffId, DateOnly today,
        CancellationToken token) where T : AuditableEntity
    {
        var rows = db.Set<T>().AsNoTracking().Where(predicate);
        if (staffId is { } staff)
        {
            var locations = db.StaffLocationAssignments.Where(a => a.StaffUserId == staff &&
                a.StartDate <= today && today <= a.EndDate).Select(a => a.LocationId);
            rows = typeof(T) == typeof(Location) ? rows.Where(x => locations.Contains(x.Id)) :
                rows.Where(x => locations.Contains(EF.Property<Guid>(x, "LocationId")));
        }
        var count = await rows.CountAsync(token);
        var items = await rows.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Skip(checked((query.Page - 1) * query.PageSize)).Take(query.PageSize).Select(projection).ToArrayAsync(token);
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<IReadOnlyList<BillingPolicy>> ApplicablePoliciesAsync(Room room, DateOnly date, CancellationToken token) =>
        await db.Set<BillingPolicy>().AsNoTracking().Where(x => x.LocationId == room.LocationId &&
            (x.RoomId == room.Id || x.RoomId == null) && x.RoomTypeId == null &&
            x.EffectiveFrom <= date && (x.EffectiveTo == null || x.EffectiveTo >= date)).ToArrayAsync(token);

    public async Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> operation, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        // One lock order for configuration, deactivation, policy changes and legacy capture writes.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", token);
        try
        {
            var result = await operation();
            await db.SaveChangesAsync(token);
            await tx.CommitAsync(token);
            return result;
        }
        catch (DbUpdateConcurrencyException) { throw new PropertyException(409, "stale_version"); }
        catch (PostgresException e) when (e.SqlState is "23505" or "23P01")
        { throw new PropertyException(409, "duplicate_or_overlapping_configuration"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23P01" })
        { throw new PropertyException(409, "duplicate_or_overlapping_configuration"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23503" or "23514" })
        { throw new PropertyException(409, "configuration_dependency_conflict"); }
    }
    public Task<bool> HasResidentsAsync(Guid roomId, CancellationToken token) =>
        db.Set<Resident>().AnyAsync(x => x.RoomId == roomId, token);
    public void Add<T>(T entity) where T : class => db.Set<T>().Add(entity);
    public void Audit(PropertyChange change)
    {
        db.Set<PropertyChange>().Add(change);
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = change.ActorId,
            Event = "Property" + change.Action,
            TargetType = change.TargetType,
            TargetId = change.TargetId,
            Succeeded = true,
            OccurredAt = change.OccurredAt
        });
    }
}
