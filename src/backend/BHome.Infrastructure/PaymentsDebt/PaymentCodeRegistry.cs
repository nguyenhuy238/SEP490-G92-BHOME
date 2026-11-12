using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class PaymentCodeRegistry(Compact24DbContext db, IPaymentRepository payments, SePayOptions options) : IPaymentCodeRegistry
{
    public Task<string?> GetAsync(string kind, Guid id, CancellationToken token) => db.Database.SqlQuery<string>($"""
        SELECT task_data->'state'->>'code' AS "Value" FROM operational_tasks WHERE task_data->>'recordType'='PaymentCodeV1'
          AND task_data->'state'->>'kind'={kind} AND task_data->'state'->>'obligationId'={id.ToString()} AND task_data->'state'->>'mode'={options.Mode}
        """).SingleOrDefaultAsync(token);
    public async Task<string?> IssueAsync(string kind, Guid id, Guid locationId, CancellationToken token)
    {
        if (!options.Enabled) return await GetAsync(kind, id, token);
        if (kind is not ("Invoice" or "Deposit") || id == Guid.Empty) throw new PaymentException(400, "invalid_payment_obligation");
        return await payments.TransactionAsync<string?>(null, null, async () =>
        {
            if (await GetAsync(kind, id, token) is { } existing) return existing;
            var account = await payments.ReceivingAccountAsync(locationId, token);
            if (account is null || !account.Enabled || account.IsDevelopmentDemo != (options.Mode == "Test") ||
                !options.ReceivingAccounts.Any(a => a.LocationId == locationId && a.BankIdentifier == account.BankIdentifier && a.AccountNumber == account.AccountNumber)) return null;
            for (var attempt = 0; attempt < 32; attempt++)
            {
                var code = options.PaymentCodePrefix + RandomNumberGenerator.GetInt32(100_000_000).ToString("D8", System.Globalization.CultureInfo.InvariantCulture);
                var data = JsonSerializer.Serialize(new PaymentCode(code, options.Mode, kind, id, locationId), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                var inserted = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
                    VALUES({Guid.NewGuid()},'COMMAND',{locationId},{"payment-code:" + code},'Issued',jsonb_build_object('recordType','PaymentCodeV1','state',CAST({data} AS jsonb)))
                    ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
                    """, token);
                if (inserted == 1) return code;
            }
            throw new PaymentException(503, "payment_code_generation_unavailable");
        }, token);
    }
    public async Task<bool> MatchesAsync(string kind, Guid id, string description, CancellationToken token)
    {
        var codes = Regex.Matches(description.ToUpperInvariant(), "(?<![A-Z0-9])BH[0-9]{8}(?![A-Z0-9])").Select(m => m.Value).Distinct().ToArray();
        if (codes.Length != 1) return false;
        return await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE source_key={"payment-code:" + codes[0]} AND task_data->>'recordType'='PaymentCodeV1'
              AND task_data->'state'->>'kind'={kind} AND task_data->'state'->>'obligationId'={id.ToString()}) AS "Value"
            """).SingleAsync(token);
    }
}
