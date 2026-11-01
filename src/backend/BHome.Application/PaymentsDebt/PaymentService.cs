using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Application.PropertyManagement;

namespace BHome.Application.PaymentsDebt;

public sealed class PaymentService(IPaymentRepository repository, ICurrentUser user, TimeProvider clock, PaymentRuntimeMode? mode = null)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new PaymentException(401, "authentication_required");
    private DateTimeOffset Now => PaymentRules.Timestamp(clock.GetUtcNow());
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(Now, "Asia/Ho_Chi_Minh").DateTime);
    private PaymentScope Scope => new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Tenant), user.IsInRole(Roles.Staff), Today);
    private void Owner() { _ = Actor; if (!user.IsInRole(Roles.Owner)) throw new PaymentException(403, "payment_owner_required"); }
    private static void Validate(object? value)
    {
        if (value is null || !Validator.TryValidateObject(value, new ValidationContext(value), [], true)) throw new PaymentException(400, "invalid_payment_input");
        foreach (var parameter in value.GetType().GetConstructors().OrderByDescending(c => c.GetParameters().Length).First().GetParameters())
            foreach (var annotation in parameter.GetCustomAttributes(typeof(ValidationAttribute), true).Cast<ValidationAttribute>())
                if (!annotation.IsValid(value.GetType().GetProperty(parameter.Name!)!.GetValue(value))) throw new PaymentException(400, "invalid_payment_input");
    }
    private static string Fingerprint(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private async Task<Guid?> Replay(Guid key, string operation, object input, CancellationToken t)
    {
        if (key == Guid.Empty) throw new PaymentException(400, "idempotency_key_required");
        var command = await repository.CommandAsync(Actor, key, operation, t);
        if (command is null) return null;
        if (command.Fingerprint != Fingerprint(input)) throw new PaymentException(409, "payment_idempotency_key_reused");
        return command.ResultId;
    }
    private void Remember(Guid key, string operation, object input, Guid result) => repository.Add(new PaymentCommand
    { ActorId = Actor, Key = key, Operation = operation, Fingerprint = Fingerprint(input), ResultId = result, CreatedAt = Now });
    private async Task<Invoice> Invoice(Guid id, CancellationToken t)
    {
        var scope = Scope;
        if (!scope.Owner && !scope.Tenant) throw new PaymentException(403, "payment_view_forbidden");
        return await repository.InvoiceAsync(id, scope, t) ?? throw new PaymentException(404, "payment_invoice_not_found");
    }
    public async Task<TransferView> RegisterAsync(PaymentTransferInput input, Guid key, CancellationToken t)
    {
        Owner(); Validate(input);
        var x = input with { ProviderIdentity = input.ProviderIdentity.Trim().ToUpperInvariant(), BankReference = input.BankReference.Trim(),
            TransferDescription = input.TransferDescription?.Trim() ?? "", StatementReference = input.StatementReference.Trim(),
            VerificationReason = input.VerificationReason.Trim(), OccurredAt = PaymentRules.Timestamp(input.OccurredAt) };
        if (!x.HumanVerified || !PaymentRules.ValidMoney(x.Amount) || x.Currency != "VND" || x.OccurredAt == default || x.OccurredAt > Now ||
            !PaymentRules.ValidReference(x.BankReference) || !Regex.IsMatch(x.ProviderIdentity, "^[A-Z0-9][A-Z0-9:-]{0,79}$") ||
            x.StatementReference.Length == 0 || x.VerificationReason.Length == 0 || x.ProposedInvoiceId == Guid.Empty || x.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true)
            throw new PaymentException(400, "invalid_verified_bank_transfer");
        var normalized = PaymentRules.NormalizeReference(x.BankReference);
        var identity = new { x.ProviderIdentity, Reference = normalized, Amount = x.Amount.ToString("0", CultureInfo.InvariantCulture),
            x.Currency, x.OccurredAt, Description = x.TransferDescription.ToUpperInvariant(), x.StatementReference, x.VerificationReason, x.ProposedInvoiceId, x.IsDevelopmentDemo };
        // Serializes bank identities across commands without a fictitious financial effect.
        return await repository.TransactionAsync<TransferView>(null, x.ProposedInvoiceId, async () =>
        {
            if (await Replay(key, "register", identity, t) is { } prior) return await TransferAsync(prior, t);
            var existing = await repository.TransferReferenceAsync(x.ProviderIdentity, normalized, t);
            if (existing is not null)
            {
                if (existing.Amount != x.Amount || existing.OccurredAt != x.OccurredAt || existing.TransferDescription.ToUpperInvariant() != x.TransferDescription.ToUpperInvariant() ||
                    existing.ProposedInvoiceId != x.ProposedInvoiceId) throw new PaymentException(409, "bank_transaction_identity_conflict");
                Remember(key, "register", identity, existing.Id); return await TransferAsync(existing.Id, t);
            }
            if (x.ProposedInvoiceId is { } invoiceId && (await Invoice(invoiceId, t)).Status != InvoiceStatus.Final)
                throw new PaymentException(409, "final_invoice_required");
            var transfer = new PaymentTransfer { ProviderIdentity = x.ProviderIdentity, BankReference = x.BankReference,
                NormalizedReference = normalized, Amount = x.Amount, Currency = x.Currency, OccurredAt = x.OccurredAt,
                TransferDescription = x.TransferDescription, StatementReference = x.StatementReference, VerificationReason = x.VerificationReason,
                VerifiedByUserId = Actor, VerifiedAt = Now, ProposedInvoiceId = x.ProposedInvoiceId, IsDevelopmentDemo = x.IsDevelopmentDemo };
            repository.Add(transfer);
            var review = new PaymentReconciliation { TransferId = transfer.Id, InvoiceId = x.ProposedInvoiceId, Decision = "PendingReview",
                Reason = x.ProposedInvoiceId is null ? "unmatched_bank_transfer" : "owner_allocation_confirmation_required", ActorId = Actor, OccurredAt = Now };
            repository.Add(review); Remember(key, "register", identity, transfer.Id);
            repository.Audit(Actor, "BankTransferManuallyVerified", transfer.Id, Now);
            return View(transfer, null, review);
        }, t);
    }
    public async Task<PaymentReviewResult> AllocateAsync(Guid transferId, PaymentMatchInput x, Guid key, CancellationToken t)
    {
        Owner(); Validate(x);
        if (!x.HumanVerified || x.InvoiceId == Guid.Empty || x.PaidByUserId == Guid.Empty) throw new PaymentException(400, "allocation_confirmation_required");
        return await repository.TransactionAsync(transferId, x.InvoiceId, async () =>
        {
            if (await Replay(key, "allocate", new { transferId, x }, t) is not null)
                return await Outcome(transferId, t);
            var transfer = await repository.TransferAsync(transferId, t) ?? throw new PaymentException(404, "bank_transfer_not_found");
            var allocated = await repository.AllocationAsync(transferId, t);
            if (allocated is not null)
            {
                if (allocated.InvoiceId != x.InvoiceId || allocated.PaidByUserId != x.PaidByUserId) throw new PaymentException(409, "bank_transaction_already_allocated");
                Remember(key, "allocate", new { transferId, x }, allocated.Id); return new PaymentReviewResult("Allocated", "verified_full_payment", transferId, x.InvoiceId);
            }
            var invoice = await Invoice(x.InvoiceId, t);
            if (invoice.Status != InvoiceStatus.Final) throw new PaymentException(409, "final_invoice_required");
            var latest = await repository.LatestReviewAsync(transferId, t);
            if (latest?.Decision == "Rejected") throw new PaymentException(409, "bank_transfer_rejected");
            if (x.PaidByUserId is { } payer && !await repository.EligiblePayerAsync(invoice.Id, payer, t))
                throw new PaymentException(400, "payer_not_invoice_viewer");
            var outstanding = invoice.Total - await repository.AllocatedAsync(invoice.Id, t);
            var reason = PaymentRules.ReviewReason(transfer.Amount, outstanding, transfer.TransferDescription,
                PaymentRules.InvoiceReference(invoice.Id), await repository.ReferenceClaimedAsync(transfer.NormalizedReference, t));
            var review = new PaymentReconciliation { TransferId = transfer.Id, InvoiceId = invoice.Id, ActorId = Actor, OccurredAt = Now,
                Decision = reason is null ? "Allocated" : "PendingReview", Reason = reason ?? "verified_full_payment" };
            repository.Add(review);
            if (reason is null)
            {
                var allocation = new PaymentAllocation { TransferId = transfer.Id, InvoiceId = invoice.Id, Amount = transfer.Amount,
                    PaidByUserId = x.PaidByUserId, VerifiedByUserId = Actor, AllocatedAt = Now };
                repository.Add(allocation);
                repository.Add(new PaymentConfirmedEvent { AllocationId = allocation.Id, InvoiceId = invoice.Id, OccurredAt = Now });
                repository.Audit(Actor, "InvoicePaymentAllocated", allocation.Id, Now);
                Remember(key, "allocate", new { transferId, x }, allocation.Id);
            }
            else Remember(key, "allocate", new { transferId, x }, review.Id);
            return new PaymentReviewResult(review.Decision, review.Reason, transferId, invoice.Id);
        }, t);
    }
    private async Task<PaymentReviewResult> Outcome(Guid transferId, CancellationToken t)
    {
        var allocation = await repository.AllocationAsync(transferId, t);
        if (allocation is not null) return new("Allocated", "verified_full_payment", transferId, allocation.InvoiceId);
        var review = await repository.LatestReviewAsync(transferId, t) ?? throw new PaymentException(404, "bank_transfer_not_found");
        return new(review.Decision, review.Reason, transferId, review.InvoiceId);
    }
    public async Task<TransferView> TransferAsync(Guid id, CancellationToken t)
    {
        Owner(); var transfer = await repository.TransferAsync(id, t) ?? throw new PaymentException(404, "bank_transfer_not_found");
        return View(transfer, await repository.AllocationAsync(id, t), await repository.LatestReviewAsync(id, t));
    }
    private static void Query(PaymentQuery q)
    {
        if (q.Page < 1 || q.PageSize is < 1 or > 100 || q.Page > int.MaxValue / q.PageSize ||
            q.LocationId == Guid.Empty || q.RoomId == Guid.Empty || q.BillingPeriod is { Day: not 1 }) throw new PaymentException(400, "invalid_payment_query");
    }
    public Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t)
    { Owner(); Query(query); return repository.TransfersAsync(query, t); }
    public async Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t)
    {
        Owner(); Query(new() { Page = page, PageSize = pageSize });
        _ = await repository.TransferAsync(transferId, t) ?? throw new PaymentException(404, "bank_transfer_not_found");
        return await repository.ReviewsAsync(transferId, page, pageSize, t);
    }
    public Task<PaymentReviewResult> RejectAsync(Guid transferId, PaymentRejectInput x, Guid key, CancellationToken t)
    {
        Owner(); Validate(x); var reason = x.Reason.Trim();
        return repository.TransactionAsync<PaymentReviewResult>(transferId, null, async () =>
        {
            if (await Replay(key, "reject", new { transferId, reason }, t) is not null) return await Outcome(transferId, t);
            _ = await repository.TransferAsync(transferId, t) ?? throw new PaymentException(404, "bank_transfer_not_found");
            if (await repository.AllocationAsync(transferId, t) is not null) throw new PaymentException(409, "allocated_payment_cannot_be_rejected");
            var latest = await repository.LatestReviewAsync(transferId, t);
            if (latest?.Decision == "Rejected" && latest.Reason != reason) throw new PaymentException(409, "bank_transfer_rejected");
            if (latest?.Decision != "Rejected")
            {
                repository.Add(new PaymentReconciliation { TransferId = transferId, InvoiceId = latest?.InvoiceId, Decision = "Rejected", Reason = reason, ActorId = Actor, OccurredAt = Now });
                repository.Audit(Actor, "BankTransferAllocationRejected", transferId, Now);
            }
            Remember(key, "reject", new { transferId, reason }, transferId);
            return new("Rejected", reason, transferId, latest?.InvoiceId);
        }, t);
    }
    private static TransferView View(PaymentTransfer transfer, PaymentAllocation? allocation, PaymentReconciliation? review) =>
        new(transfer.Id, transfer.ProviderIdentity, transfer.BankReference, transfer.Amount, transfer.Currency, transfer.OccurredAt,
            transfer.TransferDescription, transfer.StatementReference, transfer.VerificationReason, transfer.VerifiedByUserId, transfer.VerifiedAt,
            transfer.ProposedInvoiceId, allocation is not null ? "Allocated" : review?.Decision ?? "PendingReview",
            allocation is not null ? "verified_full_payment" : review?.Reason ?? "owner_allocation_confirmation_required", allocation?.InvoiceId, transfer.IsDevelopmentDemo);
    public async Task<InvoicePaymentView> InvoicePaymentAsync(Guid id, CancellationToken t)
    {
        var invoice = await Invoice(id, t);
        var scope = Scope;
        var history = await repository.HistoryAsync(id, t);
        var paid = history.Sum(entry => entry.Allocation.Amount);
        var outstanding = invoice.Total - paid;
        var payers = scope.Owner ? await repository.PayersAsync(id,t) : [];
        return new(id, invoice.Status != InvoiceStatus.Final ? "NotIssued" : outstanding <= 0 ? "Paid" : "Unpaid",
            invoice.Total, paid, outstanding, invoice.DueDate, invoice.Status == InvoiceStatus.Final ? PaymentRules.OverdueDays(invoice.DueDate, Today, outstanding) : 0,
            PaymentRules.InvoiceReference(invoice.Id), await repository.PendingReviewAsync(id, t),
            history.Select(entry => new PaymentHistoryView(entry.Allocation.Id, entry.Allocation.Amount, entry.Transfer.OccurredAt,
                entry.Allocation.PaidByUserId == Actor ? "Bạn" : entry.Allocation.PaidByUserId is not null ?
                    scope.Owner ? payers.FirstOrDefault(p=>p.UserId==entry.Allocation.PaidByUserId)?.DisplayLabel??"Khách thuê đã liên kết" : "Khách thuê khác trong hóa đơn" : "Chưa xác định người trả",
                scope.Owner ? entry.Allocation.PaidByUserId : null, entry.Transfer.VerificationSource, entry.Allocation.AllocatedAt)).ToArray());
    }
    public async Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid id,CancellationToken t)
    { Owner();_=await Invoice(id,t);return await repository.PayersAsync(id,t); }
}
