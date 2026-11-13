using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Application.PaymentsDebt;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.Billing;

public sealed partial class InvoiceApiTests
{
    private static Task<HttpResponseMessage> UtilityPost(HttpClient client, string route, object body, Guid key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(request);
    }
    private static async Task<ConfirmedReading> CaptureFinalFixtureReading(Workspace w, Guid meterId, ReadingPurpose purpose,
        DateOnly date, decimal value, Guid? contractId = null)
    {
        var task = await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks",
            new MeterTaskInput(meterId, purpose, date, purpose == ReadingPurpose.Periodic ? w.Period : null, contractId)));
        using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.White);
        using var content = new ByteArrayContent(image.ImEncode(".png")); content.Headers.ContentType = new("image/png");
        var evidence = await Success<IdResult>(await w.Staff.Client.PutAsync($"/api/v1/capture/meter-tasks/{task.Id}/evidence", content));
        return await Success<ConfirmedReading>(await w.Staff.Client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task.Id}/confirm", new MeterConfirmation(true, value, evidence.Id)));
    }
    internal async Task FinalUtilitiesUseBilledBaselineAndPreserveContractRates(bool settlementFirst = false, bool failuresOnly = false, bool raceInvoice = false, bool sameDayFinals = false, bool reviewRefund = false, bool offsetAllDeposit = false)
    {
        if (raceInvoice) settlementFirst = true;
        var period = new DateOnly(Today.Year, Today.Month, 1).AddMonths(-1);
        var finalDate = period.AddMonths(1).AddDays(-1);
        var activatedAt = new DateTimeOffset(period.AddMonths(-1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        var agreedDeposit = reviewRefund ? offsetAllDeposit ? 3215000m : 4000000m : 0m;
        var w = await Setup(activatedAt, primaryStart: reviewRefund ? period : null, primaryDeposit: agreedDeposit);
        var meterIds = new Dictionary<UtilityType, Guid>();
        foreach (var type in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var meter = await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meters",
                new MeterInput(w.Room, "SYN-FINAL-" + type, type, MeterDisplay.Digital, 2, w.Period.AddMonths(-1))));
            meterIds[type] = meter.Id;
            await CaptureFinalFixtureReading(w, meter.Id, ReadingPurpose.Initial, w.Period.AddDays(-1), 100);
            await CaptureFinalFixtureReading(w, meter.Id, ReadingPurpose.Periodic, finalDate.AddDays(-2), type == UtilityType.Electricity ? 125.5m : 102);
        }
        // Simulate a later Room-level price version in the disposable database. Neither
        // the periodic invoice nor the final settlement may use the new price.
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            db.Add(new BillingPolicy
            {
                LocationId = w.Location,
                RoomId = w.Room,
                Category = ChargeCategory.Electricity,
                ChargeCode = "ELECTRICITY",
                Name = "Synthetic new rate",
                Method = ChargingMethod.Metered,
                Rate = 9000,
                EffectiveFrom = w.Period
            });
            await db.SaveChangesAsync();
        }
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w) with { FinalMonthOffset = 0 }));
        var draft = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract)));
        Assert.Empty(draft.MissingInputs);
        var invoice = settlementFirst ? draft : await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version)));
        Assert.Equal(89250, invoice.Lines.Single(l => l.Category == "Electricity").Amount);
        var original = await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{invoice.Id}");
        Guid otherContract;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            otherContract = await db.Set<Contract>().Where(c => c.RoomId == w.Room && c.Id != w.Contract).Select(c => c.Id).SingleAsync();
            foreach (var contract in new[] { w.Contract, otherContract }) db.Add(new ContractMoveOut
            {
                ContractId = contract,
                Status = MoveOutStatus.Approved,
                ProposedDate = contract == w.Contract || sameDayFinals ? finalDate : finalDate.AddDays(-1),
                Reason = "Synthetic approved departure",
                RequestedByUserId = w.Tenant.Id,
                ApprovedByUserId = w.Owner.Id,
                ApprovedAt = DateTimeOffset.UtcNow,
                InspectionStaffId = w.Staff.Id
            });
            await db.SaveChangesAsync();
        }
        // This real confirmed final reading is not yet billed. It cannot erase usage
        // between the previous invoice and this intermediate confirmation.
        await CaptureFinalFixtureReading(w, meterIds[UtilityType.Electricity], ReadingPurpose.Final, sameDayFinals ? finalDate : finalDate.AddDays(-1), 130, otherContract);
        var finalElectricity = await CaptureFinalFixtureReading(w, meterIds[UtilityType.Electricity], ReadingPurpose.Final, finalDate, 140, w.Contract);
        var finalWater = await CaptureFinalFixtureReading(w, meterIds[UtilityType.Water], ReadingPurpose.Final, finalDate, 105, w.Contract);
        Assert.Equal(10, finalElectricity.Consumption);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            async Task<HandoverReading> Point(Guid readingId)
            {
                var reading = await db.Set<MeterReading>().SingleAsync(r => r.Id == readingId);
                var task = await db.Set<OperationalTask>().SingleAsync(t => t.Id == reading.TaskId);
                var meter = await db.Set<Meter>().SingleAsync(m => m.Id == reading.MeterId);
                var proof = await db.Set<MeterEvidence>().SingleAsync(e => e.Id == reading.EvidenceId);
                return new(reading.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, reading.ConfirmedValue, proof.Id, proof.ObjectKey, proof.ImageHash);
            }
            var electricity = await Point(finalElectricity.Id); var water = await Point(finalWater.Id);
            var observed = new HandoverSnapshot(finalDate, "SYNTHETIC-BILL", "Synthetic inspected condition", "Synthetic returned keys", "Synthetic final readings", [], electricity, water, []);
            db.Add(new ContractFinalInspection
            {
                ContractId = w.Contract,
                BaselineContractId = w.Contract,
                BaselineVersion = 1,
                Version = 1,
                BaselineSnapshot = JsonSerializer.Serialize(observed),
                ObservedSnapshot = JsonSerializer.Serialize(observed),
                StaffId = w.Staff.Id,
                InspectedAt = new DateTimeOffset(finalDate.ToDateTime(new TimeOnly(17, 0)), TimeSpan.FromHours(7)).ToUniversalTime(),
                OwnerDecision = "Confirmed",
                OwnerId = w.Owner.Id,
                OwnerReason = "Synthetic checked source photos",
                ReviewedAt = DateTimeOffset.UtcNow,
                NoAdditionalCharges = true
            });
            var move = await db.Set<ContractMoveOut>().SingleAsync(m => m.ContractId == w.Contract);
            move.Status = MoveOutStatus.Inspected; move.ElectricityReadingId = finalElectricity.Id; move.WaterReadingId = finalWater.Id;
            var departed = await db.Set<Contract>().SingleAsync(c => c.Id == otherContract);
            departed.Status = ContractStatus.Terminated; departed.ActualEndDate = sameDayFinals ? finalDate : finalDate.AddDays(-1);
            (await db.Set<ContractResident>().SingleAsync(r => r.ContractId == otherContract)).ResidenceTo = departed.ActualEndDate;
            (await db.Set<Resident>().SingleAsync(r => r.TenantUserId == w.OtherTenant.Id)).RoomId = null;
            if (reviewRefund)
            {
                move.InspectedAt = new DateTimeOffset(finalDate.ToDateTime(new TimeOnly(17, 0)), TimeSpan.FromHours(7)).ToUniversalTime();
                db.Add(new DepositVerification
                {
                    ContractId = w.Contract,
                    Amount = agreedDeposit,
                    VerifiedByUserId = w.Owner.Id,
                    VerifiedAt = DateTimeOffset.UtcNow,
                    BankTransactionReference = "SYN-DEPOSIT-" + Guid.NewGuid(),
                    VerificationReason = "Synthetic verified deposit precondition"
                });
            }
            await db.SaveChangesAsync();
        }
        var route = $"/api/v1/contracts/{w.Contract}/move-out/receivables/final-utilities";
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync(route)).StatusCode);
        var previews = await Success<FinalUtilityPreview[]>(await w.Owner.Client.GetAsync(route));
        var electricityPreview = previews.Single(p => p.UtilityType == "Electricity");
        Assert.Empty(electricityPreview.MissingInputs); Assert.Equal(settlementFirst ? 100 : 125.5m, electricityPreview.Baseline!.Value);
        Assert.Equal(settlementFirst ? 40 : 14.5m, electricityPreview.Quantity); Assert.Equal(settlementFirst ? 0 : 25.5m, electricityPreview.AlreadyBilledQuantity);
        Assert.Equal(settlementFirst ? 140000 : 50750, electricityPreview.Amount);
        var waterPreview = previews.Single(p => p.UtilityType == "Water"); Assert.Empty(waterPreview.MissingInputs); Assert.Equal(settlementFirst ? 75000 : 45000, waterPreview.Amount);
        var input = new FinalUtilityApprovalInput(UtilityType.Electricity, electricityPreview.Reference, true); var key = Guid.NewGuid();
        if (failuresOnly)
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var proof = await db.Set<MeterEvidence>().SingleAsync(e => db.Set<MeterReading>().Any(r => r.Id == finalElectricity.Id && r.EvidenceId == e.Id));
            var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
            using var originalPhoto = new MemoryStream(); await storage.CopyToAsync(proof.ObjectKey, originalPhoto, default);
            using var black = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black); var changed = black.ImEncode(".png");
            using (var content = new MemoryStream(changed)) await storage.PutAsync(proof.ObjectKey, content, changed.Length, "image/png", default);
            Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route, input, key)).StatusCode);
            originalPhoto.Position = 0; await storage.PutAsync(proof.ObjectKey, originalPhoto, originalPhoto.Length, "image/png", default);
            Assert.Empty((await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/receivables"))).Receivables);
            var contract = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract);
            contract.AgreedPriceSnapshot = "{}"; await db.SaveChangesAsync();
            var blocked = (await Success<FinalUtilityPreview[]>(await w.Owner.Client.GetAsync(route))).Single(p => p.UtilityType == "Electricity");
            Assert.Contains("contract_price_snapshot_missing", blocked.MissingInputs); Assert.Null(blocked.Amount);
            Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route, input with { ExpectedReference = blocked.Reference }, Guid.NewGuid())).StatusCode);
            Assert.Empty((await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/receivables"))).Receivables);
            Assert.Equal(original, await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{invoice.Id}"));
            return;
        }
        SettlementReceivable charge;
        if (raceInvoice)
        {
            var results = await Task.WhenAll(UtilityPost(w.Owner.Client, route, input, key),
                w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{invoice.Id}/finalize", new InvoiceFinalizeInput(invoice.Version)));
            if (results[0].IsSuccessStatusCode)
            {
                charge = await Success<SettlementReceivable>(results[0]); Assert.Equal(HttpStatusCode.Conflict, results[1].StatusCode);
            }
            else
            {
                Assert.Equal(HttpStatusCode.Conflict, results[0].StatusCode); invoice = await Success<InvoiceView>(results[1]);
                original = await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{invoice.Id}"); settlementFirst = false;
                var fresh = (await Success<FinalUtilityPreview[]>(await w.Owner.Client.GetAsync(route))).Single(p => p.UtilityType == "Electricity");
                input = input with { ExpectedReference = fresh.Reference };
                charge = await Success<SettlementReceivable>(await UtilityPost(w.Owner.Client, route, input, Guid.NewGuid()));
            }
        }
        else
        {
            var results = await Task.WhenAll(UtilityPost(w.Owner.Client, route, input, key), UtilityPost(w.Owner.Client, route, input, key));
            charge = await Success<SettlementReceivable>(results[0]); Assert.Equal(charge.Id, (await Success<SettlementReceivable>(results[1])).Id);
        }
        Assert.Equal(settlementFirst ? 140000 : 50750, charge.Amount); Assert.Equal(settlementFirst ? 40 : 14.5m, charge.Utility!.Quantity); Assert.Equal(2, charge.Evidence.Count);
        Assert.Contains(w.OtherTenant.Id, charge.RecipientUserIds); // responsible during the measured interval, despite already leaving.
        if (settlementFirst)
        {
            Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{invoice.Id}/finalize", new InvoiceFinalizeInput(invoice.Version))).StatusCode);
            var refreshedInvoice = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{invoice.Id}/refresh", new InvoiceFinalizeInput(invoice.Version)));
            var covered = refreshedInvoice.Lines.Single(l => l.Category == "Electricity");
            Assert.Equal(0, covered.Amount); Assert.Equal(0, covered.Quantity); Assert.Null(covered.MeterReadingId);
            Assert.Contains("CoveredBySettlement", covered.UtilityCalculationSnapshot!);
            await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{invoice.Id}/finalize", new InvoiceFinalizeInput(refreshedInvoice.Version)));
        }
        else Assert.Equal(original, await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{invoice.Id}"));
        Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route, input with { UtilityType = UtilityType.Water }, key)).StatusCode);
        var refreshed = await Success<FinalUtilityPreview[]>(await w.Owner.Client.GetAsync(route));
        Assert.Equal(charge.Id, refreshed.Single(p => p.UtilityType == "Electricity").ExistingReceivableId);
        Assert.Equal(0, refreshed.Single(p => p.UtilityType == "Electricity").Quantity);
        var tenantView = await Success<SettlementReceivablesView>(await w.OtherTenant.Client.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/receivables"));
        Assert.Equal(charge.Id, Assert.Single(tenantView.Receivables).Charge.Id);
        var receivablesRoute = $"/api/v1/contracts/{w.Contract}/move-out/receivables";
        if (reviewRefund) { await ReviewChargesOffsetAndRefundRemainder(w, charge, finalDate, offsetAllDeposit ? invoice.Total + 95750 : 4000000); return; }
        var instructions = await Success<SettlementTransferInstructions>(await w.OtherTenant.Client.GetAsync(receivablesRoute + $"/{charge.Id}/transfer-instructions"));
        var receipt = await Success<TransferView>(await UtilityPost(w.Owner.Client, "/api/v1/payment-transactions",
            new PaymentTransferInput("SYNTHETIC-UTILITY", "SYN-UTILITY-" + Guid.NewGuid(), charge.Amount, "VND", DateTimeOffset.UtcNow.AddSeconds(-1),
                instructions.TransferReference, "Synthetic verified statement", "Synthetic Owner bank confirmation", null, true), Guid.NewGuid()));
        var current = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(receivablesRoute));
        var allocation = await Success<SettlementBankAllocationResult>(await UtilityPost(w.Owner.Client, receivablesRoute + $"/{charge.Id}/bank-allocations",
            new SettlementBankAllocationInput(current.Reference, receipt.Id, w.OtherTenant.Id, true), Guid.NewGuid()));
        Assert.Equal(charge.Amount, allocation.AllocatedAmount);
        Assert.Equal("Paid", Assert.Single((await Success<SettlementReceivablesView>(await w.OtherTenant.Client.GetAsync(receivablesRoute))).Receivables).Status);
        var finalInvoice = await Success<InvoiceView>(await w.Owner.Client.GetAsync($"/api/v1/invoices/{invoice.Id}"));
        Assert.Equal(140000, charge.Amount + finalInvoice.Lines.Single(l => l.Category == "Electricity").Amount);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope(); var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await finalDb.Set<Invoice>().CountAsync(i => i.RoomId == w.Room));
    }
}
