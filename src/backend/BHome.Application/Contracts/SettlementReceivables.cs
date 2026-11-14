using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.Contracts;

public sealed record DamageChargeInput(string ExpectedReference, Guid InspectionId, int InspectionVersion,
    Guid? AssetId, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Description, Guid[] EvidenceIds, bool HumanConfirmed);
public sealed record DepositOffsetInput(string ExpectedReference, Guid? ReceivableId, Guid? InvoiceId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount, string Reason, bool HumanConfirmed);
public sealed record SettlementReceivable(Guid Id, Guid ContractId, Guid RoomId, string Kind, string SourceKey,
    Guid InspectionId, int InspectionVersion, Guid? AssetId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount, string Description,
    string CalculationPolicy, IReadOnlyList<DeductionEvidence> Evidence, Guid[] RecipientUserIds,
    Guid ApprovedByUserId, DateTimeOffset ApprovedAt, Guid OperationKey, string Fingerprint, bool IsDevelopmentDemo = false,
    SettlementUtilitySource? Utility = null, BHome.Application.Billing.FixedChargeSource? FixedCharge = null);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record DepositOffsetApproval(Guid Id, Guid ContractId, Guid SourceDepositContractId,
    Guid? ReceivableId, Guid? InvoiceId, decimal Amount, string Reason, Guid ApprovedByUserId,
    DateTimeOffset ApprovedAt, Guid AllocationId, Guid OperationKey, string Fingerprint, string SourceReference, string SourceSnapshot, bool IsDevelopmentDemo = false);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record SettlementOffsetInvoice(Guid Id, DateOnly BillingPeriod, decimal Payable, decimal Allocated, decimal Outstanding);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record SettlementReceivableBalance(SettlementReceivable Charge, decimal Allocated, decimal Outstanding, string Status);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record SettlementReceivablesView(Guid ContractId, Guid RoomId, string Reference,
    decimal AvailableDeposit, IReadOnlyList<SettlementReceivableBalance> Receivables,
    IReadOnlyList<DepositOffsetApproval> Offsets, string RoomNumber = "", IReadOnlyList<SettlementOffsetInvoice>? Invoices = null,
    IReadOnlyList<PayerChoice>? Payers = null);
public sealed record SettlementReceivablePage(IReadOnlyList<SettlementReceivablesView> Items, int Page, int PageSize, int Total);
public sealed record SettlementChargeContext(SettlementReceivablesView View, Guid DepositContractId,
    Guid InspectionId, int InspectionVersion, bool InspectionConfirmed, bool NoAdditionalCharges,
    Guid[] AssetIds, Guid[] EvidenceIds, Guid[] RecipientUserIds, bool HasLegacyDeductions, bool IsDevelopmentDemo = false);
public interface ISettlementReceivablesRepository
{
    Task<T> TransactionAsync<T>(Guid contractId, Func<Task<T>> work, CancellationToken token);
    Task<bool> CanReadAsync(Guid contractId, Guid userId, bool owner, CancellationToken token);
    Task<(Guid[] Ids, int Total)> TenantContractsAsync(Guid userId, int page, int pageSize, CancellationToken token);
    Task<SettlementChargeContext> ContextAsync(Guid contractId, CancellationToken token);
    Task<SettlementReceivable?> ChargeOperationAsync(Guid actor, Guid key, CancellationToken token);
    Task<DepositOffsetApproval?> OffsetOperationAsync(Guid actor, Guid key, CancellationToken token);
    Task<decimal?> InvoiceOutstandingAsync(Guid contractId, Guid invoiceId, CancellationToken token);
    Task SaveChargeAsync(SettlementReceivable charge, CancellationToken token);
    Task SaveOffsetAsync(DepositOffsetApproval approval, CancellationToken token);
    Task<SettlementBankAllocationResult?> BankOperationAsync(Guid actor, Guid key, CancellationToken token);
    Task SaveBankResultAsync(SettlementBankAllocationResult result, CancellationToken token);
    Task<Guid> LocationAsync(Guid contractId, CancellationToken token);
    Task<FinalUtilityContext> FinalUtilityAsync(Guid contractId, BHome.Domain.Billing.UtilityType type, CancellationToken token);
    Task<FinalFixedChargeContext> FinalFixedAsync(Guid contractId, CancellationToken token);
    Task<SettlementChargeReviewContext> ChargeReviewAsync(Guid contractId, CancellationToken token);
    Task<SettlementChargeReview?> ReviewOperationAsync(Guid actor, Guid key, CancellationToken token);
    Task SaveReviewAsync(SettlementChargeReview review, CancellationToken token);
}

public sealed partial class SettlementReceivablesService(ISettlementReceivablesRepository repository,
    IDepositDeductionEvidence evidence, ICurrentUser user, TimeProvider clock, PaymentRuntimeMode? mode = null, IPaymentRepository? payments = null,
    ITransferQrGenerator? qr = null, ISettlementChargeEvidence? chargeEvidence = null,
    BHome.Application.Billing.IFixedChargeCoverage? fixedCoverage = null)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new ContractException(401, "authentication_required");
    private async Task AuthorizeAsync(Guid id, bool write, CancellationToken token)
    {
        var actor = Actor;
        if (write && !user.IsInRole(Roles.Owner) || !write && !user.IsInRole(Roles.Owner) && !user.IsInRole(Roles.Tenant))
            throw new ContractException(403, "settlement_owner_or_tenant_required");
        if (!await repository.CanReadAsync(id, actor, user.IsInRole(Roles.Owner), token)) throw ContractException.Missing();
    }
    public async Task<SettlementReceivablesView> GetAsync(Guid id, CancellationToken token)
    {
        await AuthorizeAsync(id, false, token);
        var context = await repository.ContextAsync(id, token);
        if (context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
        var view = context.View;
        if (user.IsInRole(Roles.Owner)) return view;
        var visible = view.Receivables.Where(r => r.Charge.RecipientUserIds.Contains(Actor)).ToArray();
        return view with
        {
            Receivables = visible.Select(r => r with { Charge = r.Charge with { RecipientUserIds = [], OperationKey = Guid.Empty, Fingerprint = "" } }).ToArray(),
            Offsets = view.Offsets.Where(o => o.ReceivableId is { } charge && visible.Any(r => r.Charge.Id == charge))
                .Select(o => o with { OperationKey = Guid.Empty, Fingerprint = "", SourceSnapshot = "" }).ToArray(),
            Invoices = null,
            Payers = null
        };
    }
    public async Task<SettlementReceivablePage> TenantListAsync(int page, int pageSize, CancellationToken token)
    {
        var actor = Actor;
        if (!user.IsInRole(Roles.Tenant)) throw new ContractException(403, "tenant_required");
        if (page < 1 || page > 100000 || pageSize is < 1 or > 25) throw ContractException.Invalid("invalid_pagination");
        var result = await repository.TenantContractsAsync(actor, page, pageSize, token);
        var views = new List<SettlementReceivablesView>();
        foreach (var id in result.Ids) views.Add(await GetAsync(id, token));
        return new(views, page, pageSize, result.Total);
    }
    private static string Fingerprint<T>(Guid id, T input) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { contractId = id, input })));
    public async Task<SettlementReceivable> ApproveDamageAsync(Guid id, DamageChargeInput input, Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || !input.HumanConfirmed || !PaymentRules.ValidMoney(input.Amount) ||
            string.IsNullOrWhiteSpace(input.Description) || input.Description.Length > 2000 ||
            string.IsNullOrWhiteSpace(input.ExpectedReference) || input.InspectionId == Guid.Empty || input.InspectionVersion < 1 ||
            input.AssetId == Guid.Empty || input.EvidenceIds is null || input.EvidenceIds.Length is < 1 or > 5 ||
            input.EvidenceIds.Any(e => e == Guid.Empty) || input.EvidenceIds.Distinct().Count() != input.EvidenceIds.Length)
            throw ContractException.Invalid("invalid_settlement_charge");
        input = input with { Description = input.Description.Trim(), EvidenceIds = input.EvidenceIds.Order().ToArray() };
        var fingerprint = Fingerprint(id, input);
        return await repository.TransactionAsync(id, async () =>
        {
            var previous = await repository.ChargeOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                if (previous.ContractId != id || previous.Fingerprint != fingerprint) throw ContractException.Conflict("settlement_idempotency_conflict");
                return previous;
            }
            await AuthorizeAsync(id, true, token);
            var context = await repository.ContextAsync(id, token);
            if (context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
            if (context.View.Reference != input.ExpectedReference) throw ContractException.Conflict("settlement_review_changed");
            if (!context.InspectionConfirmed || context.NoAdditionalCharges || context.HasLegacyDeductions ||
                context.InspectionId != input.InspectionId || context.InspectionVersion != input.InspectionVersion || context.RecipientUserIds.Length == 0)
                throw ContractException.Conflict("settlement_charge_not_ready");
            if (input.AssetId is { } asset && !context.AssetIds.Contains(asset) || input.EvidenceIds.Any(e => !context.EvidenceIds.Contains(e)))
                throw ContractException.Invalid("settlement_charge_source_invalid");
            // One approved damage source, independent of the amount of security deposit.
            var sourceKey = $"damage:{id:N}:{input.AssetId?.ToString("N") ?? "room"}";
            if (context.View.Receivables.Any(r => r.Charge.SourceKey == sourceKey)) throw ContractException.Conflict("settlement_source_already_charged");
            var proofs = await evidence.CaptureAsync(id, input.EvidenceIds, token);
            var charge = new SettlementReceivable(Guid.NewGuid(), id, context.View.RoomId, "TenantDamage", sourceKey,
                input.InspectionId, input.InspectionVersion, input.AssetId, input.Amount, input.Description,
                "OwnerApprovedInspectionDamage/v1", proofs, context.RecipientUserIds.Order().ToArray(), Actor, clock.GetUtcNow(), key, fingerprint, context.IsDevelopmentDemo);
            await repository.SaveChargeAsync(charge, token); return charge;
        }, token);
    }
    public async Task<DepositOffsetApproval> ApproveOffsetAsync(Guid id, DepositOffsetInput input, Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || !input.HumanConfirmed || !PaymentRules.ValidMoney(input.Amount) ||
            (input.ReceivableId is null) == (input.InvoiceId is null) || input.ReceivableId == Guid.Empty || input.InvoiceId == Guid.Empty ||
            string.IsNullOrWhiteSpace(input.ExpectedReference) || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000)
            throw ContractException.Invalid("invalid_deposit_offset");
        input = input with { Reason = input.Reason.Trim() }; var fingerprint = Fingerprint(id, input);
        return await repository.TransactionAsync(id, async () =>
        {
            var previous = await repository.OffsetOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                if (previous.ContractId != id || previous.Fingerprint != fingerprint) throw ContractException.Conflict("settlement_idempotency_conflict");
                return previous;
            }
            await AuthorizeAsync(id, true, token);
            var context = await repository.ContextAsync(id, token);
            if (context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
            if (context.View.Reference != input.ExpectedReference) throw ContractException.Conflict("settlement_review_changed");
            if (!context.InspectionConfirmed || context.HasLegacyDeductions || input.Amount > context.View.AvailableDeposit)
                throw ContractException.Conflict("deposit_offset_not_available");
            decimal? outstanding = input.ReceivableId is { } chargeId
                ? context.View.Receivables.SingleOrDefault(r => r.Charge.Id == chargeId)?.Outstanding
                : await repository.InvoiceOutstandingAsync(id, input.InvoiceId!.Value, token);
            if (outstanding is null || input.Amount > outstanding) throw ContractException.Conflict("deposit_offset_target_invalid");
            if (input.ReceivableId is { } sourceId)
            {
                var charge = context.View.Receivables.Single(r => r.Charge.Id == sourceId).Charge;
                await VerifyChargeAsync(charge, token);
            }
            var approval = new DepositOffsetApproval(Guid.NewGuid(), id, context.DepositContractId, input.ReceivableId, input.InvoiceId,
                input.Amount, input.Reason, Actor, clock.GetUtcNow(), Guid.NewGuid(), key, fingerprint, input.ExpectedReference,
                JsonSerializer.Serialize(new { context.DepositContractId, context.View.AvailableDeposit, input.ReceivableId, input.InvoiceId, OutstandingBefore = outstanding }), context.IsDevelopmentDemo);
            await repository.SaveOffsetAsync(approval, token); return approval;
        }, token);
    }
}
