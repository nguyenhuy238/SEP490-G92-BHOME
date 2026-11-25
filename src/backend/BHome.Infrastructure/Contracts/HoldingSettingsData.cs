using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class HoldingSettingsData(BHomePersistenceContext db) : IHoldingSettingsData
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<HoldingSettings?> GetForOwnerAsync(Guid ownerUserId, CancellationToken t)
    {
        var json = await db.Database.SqlQuery<string>($"SELECT COALESCE(business_profile->'holdingContractPolicy'->'current','null'::jsonb)::text AS \"Value\" FROM public.users WHERE id={ownerUserId} AND 'Owner'=ANY(roles)").SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        return JsonSerializer.Deserialize<HoldingSettings>(json, JsonOptions);
    }

    public async Task<HoldingSettings?> GetForLocationAsync(Guid locationId, CancellationToken t)
    {
        Guid[] ownerId;
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
        {
            ownerId = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.users WHERE 'Owner'=ANY(roles) ORDER BY id LIMIT 2").ToArrayAsync(t);
        }
        else
        {
            ownerId = await db.Database.SqlQuery<Guid>($"""
            SELECT u.id AS "Value"
            FROM public.users u
            WHERE 'Owner'=ANY(u.roles)
              AND (
                u.business_profile->'chain'->>'id' = (SELECT chain_id::text FROM public.locations WHERE id={locationId} AND is_active)
                OR (SELECT count(*) FROM public.users WHERE 'Owner'=ANY(roles)) = 1
              )
            ORDER BY u.id LIMIT 2
            """).ToArrayAsync(t);
        }
        if (ownerId.Length != 1) throw ContractException.Conflict("holding_owner_scope_unavailable");
        if (!await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.locations WHERE id={locationId} AND is_active").AnyAsync(t))
            throw ContractException.Missing();
        return await GetForOwnerAsync(ownerId[0], t);
    }

    public async Task<IReadOnlyList<HoldingSettings>> HistoryForOwnerAsync(Guid ownerUserId, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"SELECT entry::text AS \"Value\" FROM public.users CROSS JOIN LATERAL jsonb_array_elements(COALESCE(business_profile->'holdingContractPolicy'->'versions','[]'::jsonb)) entry WHERE id={ownerUserId} AND 'Owner'=ANY(roles) ORDER BY (entry->>'version')::int DESC").ToArrayAsync(t);
        return rows.Select(row => JsonSerializer.Deserialize<HoldingSettings>(row, JsonOptions)
            ?? throw ContractException.Conflict("holding_settings_invalid_history")).ToArray();
    }

    public async Task SetForOwnerAsync(Guid ownerUserId, HoldingSettingsInput input, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({ownerUserId.ToString()},0))", t);
        var locked = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.users WHERE id={ownerUserId} AND 'Owner'=ANY(roles) FOR UPDATE").SingleOrDefaultAsync(t);
        if (locked == Guid.Empty) throw ContractException.Missing();
        var current = await GetForOwnerAsync(ownerUserId, t);
        if ((current?.Version ?? 0) != input.ExpectedVersion) throw ContractException.Conflict("holding_settings_changed_reload");
        if (current is not null && current.Terms == input.Terms)
        {
            await tx.CommitAsync(t);
            return;
        }

        var settings = new HoldingSettings(ownerUserId, 1, 1m, input.Terms, input.ExpectedVersion + 1, now, actor);
        var versions = await HistoryForOwnerAsync(ownerUserId, t);
        var history = versions.Append(settings).OrderBy(x => x.Version).ToArray();
        var policy = JsonSerializer.Serialize(new { current = settings, versions = history }, JsonOptions);
        var legacy = JsonSerializer.Serialize(new { recordType = "GlobalHoldingPolicyConfigured", recordedAt = now, actorId = actor, state = settings }, JsonOptions);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE public.users SET business_profile=jsonb_set(COALESCE(business_profile,'{{}}'::jsonb), '{{holdingContractPolicy}}', CAST({policy} AS jsonb), true), history=history||jsonb_build_array(CAST({legacy} AS jsonb)) WHERE id={ownerUserId}", t);
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = actor, Event = "GlobalHoldingPolicyConfigured", TargetType = "Owner", TargetId = ownerUserId, Succeeded = true, OccurredAt = now });
        await db.SaveChangesAsync(t);
        await tx.CommitAsync(t);
    }
}
