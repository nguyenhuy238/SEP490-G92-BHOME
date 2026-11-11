using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Billing;

public sealed partial class InvoiceApiTests
{
    internal async Task FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(bool invoiceFirst = false, bool fullMonth = false, bool correctedDeparture = false)
    {
        if (correctedDeparture) invoiceFirst = true;
        var w = await Setup(DateTimeOffset.UtcNow.AddYears(-1)); var finalDate = w.Period.AddDays(14);
        var route = $"/api/v1/contracts/{w.Contract}/move-out/receivables/final-fixed-charges";
        await ConfirmUtilities(w);
        // This test isolates fixed-charge policy/coverage. Inspection metadata is a
        // synthetic approved fixture; live inspection UI/storage is not asserted.
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var contracts = await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync();
            foreach (var c in contracts)
            {
                c.ActualEndDate = finalDate; c.SnapshotHash = new string('A', 64);
                db.Add(new ContractMoveOut { ContractId = c.Id, ProposedDate = finalDate, Status = MoveOutStatus.Inspected,
                    RequestedByUserId = w.Tenant.Id, ApprovedByUserId = w.Owner.Id, ApprovedAt = DateTimeOffset.UtcNow, Reason = "Synthetic end" });
            }
            var point = new HandoverReading(Guid.NewGuid(), "Synthetic", 0, finalDate, 100, Guid.NewGuid(), "synthetic-private", new string('B', 64));
            var observed = new HandoverSnapshot(finalDate, "Synthetic", "Synthetic condition", "Synthetic keys", "Synthetic notes", [], point, point with { UtilityType = 1 }, []);
            db.Add(new ContractFinalInspection { ContractId = w.Contract, BaselineContractId = w.Contract, BaselineVersion = 1,
                Version = 1, BaselineSnapshot = JsonSerializer.Serialize(observed), ObservedSnapshot = JsonSerializer.Serialize(observed),
                StaffId = w.Staff.Id, InspectedAt = DateTimeOffset.UtcNow, OwnerDecision = "Confirmed", OwnerId = w.Owner.Id,
                OwnerReason = "Synthetic approved fixture", ReviewedAt = DateTimeOffset.UtcNow, NoAdditionalCharges = true });
            await db.SaveChangesAsync();
        }
        var missingSchedule = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
        Assert.Null(missingSchedule.Amount); Assert.Contains("billing_schedule_required", missingSchedule.MissingInputs);
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w) with
        { PartialMonth = fullMonth ? PartialMonthRule.FullMonth : PartialMonthRule.OccupiedCalendarDays }));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var other = await db.Set<Contract>().SingleAsync(c => c.RoomId == w.Room && c.Id != w.Contract);
            other.ActualEndDate = null; await db.SaveChangesAsync();
            var openRoom = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
            Assert.Null(openRoom.Amount); Assert.Contains("room_billing_period_still_open", openRoom.MissingInputs);
            other.ActualEndDate = finalDate; await db.SaveChangesAsync();
        }
        if (correctedDeparture)
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            foreach (var tenancy in await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync()) tenancy.ActualEndDate = w.Period.AddMonths(1).AddDays(-1);
            await db.SaveChangesAsync();
        }
        var draft = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract)));
        Assert.Empty(draft.MissingInputs);
        var expected = fullMonth ? 3000000 : InvoiceMath.Amount(3000000, 1, 15, DateTime.DaysInMonth(w.Period.Year, w.Period.Month), PartialMonthRule.OccupiedCalendarDays, VndRounding.AwayFromZero, false);
        if (invoiceFirst) draft = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version)));
        var original = await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{draft.Id}");
        if (correctedDeparture)
        {
            await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
                foreach (var tenancy in await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync()) tenancy.ActualEndDate = finalDate;
                await db.SaveChangesAsync();
            }
            var blocked = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
            Assert.Null(blocked.Amount); Assert.Contains("fixed_charge_occupancy_changed", blocked.MissingInputs);
            var request = await Success<AdjustmentView>(await UtilityPost(w.Tenant.Client, $"/api/v1/invoices/{draft.Id}/adjustment-requests",
                new AdjustmentSubmit(draft.Lines.Single(l => l.Category == "Rent").Id, expected, "Synthetic actual departure under the approved daily policy", [], draft.Version), Guid.NewGuid()));
            Assert.Null(Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route))).Amount);
            await Success<AdjustmentView>(await UtilityPost(w.Owner.Client, $"/api/v1/invoice-adjustments/{request.Id}/approve",
                new AdjustmentDecisionInput(1, draft.Version, request.CurrentFinancialVersion, expected, "RENT", "Synthetic reviewed signed rent policy and actual departure", true), Guid.NewGuid()));
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(route)).StatusCode);
        var preview = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
        Assert.Empty(preview.MissingInputs); Assert.Equal(invoiceFirst ? 0 : expected, preview.Amount);
        Assert.Equal(15, preview.Calculation!.OccupiedDays);
        if (correctedDeparture) { Assert.NotEmpty(preview.Calculation.ApprovedAdjustmentIds!); Assert.Equal(3000000 - expected, preview.Calculation.ApprovedReduction); }
        var input = new FinalFixedChargeApproval("RENT", preview.Reference, true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await UtilityPost(w.Owner.Client, route, input with { PolicyAppliesToSignedTermsConfirmed = false }, Guid.NewGuid())).StatusCode);
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => UtilityPost(w.Owner.Client, route, input, key)));
        var first = await Success<SettlementReceivable>(results[0]); var replay = await Success<SettlementReceivable>(results[1]); Assert.Equal(first.Id, replay.Id);
        Assert.Equal(invoiceFirst ? 0 : expected, first.Amount);
        Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route, input, Guid.NewGuid())).StatusCode);
        var tenant = await Success<SettlementReceivablePage>(await w.OtherTenant.Client.GetAsync("/api/v1/tenant/settlement-receivables"));
        Assert.Equal(first.Id, Assert.Single(Assert.Single(tenant.Items).Receivables).Charge.Id);
        if (!invoiceFirst)
        {
            Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version))).StatusCode);
            draft = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/refresh", new InvoiceFinalizeInput(draft.Version)));
            Assert.Empty(draft.MissingInputs); Assert.Equal(0, draft.Lines.Single(l => l.Category == "Rent").Amount);
            var final = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version)));
            Assert.Equal(expected, first.Amount + final.Lines.Single(l => l.Category == "Rent").Amount);
        }
        else Assert.Equal(original, await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{draft.Id}"));
        await using var verification = fixture.Factory.Services.CreateAsyncScope();
        var verifiedDb = verification.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await verifiedDb.Set<Invoice>().CountAsync(i => i.RoomId == w.Room));
    }
}
