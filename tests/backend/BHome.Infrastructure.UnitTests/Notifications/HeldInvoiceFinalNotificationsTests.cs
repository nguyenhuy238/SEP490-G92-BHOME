using BHome.Domain.Billing;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.UnitTests.Notifications;

public sealed class HeldInvoiceFinalNotificationsTests
{
    [Fact]
    public void SharedPredicatesTranslateToPostgresSqlWithoutOpeningAConnection()
    {
        // ToQueryString only builds SQL; no Postgres instance or live connection is used.
        var options = new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=unused;Username=unused;Password=unused")
            .Options;
        using var db = new Compact24DbContext(options);
        var original = Guid.NewGuid();
        var heldSql = HeldInvoiceFinalNotifications.StillHeldForOriginal(
            db.Set<InvoiceAdjustmentRequest>(), original, new DateOnly(2026, 11, 16))
            .Select(r => r.Id).ToQueryString();
        Assert.Contains("EXISTS", heldSql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("invoice_id", heldSql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("decision", heldSql, StringComparison.OrdinalIgnoreCase);

        var pendingSql = HeldInvoiceFinalNotifications.PendingForInvoice(
            db.Set<InvoiceAdjustmentRequest>(), Guid.NewGuid())
            .Select(r => r.Id).ToQueryString();
        Assert.Contains("ORDER BY", pendingSql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("SubmittedAt", pendingSql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolvedOriginalDoesNotHideAnotherPendingRequestOnSameDueDraft()
    {
        var invoice = Invoice(new DateOnly(2026, 11, 15));
        var unrelated = Invoice(new DateOnly(2026, 11, 15));
        var first = Request(invoice, new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero),
            decided: true);
        var otherTenantPending = Request(invoice, new DateTimeOffset(2026, 11, 11, 8, 0, 0, TimeSpan.Zero));
        var unrelatedPending = Request(unrelated, new DateTimeOffset(2026, 11, 9, 8, 0, 0, TimeSpan.Zero));
        var all = new[] { unrelatedPending, otherTenantPending, first }.AsQueryable();

        Assert.True(HeldInvoiceFinalNotifications.StillHeldForOriginal(
            all, first.Id, new DateOnly(2026, 11, 16)).Any());

        // Owner notification points at a pending adjustment on the same invoice,
        // never an already-decided request or a different tenant's other invoice.
        Assert.Equal(otherTenantPending.Id, HeldInvoiceFinalNotifications.PendingForInvoice(
            all, invoice.Id).First().Id);
    }

    [Fact]
    public void MultiplePendingRequestsHaveDeterministicNextOwnerTarget()
    {
        var invoice = Invoice(new DateOnly(2026, 11, 15));
        var submittedAt = DateTimeOffset.Parse("2026-11-10T08:00:00Z");
        var first = Request(invoice, submittedAt);
        var second = Request(invoice, submittedAt);
        var third = Request(invoice, submittedAt.AddDays(1));
        var requests = new[] { third, second, first }.AsQueryable();

        Assert.Equal(new[] { first.Id, second.Id }.Order().Append(third.Id).ToArray(),
            HeldInvoiceFinalNotifications.PendingForInvoice(requests, invoice.Id)
                .Select(r => r.Id).ToArray());
    }

    [Fact]
    public void AllDecidedOrFinalizedOrNotYetDueMeansHeldNoticeIsNotExternallyRelevant()
    {
        var invoice = Invoice(new DateOnly(2026, 11, 17));
        var first = Request(invoice, DateTimeOffset.UtcNow, decided: true);
        var second = Request(invoice, DateTimeOffset.UtcNow);
        var requests = new[] { first, second }.AsQueryable();

        Assert.False(HeldInvoiceFinalNotifications.StillHeldForOriginal(
            requests, first.Id, new DateOnly(2026, 11, 16)).Any());
        invoice.ScheduledFinalDate = new DateOnly(2026, 11, 15);
        Assert.True(HeldInvoiceFinalNotifications.StillHeldForOriginal(
            requests, first.Id, new DateOnly(2026, 11, 16)).Any());
        second.Decision = new InvoiceAdjustmentDecision { RequestId = second.Id };
        Assert.False(HeldInvoiceFinalNotifications.StillHeldForOriginal(
            requests, first.Id, new DateOnly(2026, 11, 16)).Any());
        Assert.Empty(HeldInvoiceFinalNotifications.PendingForInvoice(requests, invoice.Id));
        second.Decision = null;
        invoice.Status = InvoiceStatus.Final;
        Assert.False(HeldInvoiceFinalNotifications.StillHeldForOriginal(
            requests, first.Id, new DateOnly(2026, 11, 16)).Any());
    }

    [Fact]
    public void UnknownAnchorOrPendingRequestOnDifferentInvoiceCannotKeepOriginalHeld()
    {
        var invoice = Invoice(new DateOnly(2026, 11, 15));
        var other = Invoice(new DateOnly(2026, 11, 15));
        var first = Request(invoice, DateTimeOffset.UtcNow, decided: true);
        var onlyOtherPending = Request(other, DateTimeOffset.UtcNow);
        var requests = new[] { first, onlyOtherPending }.AsQueryable();
        var today = new DateOnly(2026, 11, 16);

        Assert.False(HeldInvoiceFinalNotifications.StillHeldForOriginal(requests, first.Id, today).Any());
        Assert.False(HeldInvoiceFinalNotifications.StillHeldForOriginal(requests, Guid.NewGuid(), today).Any());
        Assert.Empty(HeldInvoiceFinalNotifications.PendingForInvoice(requests, invoice.Id));
    }

    private static Invoice Invoice(DateOnly due) => new()
    {
        Status = InvoiceStatus.Draft,
        ScheduledFinalDate = due
    };

    private static InvoiceAdjustmentRequest Request(Invoice invoice, DateTimeOffset submitted,
        bool decided = false)
    {
        var request = new InvoiceAdjustmentRequest
        {
            InvoiceId = invoice.Id,
            Invoice = invoice,
            SubmittedAt = submitted
        };
        if (decided) request.Decision = new InvoiceAdjustmentDecision { RequestId = request.Id };
        return request;
    }
}
