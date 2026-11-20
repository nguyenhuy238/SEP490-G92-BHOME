using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class HandoverDraftRepository(BHomePersistenceContext db) : IHandoverDraftRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<HandoverDraftState?> GetAsync(Guid contractId, CancellationToken token)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            return null;
        var json = await db.Database.SqlQuery<string>($"""
            SELECT COALESCE((handover->'preparation')::text, 'null') AS "Value"
            FROM contracts WHERE id={contractId}
            """).SingleOrDefaultAsync(token);
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
