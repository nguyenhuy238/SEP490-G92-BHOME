using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class PaymentCodeRegistry(BHomePersistenceContext db, IPaymentRepository payments, SePayOptions options, ISePayOwnerConnections connections) : IPaymentCodeRegistry
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task FreezeAsync(Guid invoiceId, Guid locationId, CancellationToken token)
    {
        if (db is not Compact24DbContext || await ContextAsync("Invoice", invoiceId, token) is not null || await FrozenAsync("Invoice", invoiceId, token) is not null) return;
        await connections.ApplyLocationAsync(locationId, token);
        var mode = await ModeAsync("Invoice", invoiceId, locationId, token);
        var account = await payments.ReceivingAccountForModeAsync(locationId, mode, token);
        var state = JsonSerializer.Serialize(new PaymentCode("", mode, "Invoice", invoiceId, locationId, account, SnapshotPending: account is null), Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
            VALUES({Guid.NewGuid()},'COMMAND',{locationId},{"payment-obligation:Invoice:" + invoiceId},'Frozen',
                jsonb_build_object('recordType','PaymentObligationV1','state',CAST({state} AS jsonb)))
            ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING
            """, token);
    }
    public async Task<PaymentCode?> ContextAsync(string kind, Guid id, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks WHERE task_data->>'recordType'='PaymentCodeV1'
              AND task_data->'state'->>'kind'={kind} AND task_data->'state'->>'obligationId'={id.ToString()}
            """).ToArrayAsync(token);
        if (rows.Length > 1) throw new PaymentException(409, "legacy_payment_mode_ambiguous");
        return rows.Length == 0 ? null : JsonSerializer.Deserialize<PaymentCode>(rows[0], Json);
    }
    public async Task<string?> GetAsync(string kind, Guid id, CancellationToken token) => (await ContextAsync(kind, id, token))?.Code;
    public async Task<string?> PersistedModeAsync(string kind, Guid id, CancellationToken token) =>
        (await ContextAsync(kind, id, token) ?? await FrozenAsync(kind, id, token))?.Mode;
    private async Task<PaymentCode?> FrozenAsync(string kind, Guid id, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var data = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks WHERE source_key={"payment-obligation:" + kind + ":" + id}
              AND task_data->>'recordType'='PaymentObligationV1'
            """).SingleOrDefaultAsync(token);
        return data is null ? null : JsonSerializer.Deserialize<PaymentCode>(data, Json);
    }
    private async Task<string> ModeAsync(string kind, Guid id, Guid locationId, CancellationToken token)
    {
        if (await ContextAsync(kind, id, token) is { } issued) return issued.Mode;
        if (await FrozenAsync(kind, id, token) is { } frozen)
            return frozen.Mode is "Test" or "Live" ? frozen.Mode : throw new PaymentException(409, "legacy_payment_mode_ambiguous");
        if (kind is "Deposit" or "MainInitial")
        {
            if (db is Compact24DbContext)
            {
                var source = await PaymentObligationQueries.ContractModes(db).SingleOrDefaultAsync(c => c.Id == id, token)
                    ?? throw new PaymentException(404, "contract_not_found");
                return source.PaymentMode ?? (!options.DualMode ? options.Mode : source.EffectiveMode);
            }
            var contract = await payments.HoldingAsync(id, token) ?? throw new PaymentException(404, "contract_not_found");
            return contract.PaymentMode ?? (!options.DualMode ? options.Mode : BHome.Application.Contracts.ContractPaymentModes.Of(contract));
        }
        if (kind == "Settlement")
        {
            var mode = await db.Database.SqlQuery<string>($"""
                SELECT COALESCE(h->'state'->>'paymentMode',CASE WHEN COALESCE((h->'state'->>'isDevelopmentDemo')::bool,false) THEN 'Test' ELSE 'Live' END) AS "Value"
                FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                WHERE h->>'recordType'='SettlementReceivableV1' AND h->'state'->>'id'={id.ToString()}
                """).SingleOrDefaultAsync(token);
            if (mode is not null) return mode;
        }
        var owner = await payments.ReceivingOwnerAsync(locationId, token);
        if (owner is not null && await payments.OwnerPaymentModeAsync(owner.Value, token) is { } selected) return selected;
        if (kind == "Invoice")
        {
            if (db is Compact24DbContext)
            {
                var contractId = await db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Id == id).Select(i => i.ContractId).SingleAsync(token);
                var source = await PaymentObligationQueries.ContractModes(db).SingleOrDefaultAsync(c => c.Id == contractId, token);
                if (source is not null && (source.PaymentMode is not null || source.IsDevelopmentDemo)) return source.EffectiveMode;
            }
            else
            {
                var contract = await db.Set<Invoice>().Where(i => i.Id == id).Select(i => i.RepresentativeContractId).SingleAsync(token);
                var source = await payments.HoldingAsync(contract, token);
                if (source is not null && (source.PaymentMode is not null || source.IsDevelopmentDemo)) return BHome.Application.Contracts.ContractPaymentModes.Of(source);
            }
        }
        return options.Enabled ? options.Mode : (await payments.ReceivingAccountAsync(locationId, token))?.IsDevelopmentDemo == true ? "Test" : "Live";
    }
    public async Task<BHome.Domain.PaymentsDebt.ReceivingBankAccount?> AccountAsync(string kind, Guid id, Guid locationId, CancellationToken token)
    {
        await connections.ApplyLocationAsync(locationId, token);
        if (await ContextAsync(kind, id, token) is { } issued) return issued.AccountSnapshot ?? throw new PaymentException(409, "payment_snapshot_unavailable");
        if (await FrozenAsync(kind, id, token) is { } frozen) return frozen.AccountSnapshot ?? (frozen.SnapshotPending
            ? await payments.ReceivingAccountForModeAsync(locationId, frozen.Mode, token) : throw new PaymentException(409, "payment_snapshot_unavailable"));
        return await payments.ReceivingAccountForModeAsync(locationId, await ModeAsync(kind, id, locationId, token), token);
    }
    public async Task<string?> IssueAsync(string kind, Guid id, Guid locationId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        await connections.ApplyLocationAsync(locationId, token);
        if (!options.Enabled) return await GetAsync(kind, id, token);
        if (kind is not ("Invoice" or "Deposit" or "MainInitial" or "Settlement") || id == Guid.Empty) throw new PaymentException(400, "invalid_payment_obligation");
        async Task<string?> Issue()
        {
            if (await ContextAsync(kind, id, token) is { } issued)
                return options.Owns(issued) ? issued.Code : throw new PaymentException(409, "legacy_payment_code_route_required");
            var mode = await ModeAsync(kind, id, locationId, token);
            var provider = options.For(mode);
            var account = await AccountAsync(kind, id, locationId, token);
            if (account is null || !account.Enabled || account.IsDevelopmentDemo != (mode == "Test") ||
                !provider.Enabled || !provider.Matches(locationId, account)) return null;
            // Even an existing code is not payable while the receiving account no
            // longer matches SePay. Retain the registry mapping for later recovery.
            if (await GetAsync(kind, id, token) is { } existing) return existing;
            for (var attempt = 0; attempt < 32; attempt++)
            {
                var code = options.DualMode
                    ? "BH" + options.InstanceCode + (mode == "Test" ? "T" : "L") + Convert.ToHexString(RandomNumberGenerator.GetBytes(8))
                    : options.PaymentCodePrefix + RandomNumberGenerator.GetInt32(100_000_000).ToString("D8", System.Globalization.CultureInfo.InvariantCulture);
                var data = JsonSerializer.Serialize(new PaymentCode(code, mode, kind, id, locationId, account, options.DualMode ? options.InstanceCode : null), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                var inserted = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
                    VALUES({Guid.NewGuid()},'COMMAND',{locationId},{"payment-code:" + code},'Issued',jsonb_build_object('recordType','PaymentCodeV1','state',CAST({data} AS jsonb)))
                    ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
                    """, token);
                if (inserted == 1) return code;
            }
            throw new PaymentException(503, "payment_code_generation_unavailable");
        }
        return db.Database.CurrentTransaction is not null ? await Issue() : await payments.TransactionAsync<string?>(null, null, Issue, token);
    }
    public async Task<bool> MatchesAsync(string kind, Guid id, string description, CancellationToken token)
    {
        if (db is not Compact24DbContext) return false;
        var codes = Regex.Matches(description.ToUpperInvariant(), SePayService.PaymentCodePattern).Select(m => m.Value).Distinct().ToArray();
        if (codes.Length != 1) return false;
        return await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE source_key={"payment-code:" + codes[0]} AND task_data->>'recordType'='PaymentCodeV1'
              AND task_data->'state'->>'kind'={kind} AND task_data->'state'->>'obligationId'={id.ToString()}) AS "Value"
            """).SingleAsync(token);
    }
}
