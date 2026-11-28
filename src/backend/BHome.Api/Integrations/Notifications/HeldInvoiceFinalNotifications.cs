using BHome.Domain.Billing;

namespace BHome.Infrastructure.Modules.Notifications;

// A held Final notice is deduplicated per invoice, not per adjustment request.
// The original request ID is only a durable anchor; later pending requests on the
// same invoice must keep the notice actionable and externally relevant.
internal static class HeldInvoiceFinalNotifications
{
    internal static IQueryable<InvoiceAdjustment> PendingForInvoice(
        IQueryable<InvoiceAdjustment> requests, Guid invoiceId) =>
        requests.Where(r => r.InvoiceId == invoiceId && r.Decision == null)
            .OrderBy(r => r.SubmittedAt).ThenBy(r => r.Id);

    internal static IQueryable<InvoiceAdjustment> StillHeldForOriginal(
        IQueryable<InvoiceAdjustment> requests, Guid originalRequestId, DateOnly today) =>
        requests.Where(r => r.Id == originalRequestId && r.Invoice.Status == InvoiceStatus.Draft &&
            r.Invoice.ScheduledFinalDate <= today &&
            requests.Any(pending => pending.InvoiceId == r.InvoiceId && pending.Decision == null));
}
