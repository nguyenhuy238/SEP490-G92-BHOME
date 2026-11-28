using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal static class NativePolicyQueries
{
    // Page directly from the physical policy rows. Name and creation ordering are
    // historical metadata; keep literal Contains semantics even for % and _.
    internal static async Task<PagedResult<PolicyDto>> ListAsync(Compact24DbContext db,
        PropertyQuery q, Guid? staffId, DateOnly today, CancellationToken token)
    {
        short? category = q.ChargeCategory is { } kind ? (short)kind : null;
        var rows = db.Set<Native.BillingPolicy>().FromSqlInterpolated($"""
            SELECT p.* FROM billing_policies p
            JOIN locations l ON l.id=p.location_id
            LEFT JOIN LATERAL (
                SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='BillingPolicy' ORDER BY h.n DESC LIMIT 1
            ) s ON TRUE
            WHERE (CAST({q.LocationId} AS uuid) IS NULL OR p.location_id={q.LocationId})
                AND (CAST({q.RoomId} AS uuid) IS NULL OR p.room_id={q.RoomId})
                AND (CAST({category} AS smallint) IS NULL OR p.category={category})
                AND (CAST({q.EffectiveOn} AS date) IS NULL OR p.effective_from<={q.EffectiveOn}
                    AND (p.effective_to IS NULL OR p.effective_to>={q.EffectiveOn}))
                AND (CAST({q.Search} AS text) IS NULL OR strpos(p.charge_code,{q.Search})>0
                    OR strpos(COALESCE(s.data->>'name',''),{q.Search})>0)
                AND (CAST({staffId} AS uuid) IS NULL OR EXISTS(
                    SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a
                    WHERE (a->>'staffUserId')::uuid={staffId}
                      AND (a->>'startDate')::date<={today} AND (a->>'endDate')::date>={today}))
            """).AsNoTracking();
        var count = await rows.CountAsync(token);
        // Order/paginate in SQL before mapping; the physical table stores creation
        // time inside its typed history entry, not in a column.
        var sort = db.Database.SqlQueryRaw<PolicyOrder>("""
            SELECT p.id AS "Id", COALESCE((s.data->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt"
            FROM billing_policies p LEFT JOIN LATERAL (
                SELECT h.value->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='BillingPolicy' ORDER BY h.n DESC LIMIT 1
            ) s ON TRUE
            """);
        var page = await (from row in rows
                          join order in sort on row.Id equals order.Id
                          orderby order.CreatedAt, row.Id
                          select row)
            .Skip(checked((q.Page - 1) * q.PageSize)).Take(q.PageSize).ToArrayAsync(token);
        return new(page.Select(p => PropertyService.Map(NativePolicyPersistence.Read(p))).ToArray(), q.Page, q.PageSize, count);
    }

    private sealed class PolicyOrder
    {
        public Guid Id { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
    }
}
