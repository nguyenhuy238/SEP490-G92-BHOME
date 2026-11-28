using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Ocr;

// Household information is encrypted by HouseholdProfiles. This repository
// only reads physical rows and persists the already encrypted snapshots.
internal static class NativeHouseholdPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static async Task<Resident?> ResidentAsync(Compact24DbContext db, Guid id, CancellationToken t, bool locked = false)
    {
        var query = locked
            ? db.Set<Native.Resident>().FromSqlInterpolated($"SELECT * FROM residents WHERE id={id} FOR UPDATE")
            : db.Set<Native.Resident>();
        var row = await query.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t);
        return row is null ? null : NativeResidentPersistence.Read(row);
    }

    internal static async Task<Resident[]> MembersAsync(Compact24DbContext db, Guid representative, Guid? owner, Guid[]? ids, CancellationToken t)
    {
        var selected = ids ?? [];
        var household = ids is null;
        var rows = await db.Set<Native.Resident>().FromSqlInterpolated($"""
            SELECT r.* FROM residents r
            LEFT JOIN LATERAL (SELECT h->'state' AS state FROM jsonb_array_elements(r.history) WITH ORDINALITY a(h,n)
                WHERE h->>'recordType'='Resident' ORDER BY n DESC LIMIT 1) s ON TRUE
            WHERE (({household} AND s.state->>'householdRepresentativeId'={representative.ToString()})
                OR (NOT {household} AND r.id=ANY({selected})))
                AND (CAST({owner} AS uuid) IS NULL OR (r.identity_owner_scope_id={owner} AND r.id<>{representative}))
            ORDER BY s.state->>'householdClientKey'
            """).AsNoTracking().ToArrayAsync(t);
        return rows.Select(NativeResidentPersistence.Read).ToArray();
    }

    internal static Task<Guid?> LatestDraftAsync(Compact24DbContext db, Guid representative, CancellationToken t) =>
        db.Database.SqlQuery<Guid?>($"""
            SELECT c.id AS "Value" FROM contracts c
            LEFT JOIN LATERAL (SELECT (h->'state'->>'createdAt')::timestamptz AS created_at
                FROM jsonb_array_elements(c.history) WITH ORDINALITY a(h,n)
                WHERE h->>'recordType'='Contract' ORDER BY n DESC LIMIT 1) s ON TRUE
            WHERE c.representative_resident_id={representative} AND c.contract_type='MAIN' AND c.status=0
            ORDER BY COALESCE(s.created_at,'1970-01-01Z'::timestamptz) DESC LIMIT 1
            """).FirstOrDefaultAsync(t);

    internal static Task<int> OccupancyAsync(Compact24DbContext db, Guid room, CancellationToken t) =>
        (from c in db.Set<Native.Contract>()
         join r in db.Set<Native.ContractResident>() on c.Id equals r.ContractId
         where c.RoomId == room && c.Status == (short)ContractStatus.Active && c.ContractType != "HOLDING"
         select r.ResidentId).Distinct().CountAsync(t);

    internal static async Task<Contract[]> BoundContractsAsync(Compact24DbContext db, Guid resident, CancellationToken t)
    {
        var rows = await db.Set<Native.Contract>().FromSqlInterpolated($"""
            SELECT c.* FROM contracts c JOIN contract_residents r ON r.contract_id=c.id
            WHERE r.resident_id={resident} AND c.status NOT IN (6,7) ORDER BY c.id FOR UPDATE OF c
            """).AsNoTracking().ToArrayAsync(t);
        var ids = rows.Select(c => c.Id).ToArray();
        var roster = (await db.Set<Native.ContractResident>().AsNoTracking().Where(r => ids.Contains(r.ContractId)).ToArrayAsync(t))
            .ToLookup(r => r.ContractId, NativeContractSnapshot.Read);
        var signatures = (await db.Set<Native.ContractSigning>().AsNoTracking().Where(s => ids.Contains(s.ContractId)).ToArrayAsync(t))
            .ToLookup(s => s.ContractId, NativeContractSnapshot.Read);
        return rows.Select(row =>
        {
            var contract = NativeContractSnapshot.Read(row);
            contract.Residents = roster[row.Id].ToList();
            contract.Signatures = signatures[row.Id].ToList();
            return contract;
        }).ToArray();
    }

    internal static async Task SaveDraftAsync(Compact24DbContext db, Contract draft, Guid[] previous, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null || draft.Kind != ContractKind.Main ||
            draft.Status != ContractStatus.Draft || draft.Signatures.Count != 0 || draft.DraftVersion < 2)
            throw ContractException.Conflict("household_already_used_by_contract");
        // The existing history guard forbids deleting ContractResident rows;
        // the legacy writer also rejected deleting these business records.
        // Fail atomically rather than leaving the encrypted draft and physical roster inconsistent.
        if (previous.Except(draft.Residents.Select(r => r.ResidentId)).Any())
            throw new InvalidOperationException("Business record retention requires an explicit transition.");

        draft.Stamp(DateTimeOffset.UtcNow, false);
        var oldVersion = draft.DraftVersion - 1;
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts c SET draft_metadata=CAST({draft.DraftMetadata} AS jsonb), snapshot_hash={draft.SnapshotHash},version={draft.DraftVersion},
                history=c.history||jsonb_build_array(jsonb_build_object('schemaVersion',1,'recordType','Contract',
                    'recordKey',c.id::text,'deleted',false,'state',
                    COALESCE((SELECT h->'state' FROM jsonb_array_elements(c.history) WITH ORDINALITY a(h,n)
                        WHERE h->>'recordType'='Contract' ORDER BY n DESC LIMIT 1),jsonb_build_object())||
                    jsonb_build_object('draftMetadata',{draft.DraftMetadata},'snapshotHash',{draft.SnapshotHash},
                        'draftVersion',{draft.DraftVersion},'updatedAt',{draft.UpdatedAt})))
            WHERE c.id={draft.Id} AND c.contract_type='MAIN' AND c.status=0 AND c.version={oldVersion}
                AND NOT EXISTS(SELECT 1 FROM contract_signings s WHERE s.contract_id=c.id)
            """, t);
        if (changed != 1) throw new DbUpdateConcurrencyException("Compact24 record changed or no longer exists.");
        foreach (var member in draft.Residents.Where(r => !previous.Contains(r.ResidentId)))
        {
            var history = JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                recordType = "ContractResident",
                recordKey = $"{member.ContractId}/{member.ResidentId}",
                deleted = false,
                state = member
            }, Json);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO contract_residents(contract_id,resident_id,resident_role,residence_from,residence_to,history)
                VALUES({member.ContractId},{member.ResidentId},{(short)member.Role},{member.ResidenceFrom},{member.ResidenceTo},
                    jsonb_build_array(CAST({history} AS jsonb)))
                """, t);
        }
    }
}
