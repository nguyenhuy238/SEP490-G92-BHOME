using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.Billing;

public sealed partial class AdjustmentService(IAdjustmentRepository repository, ICurrentUser user, TimeProvider clock,
    IAdjustmentEvidenceFiles files, IContractImageValidator images, PermissionAccess permissions)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new AdjustmentException(401, "authentication_required");
    private InvoiceScope Scope
    {
        get
        {
            var actor = Actor;
            if (!user.IsInRole(Roles.Owner) && !user.IsInRole(Roles.Tenant)) throw new AdjustmentException(403, "adjustment_role_forbidden");
            return new(actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Tenant));
        }
    }
    private DateTimeOffset Now => PaymentRules.Timestamp(clock.GetUtcNow());
    private void Tenant() { _ = Scope; if (!user.IsInRole(Roles.Tenant)) throw new AdjustmentException(403, "adjustment_tenant_required"); }
    private async Task<Invoice> Invoice(Guid id, CancellationToken t)
    {
        var invoice = await repository.InvoiceAsync(id, Scope, t) ?? throw new AdjustmentException(404, "adjustment_invoice_not_found");
        var permission = Scope.Owner ? Permissions.InvoiceAdjustments.Approve : Permissions.InvoiceAdjustments.Request;
        // Tenant ID is used only after repository-confirmed InvoiceRecipients membership.
        if (!await permissions.CanAccessAsync(permission, new(invoice.LocationId, Scope.Owner ? null : Actor), t))
            throw new AdjustmentException(403, "adjustment_role_forbidden");
        return invoice;
    }
    private async Task<InvoiceAdjustmentRequest> Request(Guid id, CancellationToken t) =>
        await repository.RequestAsync(id, Scope, t) ?? throw new AdjustmentException(404, "adjustment_not_found");
    private static string Fingerprint(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private async Task<Guid?> Replay(Guid key, string operation, object input, CancellationToken t)
    {
        if (key == Guid.Empty) throw new AdjustmentException(400, "idempotency_key_required");
        var command = await repository.CommandAsync(Actor, key, operation, t);
        if (command is null) return null;
        if (command.Fingerprint != Fingerprint(input)) throw new AdjustmentException(409, "adjustment_idempotency_key_reused");
        return command.RequestId;
    }
    private void Remember(Guid key, string operation, object input, Guid requestId) => repository.Add(new InvoiceAdjustmentCommand
    { ActorId = Actor, Key = key, Operation = operation, Fingerprint = Fingerprint(input), RequestId = requestId, OccurredAt = Now });
    public async Task<AdjustmentView> SubmitAsync(Guid invoiceId, AdjustmentSubmit input, Guid key, CancellationToken t)
    {
        Tenant();
        var x = input with { Reason = input.Reason?.Trim() ?? "", EvidenceIds = input.EvidenceIds?.Distinct().Order().ToArray() ?? [] };
        if (x.Reason.Length is < 1 or > 2000 || x.EvidenceIds.Length > 5 || x.EvidenceIds.Contains(Guid.Empty) ||
            x.InvoiceLineId == Guid.Empty || x.ExpectedInvoiceVersion < 1 || x.ProposedAmount is { } proposed && !AdjustmentRules.Money(proposed))
            throw new AdjustmentException(400, "invalid_adjustment_request");
        if (x.ProposedAmount is { } proposedValue) x = x with { ProposedAmount = decimal.Truncate(proposedValue) };
        _ = await Invoice(invoiceId, t);
        return await repository.TransactionAsync(invoiceId, async () =>
        {
            var command = new { invoiceId, x };
            if (await Replay(key, "submit", command, t) is { } prior) return await GetAsync(prior, t);
            var invoice = await Invoice(invoiceId, t);
            if (invoice.Version != x.ExpectedInvoiceVersion) throw new AdjustmentException(409, "adjustment_invoice_changed");
            var line = x.InvoiceLineId is { } lineId ? invoice.Lines.SingleOrDefault(l => l.Id == lineId)
                ?? throw new AdjustmentException(400, "adjustment_charge_not_found") : null;
            var financial = await repository.FinancialsAsync(invoiceId, t);
            var evidence = await repository.EvidenceAsync(x.EvidenceIds, t);
            if (evidence.Length != x.EvidenceIds.Length || evidence.Any(e => e.InvoiceId != invoiceId || e.UploaderId != Actor || e.RequestId != null || !e.Uploaded || e.CleanupAfter <= Now))
                throw new AdjustmentException(400, "adjustment_evidence_invalid");
            var request = new InvoiceAdjustmentRequest
            {
                InvoiceId = invoiceId,
                RequesterId = Actor,
                InvoiceLineId = x.InvoiceLineId,
                ChargeCode = line?.ChargeCode,
                CurrentAmount = line is null ? financial.EffectivePayableAmount : line.Amount + (invoice.Status == InvoiceStatus.Final ? await repository.ChargeAdjustmentsAsync(invoiceId, line.ChargeCode, t) : 0),
                ProposedAmount = x.ProposedAmount is { } amount ? decimal.Truncate(amount) : null,
                Reason = x.Reason,
                InvoiceSnapshot = JsonSerializer.Serialize(new { Total = invoice.Total.ToString("0", System.Globalization.CultureInfo.InvariantCulture), invoice.Version, invoice.Status, Lines = InvoiceService.View(invoice).Lines }),
                InvoiceStatus = invoice.Status,
                InvoiceVersion = invoice.Version,
                FinancialVersion = financial.FinancialVersion,
                SubmittedAt = Now,
                Evidence = evidence.ToList()
            };
            foreach (var file in evidence) file.RequestId = request.Id;
            repository.Add(request); Remember(key, "submit", command, request.Id);
            repository.Add(new InvoiceAdjustmentEvent { RequestId = request.Id, InvoiceId = invoiceId, RequesterId = Actor, Name = "invoice.adjustment.requested.v1", OccurredAt = Now });
            repository.Audit(Actor, "InvoiceAdjustmentRequested", request.Id, Now);
            return View(request, invoice, financial);
        }, t);
    }
    public async Task<AdjustmentView> GetAsync(Guid id, CancellationToken t)
    {
        var request = await Request(id, t); var invoice = await Invoice(request.InvoiceId, t); var financial = await repository.FinancialsAsync(request.InvoiceId, t);
        var amount = request.ChargeCode is null ? financial.EffectivePayableAmount : invoice.Lines.SingleOrDefault(l => l.ChargeCode == request.ChargeCode)?.Amount;
        if (amount is not null && request.ChargeCode is not null && invoice.Status == InvoiceStatus.Final)
            amount += await repository.ChargeAdjustmentsAsync(invoice.Id, request.ChargeCode, t);
        return View(request, invoice, financial) with { CurrentChargeAmount = amount is { } current ? decimal.Truncate(current) : null };
    }
    public async Task<PagedResult<AdjustmentEffectView>> EffectsAsync(Guid invoiceId, int page, int pageSize, CancellationToken t)
    {
        _ = await Invoice(invoiceId, t);
        if (page < 1 || pageSize is < 1 or > 100 || page > int.MaxValue / pageSize) throw new AdjustmentException(400, "invalid_adjustment_query");
        return await repository.EffectsAsync(invoiceId, page, pageSize, t);
    }
    public async Task<PagedResult<AdjustmentView>> ListAsync(AdjustmentQuery q, CancellationToken t)
    {
        var scope = Scope;
        if (q.Page < 1 || q.PageSize is < 1 or > 100 || q.Page > int.MaxValue / q.PageSize || q.InvoiceId == Guid.Empty || q.RoomId == Guid.Empty ||
            q.LocationId == Guid.Empty || q.Status is not (null or "Pending" or "Approved" or "Rejected")) throw new AdjustmentException(400, "invalid_adjustment_query");
        var result = await repository.ListAsync(q, scope, t);
        var views = new List<AdjustmentView>();
        foreach (var request in result.Items) views.Add(View(request, request.Invoice));
        return new(views, q.Page, q.PageSize, result.TotalCount);
    }
    private static AdjustmentView View(InvoiceAdjustmentRequest r, Invoice i, InvoiceFinancialView? financial = null) => new(r.Id, r.InvoiceId, i.LocationName, i.RoomNumber, i.BillingPeriod,
        r.RequesterId, r.InvoiceLineId, r.ChargeCode, r.CurrentAmount, r.ProposedAmount, r.Reason, r.InvoiceSnapshot,
        r.InvoiceStatus.ToString(), r.InvoiceVersion, r.FinancialVersion, r.Decision?.Outcome ?? "Pending", r.Decision is null ? 1 : 2, r.SubmittedAt,
        r.Evidence.Select(e => new AdjustmentEvidenceView(e.Id, e.ContentType, e.Length)).ToArray(), InvoiceService.View(i),
        r.Decision is { } d ? new(d.Outcome, d.InvoiceStatus.ToString(), d.ChargeCode, d.BeforeAmount, d.CorrectedAmount, d.Delta,
            d.EffectiveBefore, d.EffectiveAfter, d.PaidAtDecision, d.Reason, d.OwnerId, d.DecidedAt) : null, financial?.FinancialVersion ?? 0, financial);
    public async Task<AdjustmentEvidenceView> UploadAsync(Guid invoiceId, Stream input, CancellationToken t)
    {
        Tenant(); _ = await Invoice(invoiceId, t);
        using var content = new MemoryStream(); var buffer = new byte[81920];
        int count;
        while ((count = await input.ReadAsync(buffer, t)) > 0)
        {
            if (content.Length + count > 5 * 1024 * 1024) throw new AdjustmentException(413, "adjustment_image_too_large");
            content.Write(buffer, 0, count);
        }
        var bytes = content.ToArray(); var mime = images.Validate(bytes);
        _ = await Invoice(invoiceId, t);
        return await files.UploadAsync(invoiceId, Actor, bytes, mime, t);
    }
    public async Task<string> CopyEvidenceAsync(Guid id, Guid evidenceId, Stream target, CancellationToken t)
    {
        var request = await Request(id, t); _ = await Invoice(request.InvoiceId, t);
        var file = request.Evidence.SingleOrDefault(e => e.Id == evidenceId && e.Uploaded)
            ?? throw new AdjustmentException(404, "adjustment_evidence_not_found");
        await files.CopyAsync(file.ObjectKey, target, t); return file.ContentType;
    }
}
