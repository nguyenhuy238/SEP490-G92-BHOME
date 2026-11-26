using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class HandoverDraftRepository(BHomePersistenceContext db) : IHandoverDraftRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<HandoverInboxPage> ListAsync(int page, int pageSize, Guid? locationId,
        string? status, string roomSearch, CancellationToken token)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            throw new ContractException(503, "handover_draft_storage_unavailable");

        // Apply all filters before paging, so a page never silently contains
        // unrelated contracts or hides reports on subsequent contract pages.
        var count = await db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::integer AS "Value"
            FROM contracts c JOIN rooms r ON r.id = c.room_id
            WHERE c.contract_type = 'MAIN'
              AND COALESCE(c.handover->>'roomMoveInSuppressed','false') <> 'true'
              AND (c.handover->'preparation'->>'status' IS NOT NULL OR EXISTS (
                  SELECT 1 FROM operational_tasks task
                  WHERE task.contract_id = c.id AND task.task_type = 'GENERAL'
                    AND task.title = 'Bàn giao vào phòng ' || r.room_number))
              AND ({locationId}::uuid IS NULL OR r.location_id = {locationId}::uuid)
              AND ({status}::text IS NULL OR COALESCE(c.handover->'preparation'->>'status','Draft') = {status}::text)
              AND ({roomSearch}::text = '' OR r.room_number ILIKE '%' || {roomSearch}::text || '%')
            """).SingleAsync(token);
        var offset = (page - 1) * pageSize;
        var items = await db.Database.SqlQuery<HandoverInboxItem>($"""
            SELECT c.id AS "ContractId", r.location_id AS "LocationId",
                   l.name AS "LocationName", r.room_number AS "RoomNumber",
                   COALESCE(c.handover->'preparation'->>'status','Draft') AS "Status",
                   c.start_date AS "StartDate",
                   (c.handover->'preparation'->>'staffSubmittedAt')::timestamptz AS "StaffSubmittedAt",
                   (c.handover->'preparation'->>'ownerReadyAt')::timestamptz AS "OwnerReadyAt",
                   (c.handover->'preparation'->>'tenantConfirmedAt')::timestamptz AS "TenantConfirmedAt"
            FROM contracts c JOIN rooms r ON r.id = c.room_id
                             JOIN locations l ON l.id = r.location_id
            WHERE c.contract_type = 'MAIN'
              AND COALESCE(c.handover->>'roomMoveInSuppressed','false') <> 'true'
              AND (c.handover->'preparation'->>'status' IS NOT NULL OR EXISTS (
                  SELECT 1 FROM operational_tasks task
                  WHERE task.contract_id = c.id AND task.task_type = 'GENERAL'
                    AND task.title = 'Bàn giao vào phòng ' || r.room_number))
              AND ({locationId}::uuid IS NULL OR r.location_id = {locationId}::uuid)
              AND ({status}::text IS NULL OR COALESCE(c.handover->'preparation'->>'status','Draft') = {status}::text)
              AND ({roomSearch}::text = '' OR r.room_number ILIKE '%' || {roomSearch}::text || '%')
            ORDER BY CASE COALESCE(c.handover->'preparation'->>'status','Draft')
                       WHEN 'PendingOwnerReview' THEN 0
                       WHEN 'ChangesRequested' THEN 1
                       WHEN 'ReinspectionRequested' THEN 2
                       WHEN 'Ready' THEN 3
                       WHEN 'Draft' THEN 4
                       ELSE 5 END,
                     COALESCE((c.handover->'preparation'->>'staffSubmittedAt')::timestamptz,
                              (c.handover->'preparation'->>'createdAt')::timestamptz) DESC NULLS LAST,
                     c.id
            LIMIT {pageSize} OFFSET {offset}
            """).ToArrayAsync(token);
        return new HandoverInboxPage(items, page, pageSize, count);
    }

    public async Task<HandoverDraftState?> GetAsync(Guid contractId, CancellationToken token)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            return null;
        var json = await db.Database.SqlQuery<string>($"""
            SELECT CASE WHEN handover->>'roomMoveInSuppressed'='true' THEN 'suppressed'
                ELSE COALESCE((handover->'preparation')::text, 'null') END AS "Value"
            FROM contracts WHERE id={contractId}
            """).SingleOrDefaultAsync(token);
        if (json == "suppressed") throw ContractException.Missing();
        return json is null or "null" ? null : JsonSerializer.Deserialize<HandoverDraftState>(json, Json)
            ?? throw ContractException.Conflict("handover_draft_integrity_failed");
    }

    public async Task<bool> ReplaceAsync(Guid contractId, int previousVersion, HandoverDraftState next, CancellationToken token)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            throw new ContractException(503, "handover_draft_storage_unavailable");
        var json = JsonSerializer.Serialize(next, Json);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET handover=jsonb_set(handover,ARRAY['preparation'],{json}::jsonb,true)
            WHERE id={contractId} AND COALESCE((handover->'preparation'->>'version')::integer,0)={previousVersion}
            """, token);
        return affected == 1;
    }
}
