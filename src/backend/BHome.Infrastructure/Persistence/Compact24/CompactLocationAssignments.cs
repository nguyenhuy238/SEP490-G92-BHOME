using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactLocationAssignments(Compact24DbContext db, TimeProvider clock) : ILocationAssignments, IStaffLocationAccess
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Assignment(Guid Id, Guid StaffUserId, Guid ActorId, DateTimeOffset RecordedAt, DateOnly StartDate, DateOnly EndDate);

    public async Task<CreateAssignmentResult> CreateAssignmentAsync(Guid actor, Guid locationId, Guid staffId, DateOnly start, DateOnly end, CancellationToken token)
    {
        if (actor == Guid.Empty || locationId == Guid.Empty || staffId == Guid.Empty || start > end) return new(CreateAssignmentStatus.InvalidDateRange);
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.OpenConnectionAsync(token);
        await using var select = Command("SELECT staff_assignments::text FROM locations WHERE id=@id FOR UPDATE");
        select.Parameters.AddWithValue("id", locationId);
        var stored = (string?)await select.ExecuteScalarAsync(token);
        if (stored is null) return new(CreateAssignmentStatus.LocationNotFound);
        var owner = await db.Users.AnyAsync(u => u.Id == actor && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token);
        if (!owner) throw new UnauthorizedAccessException("Owner authorization is required.");
        if (!await db.Users.AnyAsync(u => u.Id == staffId && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Staff), token))
            return new(CreateAssignmentStatus.StaffUnavailable);
        var assignments = JsonSerializer.Deserialize<Assignment[]>(stored, Json) ?? throw new InvalidOperationException("Invalid assignment data.");
        if (assignments.Any(a => a.Id == Guid.Empty || a.StaffUserId == Guid.Empty || a.StartDate > a.EndDate))
            throw new InvalidOperationException("Invalid assignment data.");
        if (assignments.Any(a => a.StartDate <= end && start <= a.EndDate)) return new(CreateAssignmentStatus.DateRangeOverlaps);
        var entry = new Assignment(Guid.NewGuid(), staffId, actor, clock.GetUtcNow(), start, end);
        var json = JsonSerializer.Serialize(new[] { entry }, Json);
        var history = JsonSerializer.Serialize(new[] { new { action = "StaffAssigned", actorId = actor, occurredAt = entry.RecordedAt, assignmentId = entry.Id } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET staff_assignments=staff_assignments||CAST({json} AS jsonb),version=version+1,history=history||CAST({history} AS jsonb) WHERE id={locationId}
            """, token);
        await tx.CommitAsync(token);
        return new(CreateAssignmentStatus.Created, new(entry.Id, entry.StaffUserId, entry.StartDate, entry.EndDate));
    }

    public async Task<IReadOnlyList<StaffAssignmentSummary>?> ListAssignmentsAsync(Guid locationId, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("SELECT staff_assignments::text FROM locations WHERE id=@id"); query.Parameters.AddWithValue("id", locationId);
        var value = (string?)await query.ExecuteScalarAsync(token);
        return value is null ? null : (JsonSerializer.Deserialize<Assignment[]>(value, Json) ?? throw new InvalidOperationException("Invalid assignment data."))
            .OrderByDescending(a => a.StartDate).ThenBy(a => a.Id).Select(a => new StaffAssignmentSummary(a.Id, a.StaffUserId, a.StartDate, a.EndDate)).ToArray();
    }

    public async Task<IReadOnlyList<LocationSummary>> ListAssignedLocationsAsync(Guid staffId, DateOnly date, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("""
            SELECT l.id,l.name FROM locations l
            WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE
                (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@date AND (a->>'endDate')::date>=@date)
            ORDER BY l.name,l.id
            """);
        query.Parameters.AddWithValue("staff", staffId); query.Parameters.AddWithValue("date", date);
        var result = new List<LocationSummary>();
        await using var reader = await query.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) result.Add(new(reader.GetGuid(0), reader.GetString(1)));
        return result;
    }

    public async Task<bool> IsAssignedAsync(Guid staffId, Guid locationId, CancellationToken token)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("""
            SELECT EXISTS(SELECT 1 FROM locations l WHERE l.id=@location AND EXISTS(
              SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE
              (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@date AND (a->>'endDate')::date>=@date))
            """);
        query.Parameters.AddWithValue("staff", staffId); query.Parameters.AddWithValue("location", locationId); query.Parameters.AddWithValue("date", today);
        return (bool)(await query.ExecuteScalarAsync(token))!;
    }
    private NpgsqlCommand Command(string sql) => new(sql, (NpgsqlConnection)db.Database.GetDbConnection(),
        (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
}
