using System.Text.Json;
using BHome.Application.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal static class DepositReceiptRecords
{
    internal const string Kind = "DepositReceiptAllocationV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static async Task<DepositReceiptAllocation?> ReadAsync(BHomePersistenceContext db, Guid transferId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var value = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE p.id={transferId} AND h->>'recordType'={Kind}
            """).SingleOrDefaultAsync(token);
        return value is null ? null : JsonSerializer.Deserialize<DepositReceiptAllocation>(value, Json) ?? throw new PaymentException(409, "deposit_receipt_history_invalid");
    }
}
internal sealed partial class PaymentRepository
{
    public Task<bool> VerifiedReceiptAsync(Guid transferId, CancellationToken token) => db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM payments WHERE id={transferId} AND status='VERIFIED') AS \"Value\"").SingleAsync(token);
    public Task<ExternalPaymentPayer?> ExternalPayerAsync(Guid transferId, CancellationToken token) => ExternalPaymentPayerRecords.ReadAsync(db, transferId, token);
    public async Task<IReadOnlyList<DepositPayerChoice>> DepositPayersAsync(Guid contractId, CancellationToken token) => await db.Set<Resident>().AsNoTracking()
        .Where(r => r.VerificationStatus == IdentityVerificationStatus.Verified && db.Set<ContractResident>().Any(cr => cr.ContractId == contractId && cr.ResidentId == r.Id) &&
            (r.TenantUserId == null || db.Users.Any(u => u.Id == r.TenantUserId && u.IsActive) &&
                (from ur in db.UserRoles join role in db.Roles on ur.RoleId equals role.Id where ur.UserId == r.TenantUserId && role.Name == "Tenant" select ur.UserId).Any()))
        .OrderBy(r => r.Id).Select(r => new DepositPayerChoice(r.Id, r.TenantUserId, r.DisplayLabel)).ToArrayAsync(token);
    public async Task RecordDepositReceiptAsync(DepositReceiptAllocation record, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new PaymentException(503, "deposit_receipt_ledger_unavailable");
        var json = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = DepositReceiptRecords.Kind, recordKey = record.Id, state = record }, DepositReceiptRecords.Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments SET history=history||jsonb_build_array({json}::jsonb) WHERE id={record.TransferId}", token);
    }
}
