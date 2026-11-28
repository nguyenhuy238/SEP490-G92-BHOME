using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.PaymentsDebt;

internal static class PaymentObligationQueries
{
    internal static IQueryable<BHome.Domain.TenantContracts.Contract> Contracts(BHomePersistenceContext db) =>
        db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal ||
            c.Kind == BHome.Domain.TenantContracts.ContractKind.Holding || c.Kind == BHome.Domain.TenantContracts.ContractKind.Addendum);

    // Payment mode is frozen on the historical contract, not the current owner setting.
    internal static IQueryable<ContractPaymentModeRow> ContractModes(BHomePersistenceContext db) =>
        db.Database.SqlQueryRaw<ContractPaymentModeRow>("""
            SELECT c.id AS "Id",s.data->>'paymentMode' AS "PaymentMode",
              COALESCE((s.data->>'isDevelopmentDemo')::boolean,false) AS "IsDevelopmentDemo"
            FROM contracts c LEFT JOIN LATERAL (
              SELECT h->'state' AS data FROM jsonb_array_elements(c.history) WITH ORDINALITY e(h,n)
              WHERE h->>'recordType'='Contract' ORDER BY n DESC LIMIT 1
            ) s ON true WHERE c.contract_type IN ('MAIN','RENEWAL','HOLDING','ADDENDUM')
            """);

    internal static async Task<Invoice?> InvoiceAsync(BHomePersistenceContext db, Guid id, Guid? recipient, CancellationToken token)
    {
        var row = await db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == id &&
            (recipient == null || i.RecipientUserIds.Contains(recipient.Value)), token);
        if (row is null) return null;
        // Preserve the payment query's historical default for absent schedule metadata.
        if (row.BillingSnapshot.ValueKind != JsonValueKind.Object ||
            !row.BillingSnapshot.TryGetProperty("compactState", out var state) ||
            state.ValueKind != JsonValueKind.Object ||
            !state.TryGetProperty("scheduleSnapshot", out var schedule) || schedule.ValueKind == JsonValueKind.Null)
            row.ScheduleSnapshot = "{}";
        return row;
    }

    internal static async Task<Guid?> ReceivingOwnerAsync(BHomePersistenceContext db, Guid locationId, CancellationToken token)
    {
        if (locationId == Guid.Empty || !await db.Set<BHome.Domain.Locations.Location>().AnyAsync(l => l.Id == locationId, token)) return null;
        var owners = await (from c in Contracts(db)
                            join room in db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking() on c.RoomId equals room.Id
                            where room.LocationId == locationId
                            select c.OwnerSignerId).Distinct().Take(2).ToArrayAsync(token);
        if (owners.Length == 1) return owners[0];
        if (owners.Length > 1) return null;
        var registered = await db.Database.SqlQueryRaw<Guid>("""
            SELECT id AS "Value" FROM users WHERE is_active AND 'Owner'=ANY(roles) LIMIT 2
            """).ToArrayAsync(token);
        return registered.Length == 1 ? registered[0] : null;
    }

    // Existing location account versions remain readable even after moving to
    // the owner-wide profile. Historical JSON defaults match the old model.
    internal static async Task<ReceivingBankAccount?> LocationAccountAsync(BHomePersistenceContext db, Guid locationId,
        string? mode, CancellationToken token)
    {
        var row = await db.Database.SqlQuery<LocationAccountRow>($"""
            SELECT COALESCE((e->>'id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "Id",
              COALESCE((e->>'locationId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "LocationId",
              COALESCE(e->>'accountHolder','') AS "AccountHolder",COALESCE(e->>'accountNumber','') AS "AccountNumber",
              COALESCE(e->>'bankIdentifier','') AS "BankIdentifier",
              COALESCE((e->>'confirmedAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "ConfirmedAt",
              COALESCE((e->>'confirmedByUserId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "ConfirmedByUserId",
              COALESCE((e->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt",
              COALESCE((e->>'updatedAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "UpdatedAt",
              COALESCE((e->>'enabled')::boolean,false) AS "Enabled",
              COALESCE((e->>'isDevelopmentDemo')::boolean,false) AS "IsDevelopmentDemo",
              COALESCE((e->>'version')::integer,0) AS "Version"
            FROM locations l CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.operating_settings->'receivingBankAccounts','[]'::jsonb)) e
            WHERE COALESCE((e->>'locationId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)={locationId}
              AND (CAST({mode} AS text) IS NULL OR COALESCE((e->>'isDevelopmentDemo')::boolean,false)=({mode}='Test'))
            """).OrderByDescending(a => a.Version).FirstOrDefaultAsync(token);
        if (row is null) return null;
        var result = ReceivingBankAccount.RestoreIdentity(row.Id, row.CreatedAt, row.UpdatedAt);
        result.LocationId = row.LocationId; result.BankIdentifier = row.BankIdentifier; result.AccountNumber = row.AccountNumber;
        result.AccountHolder = row.AccountHolder; result.Enabled = row.Enabled; result.IsDevelopmentDemo = row.IsDevelopmentDemo;
        result.Version = row.Version; result.ConfirmedByUserId = row.ConfirmedByUserId; result.ConfirmedAt = row.ConfirmedAt;
        return result;
    }

    internal static async Task AddLocationAccountAsync(BHomePersistenceContext db, ReceivingBankAccount value, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Receiving account must share its protected transaction.");
        value.Stamp(DateTimeOffset.UtcNow, true);
        var state = new
        {
            value.Id,
            value.LocationId,
            value.BankIdentifier,
            value.AccountNumber,
            value.AccountHolder,
            value.Enabled,
            value.IsDevelopmentDemo,
            value.Version,
            value.ConfirmedByUserId,
            value.ConfirmedAt,
            value.CreatedAt,
            value.UpdatedAt
        };
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var payload = JsonSerializer.Serialize(state, json);
        var envelope = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "ReceivingBankAccount",
            recordKey = value.Id.ToString(),
            deleted = false,
            state
        }, json);
        var count = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET operating_settings=jsonb_set(operating_settings,ARRAY['receivingBankAccounts'],
              COALESCE((SELECT jsonb_agg(e ORDER BY n) FROM jsonb_array_elements(
                COALESCE(operating_settings->'receivingBankAccounts','[]'::jsonb)) WITH ORDINALITY a(e,n)
                WHERE e->>'id' IS DISTINCT FROM {value.Id.ToString()}),'[]'::jsonb)
              ||jsonb_build_array(CAST({payload} AS jsonb)||jsonb_build_object('recordType','ReceivingBankAccount')),true),
              history=history||jsonb_build_array(CAST({envelope} AS jsonb))
            WHERE id={value.LocationId}
            """, token);
        if (count != 1) throw new DbUpdateConcurrencyException("Compact24 containing record is unavailable.");
    }
}

internal sealed class ContractPaymentModeRow
{
    public Guid Id { get; set; }
    public string? PaymentMode { get; set; }
    public bool IsDevelopmentDemo { get; set; }
    internal string EffectiveMode => PaymentMode ?? (IsDevelopmentDemo ? "Test" : "Live");
}

internal sealed class LocationAccountRow
{
    public Guid Id { get; set; }
    public Guid LocationId { get; set; }
    public string BankIdentifier { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public bool Enabled { get; set; }
    public bool IsDevelopmentDemo { get; set; }
    public int Version { get; set; }
    public Guid ConfirmedByUserId { get; set; }
    public DateTimeOffset ConfirmedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
