using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class HoldingSettingsData(BHomePersistenceContext db) : IHoldingSettingsData
{
    public async Task<HoldingSettings?> GetAsync(Guid locationId, CancellationToken t)
    {
        var json = await db.Database.SqlQuery<string>($"SELECT COALESCE(operating_settings->'holdingContractSettings','null'::jsonb)::text AS \"Value\" FROM public.locations WHERE id={locationId} AND is_active").SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        return JsonSerializer.Deserialize<HoldingSettings>(json);
    }
    public async Task SetAsync(Guid locationId, HoldingSettingsInput input, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        // Serialize competing edits on the Location without replacing unrelated operating settings.
        var locked = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.locations WHERE id={locationId} AND is_active FOR UPDATE").SingleOrDefaultAsync(t);
        if (locked == Guid.Empty) throw ContractException.Missing();
        var current = await GetAsync(locationId, t);
        if ((current?.Version ?? 0) != input.ExpectedVersion) throw ContractException.Conflict("holding_settings_changed_reload");
        var settings = new HoldingSettings(locationId, input.HoldingMonths, input.DepositRentMonths, input.Terms, input.ExpectedVersion + 1);
        var json = JsonSerializer.Serialize(settings);
        var history = JsonSerializer.Serialize(new { recordType = "HoldingSettingsConfigured", recordedAt = now, actorId = actor, state = settings });
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE public.locations SET operating_settings=jsonb_set(operating_settings,'{{holdingContractSettings}}',CAST({json} AS jsonb)),version=version+1,history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={locationId}", t);
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = actor, Event = "HoldingSettingsConfigured", TargetType = "Location", TargetId = locationId, Succeeded = true, OccurredAt = now });
        await db.SaveChangesAsync(t); await tx.CommitAsync(t);
    }
}
