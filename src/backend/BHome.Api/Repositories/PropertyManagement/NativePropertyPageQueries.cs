using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal static class NativePropertyPageQueries
{
    private sealed class OrderRow
    {
        public Guid Id { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
    }

    // Identifiers are compile-time constants from the calls below; no request data
    // enters the SQL text. Preserve the source list's CreatedAt/Id ordering.
    private static IQueryable<OrderRow> Order(Compact24DbContext db, string kind) =>
        db.Database.SqlQueryRaw<OrderRow>(kind switch
        {
            "Location" => """
                SELECT p.id AS "Id", COALESCE((s.data->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt"
                FROM locations p LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='Location' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                """,
            "Room" => """
                SELECT p.id AS "Id", COALESCE((s.data->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt"
                FROM rooms p LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='Room' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                """,
            "Asset" => """
                SELECT p.id AS "Id", COALESCE((s.data->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt"
                FROM assets p LEFT JOIN LATERAL (
                    SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                    WHERE h.value->>'recordType'='Asset' ORDER BY h.n DESC LIMIT 1
                ) s ON TRUE
                """,
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        });

    private static IQueryable<Guid> StaffLocations(Compact24DbContext db, Guid staff, DateOnly today) =>
        db.Database.SqlQuery<Guid>($"""
            SELECT l.id AS "Value" FROM locations l
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a
                WHERE (a->>'staffUserId')::uuid={staff}
                  AND (a->>'startDate')::date<={today} AND (a->>'endDate')::date>={today})
            """);

    internal static async Task<PagedResult<LocationDto>> LocationsAsync(Compact24DbContext db,
        PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token)
    {
        var rows = db.Set<BHome.Domain.Locations.Location>().AsNoTracking().Where(x =>
            (!q.IsActive.HasValue || x.IsActive == q.IsActive) &&
            (q.Search == null || x.Name.Contains(q.Search) || x.Address.Contains(q.Search)));
        if (staffId is { } staff)
        {
            var locations = StaffLocations(db, staff, today);
            rows = rows.Where(x => locations.Contains(x.Id));
        }
        return await PageAsync(rows, Order(db, "Location"), q,
            row => new LocationDto(row.Id, row.Name, row.Address, row.IsActive, row.Version), token);
    }

    internal static async Task<PagedResult<RoomDto>> RoomsAsync(Compact24DbContext db,
        PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token)
    {
        var status = q.RoomStatus;
        var rows = db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(x =>
            (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.RoomId.HasValue || x.Id == q.RoomId) && (!status.HasValue || x.Status == status) &&
            (q.Search == null || x.RoomNumber.Contains(q.Search)));
        if (staffId is { } staff)
        {
            var locations = StaffLocations(db, staff, today);
            rows = rows.Where(x => locations.Contains(x.LocationId));
        }
        return await PageAsync(rows, Order(db, "Room"), q,
            row => PropertyService.Map(NativeRoomLocationPersistence.Read(row)), token);
    }

    internal static async Task<PagedResult<AssetDto>> AssetsAsync(Compact24DbContext db,
        PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token)
    {
        var status = q.AssetStatus;
        var rows = db.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking().Where(x =>
            (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.CommonAreaOnly || x.RoomId == null && x.CommonArea != null) &&
            (!q.RoomAssetsOnly || x.RoomId != null) &&
            (!q.RoomId.HasValue || x.RoomId == q.RoomId) && (!status.HasValue || x.Status == status) &&
            (q.Search == null || x.Name.Contains(q.Search) || x.AssetCode != null && x.AssetCode.Contains(q.Search)));
        if (staffId is { } staff)
        {
            var locations = StaffLocations(db, staff, today);
            rows = rows.Where(x => locations.Contains(x.LocationId));
        }
        return await PageAsync(rows, Order(db, "Asset"), q,
            row => PropertyService.Map(NativeAssetPersistence.Read(row)), token);
    }

    private static async Task<PagedResult<TDto>> PageAsync<TRow, TDto>(IQueryable<TRow> rows,
        IQueryable<OrderRow> order, PropertyQuery q, Func<TRow, TDto> map, CancellationToken token) where TRow : class
    {
        var count = await rows.CountAsync(token);
        var page = await (from row in rows
                          join sort in order on EF.Property<Guid>(row, "Id") equals sort.Id
                          orderby sort.CreatedAt, sort.Id
                          select row)
            .Skip(checked((q.Page - 1) * q.PageSize)).Take(q.PageSize).ToArrayAsync(token);
        return new(page.Select(map).ToArray(), q.Page, q.PageSize, count);
    }
}
