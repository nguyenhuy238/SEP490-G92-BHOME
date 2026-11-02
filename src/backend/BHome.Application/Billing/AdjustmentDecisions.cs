using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Billing;

public sealed partial class AdjustmentService
{
    public async Task<AdjustmentView> DecideAsync(Guid id, bool approve, AdjustmentDecisionInput input, Guid key, CancellationToken t)
    {
        _ = Scope; if (!Scope.Owner) throw new AdjustmentException(403, "adjustment_owner_required");
        var x = input with { Reason = input.Reason?.Trim() ?? "", ChargeCode = string.IsNullOrWhiteSpace(input.ChargeCode) ? null : input.ChargeCode.Trim() };
        if (!x.HumanConfirmed || x.ExpectedVersion != 1 || x.ExpectedInvoiceVersion < 1 || x.ExpectedFinancialVersion < 0 ||
            x.Reason.Length is < 1 or > 2000 || x.ChargeCode?.Length > 50 ||
            approve && (x.CorrectedAmount is null || !AdjustmentRules.Money(x.CorrectedAmount.Value)))
            throw new AdjustmentException(400, "invalid_adjustment_decision");
        if (x.CorrectedAmount is { } value) x = x with { CorrectedAmount = decimal.Truncate(value) };
        var initial = await Request(id, t); _ = await Invoice(initial.InvoiceId, t);
        return await repository.TransactionAsync(initial.InvoiceId, async () =>
        {
            var command = new { id, approve, x };
            if (await Replay(key, "decision", command, t) is { } prior) return await GetAsync(prior, t);
            var request = await Request(id, t); var invoice = await Invoice(request.InvoiceId, t);
            if (request.Decision is not null) throw new AdjustmentException(409, "adjustment_already_decided");
            var financial = await repository.FinancialsAsync(invoice.Id, t);
            var decision = new InvoiceAdjustmentDecision
            {
                RequestId = id,
                InvoiceId = invoice.Id,
                Outcome = approve ? "Approved" : "Rejected",
                InvoiceStatus = invoice.Status,
                Reason = x.Reason,
                OwnerId = Actor,
                DecidedAt = Now,
                EffectiveBefore = financial.EffectivePayableAmount,
                EffectiveAfter = financial.EffectivePayableAmount,
                BeforeAmount = financial.EffectivePayableAmount,
                PaidAtDecision = financial.AllocatedPayments
            };
            if (approve)
            {
                if (request.InvoiceStatus != invoice.Status || invoice.Version != x.ExpectedInvoiceVersion || x.ExpectedFinancialVersion != financial.FinancialVersion)
                    throw new AdjustmentException(409, "adjustment_invoice_changed");
                var code = request.ChargeCode ?? x.ChargeCode;
                if (request.ChargeCode is not null && x.ChargeCode is not null && request.ChargeCode != x.ChargeCode)
                    throw new AdjustmentException(400, "adjustment_charge_not_found");
                var line = code is null ? null : invoice.Lines.SingleOrDefault(l => l.ChargeCode == code) ?? throw new AdjustmentException(400, "adjustment_charge_not_found");
                if (invoice.Status == InvoiceStatus.Draft && line is null) throw new AdjustmentException(400, "adjustment_draft_charge_required");
                decision.ChargeCode = line?.ChargeCode;
                decision.BeforeAmount = line is null ? financial.EffectivePayableAmount : line.Amount + (invoice.Status == InvoiceStatus.Final ? await repository.ChargeAdjustmentsAsync(invoice.Id, line.ChargeCode, t) : 0);
                decision.CorrectedAmount = x.CorrectedAmount;
                decision.Delta = x.CorrectedAmount!.Value - decision.BeforeAmount; decision.EffectiveAfter = financial.EffectivePayableAmount + decision.Delta;
                if (!AdjustmentRules.Money(decision.EffectiveAfter)) throw new AdjustmentException(400, "adjustment_amount_out_of_range");
                if (invoice.Status == InvoiceStatus.Draft)
                {
                    decision.SourceFingerprint = AdjustmentRules.SourceFingerprint(line!);
                    line!.CalculatedAmount ??= line.Amount; line.Amount = x.CorrectedAmount.Value; line.CorrectionRequestId = id;
                    invoice.Total = invoice.Lines.Sum(l => l.Amount); invoice.Version++;
                }
            }
            repository.Add(decision); request.Decision = decision;
            Remember(key, "decision", command, id);
            repository.Add(new InvoiceAdjustmentEvent
            {
                RequestId = id,
                InvoiceId = invoice.Id,
                RequesterId = request.RequesterId,
                Name = "invoice.adjustment.decided.v1",
                OccurredAt = Now
            });
            repository.Audit(Actor, approve ? "InvoiceAdjustmentApproved" : "InvoiceAdjustmentRejected", id, Now);
            var balance = AdjustmentRules.Balance(financial.OriginalIssuedAmount, financial.ApprovedAdjustmentTotal +
                (approve && invoice.Status == InvoiceStatus.Final ? decision.Delta : 0), financial.AllocatedPayments);
            var after = financial with
            {
                EffectivePayableAmount = balance.Payable,
                OutstandingAmount = balance.Outstanding,
                PotentialExcessAmount = balance.Excess,
                ApprovedAdjustmentTotal = financial.ApprovedAdjustmentTotal + (approve && invoice.Status == InvoiceStatus.Final ? decision.Delta : 0),
                FinancialVersion = financial.FinancialVersion + (approve && invoice.Status == InvoiceStatus.Final ? 1 : 0),
                ReviewStatus = balance.Excess > 0 ? "PendingReview" : "None"
            };
            if (invoice.Status == InvoiceStatus.Draft) after = after with { OriginalIssuedAmount = invoice.Total, EffectivePayableAmount = invoice.Total, OutstandingAmount = invoice.Total };
            return View(request, invoice, after);
        }, t);
    }
}
