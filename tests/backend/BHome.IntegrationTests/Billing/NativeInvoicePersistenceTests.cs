using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Billing;

[Trait("Category", "CompactPostgres")]
public sealed class NativeInvoicePersistenceTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    [CompactPostgresFact]
    public Task InvoiceSnapshotsAndDecisionReplay() =>
        new InvoiceApiTests(fixture.Capture).NativeInvoiceSnapshotsAndDecisionReplay();
}

public sealed partial class InvoiceApiTests
{
    internal async Task NativeInvoiceSnapshotsAndDecisionReplay()
    {
        var w = await Setup();
        var draft = await Ready(w);
        var rentId = draft.Lines.Single(l => l.ChargeCode == "RENT").Id;
        var request = await Request(w, draft);
        var path = $"/api/v1/invoice-adjustments/{request.Id}/approve";
        var input = new AdjustmentDecisionInput(1, draft.Version, 0, 2990000, "RENT",
            "Synthetic native correction", true);
        var key = Guid.NewGuid();
        var approved = await Success<AdjustmentView>(await AdjustmentPost(w.Owner.Client, path, input, key));
        var repeated = await Success<AdjustmentView>(await AdjustmentPost(w.Owner.Client, path, input, key));
        Assert.Equal(approved.Id, repeated.Id);
        Assert.Equal(approved.CurrentInvoice!.Version, repeated.CurrentInvoice!.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await AdjustmentPost(w.Owner.Client, path,
            input with { CorrectedAmount = 2980000 }, key)).StatusCode);

        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var corrected = await db.Set<Native.InvoiceItem>().AsNoTracking().SingleAsync(i => i.Id == rentId);
        var correction = corrected.CalculationSnapshot.GetProperty("compactState");
        Assert.Equal(2990000m, corrected.Amount);
        Assert.Equal(3000000m, correction.GetProperty("calculatedAmount").GetDecimal());
        Assert.Equal(request.Id, correction.GetProperty("correctionRequestId").GetGuid());
        var decision = await db.Set<Native.InvoiceAdjustment>().AsNoTracking().SingleAsync(r => r.Id == request.Id);
        Assert.Equal("APPROVED", decision.Status);
        Assert.Equal(-10000m, decision.ApprovedDeltaAmount);
        Assert.Equal(2, decision.History.GetArrayLength());
        Assert.Equal("InvoiceAdjustmentDecision", decision.History[1].GetProperty("recordType").GetString());
        Assert.True(decision.DecisionSnapshot!.Value.GetProperty("sequence").GetInt64() > 0);
        var policies = await db.Set<Native.BillingPolicy>().AsNoTracking().Where(p => p.LocationId == w.Location).ToArrayAsync();
        // Rent is the signed contract amount, not a use of the advertised rent policy.
        Assert.Null(policies.Single(p => p.ChargeCode == "RENT").FirstUsedAt);
        Assert.All(policies.Where(p => p.ChargeCode != "RENT"), p => Assert.NotNull(p.FirstUsedAt));

        var finalPath = $"/api/v1/invoices/{draft.Id}/finalize";
        var final = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync(finalPath,
            new InvoiceFinalizeInput(approved.CurrentInvoice.Version)));
        await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync(finalPath,
            new InvoiceFinalizeInput(approved.CurrentInvoice.Version)));
        var invoice = await db.Set<Native.Invoice>().AsNoTracking().SingleAsync(i => i.Id == draft.Id);
        Assert.Equal((short)InvoiceStatus.Final, invoice.Status);
        Assert.Equal(final.Version, invoice.Version);
        Assert.Equal(3111000m, invoice.BaseTotalAmount);
        Assert.Equal(new[] { w.Tenant.Id, w.OtherTenant.Id }.Order(), invoice.RecipientUserIds.Order());
        // Draft creation, utility refresh, approved correction, finalization.
        var invoiceHistory = invoice.History.EnumerateArray()
            .Where(h => h.GetProperty("recordType").GetString() == "Invoice").ToArray();
        Assert.Equal(4, invoiceHistory.Length);
        Assert.Equal((int)InvoiceStatus.Final, invoiceHistory[3].GetProperty("state").GetProperty("status").GetInt32());
        Assert.Equal(1, await db.Set<Native.Notification>().AsNoTracking()
            .CountAsync(n => n.RecordKind == "OUTBOX" && n.EventKey == "InvoiceIssuedEvent:" + draft.Id));
        Assert.Equal(1, await db.Set<Native.Notification>().AsNoTracking()
            .CountAsync(n => n.RecordKind == "AUDIT" && n.RelatedEntityId == draft.Id && n.NotificationType == "InvoiceFinalized"));
    }
}
