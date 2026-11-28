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
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var pending = await db.Set<InvoiceAdjustment>().AsNoTracking().SingleAsync(r => r.Id == request.Id);
        Assert.Equal(draft.Id, pending.InvoiceId);
        Assert.Equal(w.Tenant.Id, pending.RequesterId);
        Assert.Equal("REQUESTED", pending.Status);
        Assert.Null(pending.ApprovedDeltaAmount);
        Assert.Null(pending.DecidedByUserId);
        Assert.Null(pending.DecidedAt);
        Assert.Null(pending.DecisionReason);
        Assert.Null(pending.DecisionSnapshot);
        Assert.Equal(1, pending.History.GetArrayLength());
        var originalSnapshot = pending.RequestSnapshot.GetRawText();
        var originalHistory = pending.History[0].GetRawText();
        string[] requestFields =
        [
            "id", "createdAt", "updatedAt", "invoiceId", "requesterId", "invoiceLineId",
            "chargeCode", "currentAmount", "proposedAmount", "reason", "invoiceSnapshot",
            "invoiceStatus", "invoiceVersion", "financialVersion", "submittedAt"
        ];
        Assert.Equal(requestFields.Order(), pending.RequestSnapshot.GetProperty("compactState")
            .EnumerateObject().Select(p => p.Name).Order());
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

        // Business entities are now materialized directly from the physical tables.
        // Evidence identity and audit stamps still come from the latest typed history.
        var meters = await db.Set<Meter>().AsNoTracking().Where(m => m.RoomId == w.Room).ToArrayAsync();
        Assert.Equal(2, meters.Length);
        Assert.All(meters, m =>
        {
            Assert.Equal(MeterDisplay.Digital, m.Display);
            Assert.Equal(2, m.DecimalPlaces);
            Assert.True(m.CreatedAt > DateTimeOffset.UnixEpoch);
        });
        var meterIds = meters.Select(m => m.Id).ToArray();
        var readings = await db.Set<MeterReading>().AsNoTracking()
            .Where(r => meterIds.Contains(r.MeterId) && r.ReadingPurpose == ReadingPurpose.Periodic).ToArrayAsync();
        Assert.Equal(2, readings.Length);
        foreach (var reading in readings)
        {
            Assert.Equal(w.Period, reading.BillingPeriod);
            Assert.Contains(reading.Status, new[] { MeterReadingStatus.Confirmed, MeterReadingStatus.Corrected });
            Assert.NotEqual(Guid.Empty, reading.EvidenceId);
            Assert.Equal(reading.EvidenceId, reading.Evidence.GetProperty("id").GetGuid());
            Assert.Equal(reading.EvidenceId, reading.History.EnumerateArray().Last(h =>
                h.GetProperty("recordType").GetString() == "MeterReading").GetProperty("state").GetProperty("evidenceId").GetGuid());
            Assert.True(reading.CreatedAt > DateTimeOffset.UnixEpoch);
            Assert.Equal(w.Staff.Id, reading.ConfirmedByUserId);
        }
        var corrected = await db.Set<BHome.Domain.Billing.InvoiceItem>().AsNoTracking().SingleAsync(i => i.Id == rentId);
        var correction = corrected.CalculationSnapshot.GetProperty("compactState");
        Assert.Equal(2990000m, corrected.Amount);
        Assert.Equal(3000000m, correction.GetProperty("calculatedAmount").GetDecimal());
        Assert.Equal(request.Id, correction.GetProperty("correctionRequestId").GetGuid());
        var decision = await db.Set<InvoiceAdjustment>().AsNoTracking().SingleAsync(r => r.Id == request.Id);
        Assert.Equal("APPROVED", decision.Status);
        Assert.Equal(-10000m, decision.ApprovedDeltaAmount);
        Assert.Equal(2, decision.History.GetArrayLength());
        Assert.Equal("InvoiceAdjustmentDecision", decision.History[1].GetProperty("recordType").GetString());
        Assert.True(decision.DecisionSnapshot!.Value.GetProperty("sequence").GetInt64() > 0);
        Assert.Equal(originalSnapshot, decision.RequestSnapshot.GetRawText());
        Assert.Equal(originalHistory, decision.History[0].GetRawText());
        var decisionSnapshot = decision.DecisionSnapshot.Value;
        string[] decisionFields =
        [
            "id", "createdAt", "updatedAt", "sequence", "requestId", "invoiceId",
            "outcome", "invoiceStatus", "chargeCode", "beforeAmount", "correctedAmount",
            "delta", "effectiveBefore", "effectiveAfter", "paidAtDecision",
            "sourceFingerprint", "reason", "ownerId", "decidedAt"
        ];
        Assert.Equal(decisionFields.Order(), decisionSnapshot.EnumerateObject().Select(p => p.Name).Order());
        Assert.NotEqual(request.Id, decisionSnapshot.GetProperty("id").GetGuid());
        Assert.Equal(request.Id, decisionSnapshot.GetProperty("requestId").GetGuid());
        Assert.Equal((Guid?)w.Owner.Id, decision.DecidedByUserId);
        Assert.Equal(decisionSnapshot.GetProperty("id").GetGuid().ToString(), decision.History[1].GetProperty("recordKey").GetString());
        Assert.Equal(decisionSnapshot.GetRawText(), decision.History[1].GetProperty("state").GetRawText());
        var policies = await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking().Where(p => p.LocationId == w.Location).ToArrayAsync();
        // Rent is the signed contract amount, not a use of the advertised rent policy.
        Assert.Null(policies.Single(p => p.ChargeCode == "RENT").FirstUsedAt);
        Assert.All(policies.Where(p => p.ChargeCode != "RENT"), p => Assert.NotNull(p.FirstUsedAt));

        var finalPath = $"/api/v1/invoices/{draft.Id}/finalize";
        var final = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync(finalPath,
            new InvoiceFinalizeInput(approved.CurrentInvoice.Version)));
        await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync(finalPath,
            new InvoiceFinalizeInput(approved.CurrentInvoice.Version)));
        var invoice = await db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().SingleAsync(i => i.Id == draft.Id);
        Assert.Equal(InvoiceStatus.Final, invoice.Status);
        Assert.Equal(final.Version, invoice.Version);
        Assert.Equal(3111000m, invoice.Total);
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
