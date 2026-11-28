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
    internal async Task SettlementSharedInvoiceLookupRequiresRecipientRoomAndTenancyPeriod()
    {
        var w = await Setup(DateTimeOffset.UtcNow.AddYears(-1), primaryDeposit: 100000);
        var unrelated = await Setup(DateTimeOffset.UtcNow.AddYears(-1));
        Guid entitled;
        Guid[] excluded;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            var contract = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract);
            contract.ActualEndDate = w.Period.AddMonths(1).AddDays(-1);
            var other = await db.Set<Contract>().SingleAsync(c => c.RoomId == w.Room && c.Id != w.Contract);
            Invoice Issued(Guid room, DateOnly period, params Guid[] recipients) => new()
            {
                RoomId = room,
                LocationId = w.Location,
                RoomNumber = "Synthetic",
                LocationName = "Synthetic",
                BillingPeriod = period,
                RepresentativeContractId = other.Id,
                RepresentativeTenantUserId = w.OtherTenant.Id,
                CreatedByUserId = w.Owner.Id,
                ScheduleSnapshot = "{}",
                Total = 100000,
                ScheduledFinalDate = period,
                DueDate = period.AddMonths(1),
                Recipients = recipients.Select(id => new InvoiceRecipient { TenantUserId = id }).ToList(),
                Lines = [new() { Category = BHome.Domain.PropertyManagement.ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic", Rate = 100000, Quantity = 1, Amount = 100000, RateDate = period, OccupiedDays = 1, PeriodDays = DateTime.DaysInMonth(period.Year, period.Month) }]
            };
            var shared = Issued(w.Room, w.Period, w.Tenant.Id, w.OtherTenant.Id);
            var otherRoomInvoice = Issued(unrelated.Room, w.Period, w.Tenant.Id);
            otherRoomInvoice.LocationId = unrelated.Location;
            otherRoomInvoice.RepresentativeContractId = unrelated.Contract;
            otherRoomInvoice.RepresentativeTenantUserId = unrelated.Tenant.Id;
            entitled = shared.Id;
            var invoices = new[]
            {
                shared,
                Issued(w.Room, w.Period.AddMonths(-1), w.OtherTenant.Id),
                Issued(w.Room, w.Period.AddMonths(-2), w.Tenant.Id),
                Issued(w.Room, w.Period.AddMonths(1), w.Tenant.Id),
                otherRoomInvoice
            };
            excluded = invoices.Where(i => i.Id != entitled).Select(i => i.Id).ToArray();
            db.AddRange(invoices); await db.SaveChangesAsync();
            foreach (var invoice in invoices)
            { invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = w.Owner.Id; invoice.FinalizedAt = DateTimeOffset.UtcNow; }
            await db.SaveChangesAsync();
        }
        var ownerView = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/receivables"));
        Assert.Equal(entitled, Assert.Single(ownerView.Invoices!).Id);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var repository = scope.ServiceProvider.GetRequiredService<ISettlementReceivablesRepository>();
            Assert.Equal(100000, await repository.InvoiceOutstandingAsync(w.Contract, entitled, default));
            foreach (var invoiceId in excluded)
                Assert.Null(await repository.InvoiceOutstandingAsync(w.Contract, invoiceId, default));
        }
        var tenantView = await Success<SettlementReceivablesView>(await w.Tenant.Client.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/receivables"));
        Assert.Null(tenantView.Invoices);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/receivables")).StatusCode);
        (await UtilityPost(w.Owner.Client, $"/api/v1/contracts/{w.Contract}/deposit-verifications",
            new DepositInput("SYN-GUARD-" + Guid.NewGuid(), 100000, "Synthetic verified deposit"), Guid.NewGuid())).EnsureSuccessStatusCode();
        foreach (var invoiceId in excluded)
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var approval = new DepositOffsetApproval(Guid.NewGuid(), w.Contract, w.Contract, null, invoiceId, 1,
                "Synthetic database guard", w.Owner.Id, DateTimeOffset.UtcNow, Guid.NewGuid(), Guid.NewGuid(), "Synthetic", "Synthetic", "{}");
            var updateError = await Assert.ThrowsAsync<DbUpdateException>(() =>
                scope.ServiceProvider.GetRequiredService<ISettlementReceivablesRepository>().SaveOffsetAsync(approval, default));
            var error = Assert.IsType<Npgsql.PostgresException>(updateError.InnerException);
            Assert.Equal("23514", error.SqlState);
            Assert.Equal("Invoice outside deposit tenancy", error.MessageText);
        }
    }

    internal async Task MonthlyDraftUsesAdvanceRentAndFullRoomCapacityDespiteLegacyDailySetting()
    {
        var w = await Setup(DateTimeOffset.UtcNow.AddYears(-1), primaryStart: new DateOnly(Today.Year, Today.Month, 1).AddMonths(-1).AddDays(14), personFee: true);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            (await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == w.Room)).Capacity = 3;
            await db.SaveChangesAsync();
        }
        await ConfirmUtilities(w);
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w) with { PartialMonth = PartialMonthRule.OccupiedCalendarDays }));
        var draft = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period)));
        Assert.Empty(draft.MissingInputs);
        var rent = Assert.Single(draft.Lines, l => l.ChargeCode == "RENT");
        Assert.Equal(3000000, rent.Amount);
        using var rentSource = JsonDocument.Parse(rent.UtilityCalculationSnapshot!);
        Assert.Equal(w.Period.AddMonths(1), rentSource.RootElement.GetProperty("source").GetProperty("BillingPeriod").Deserialize<DateOnly>());
        var fee = Assert.Single(draft.Lines, l => l.ChargeCode == "CLEANING");
        Assert.Equal(3, fee.Quantity); Assert.Equal(300003, fee.Amount);
        using var feeSource = JsonDocument.Parse(fee.UtilityCalculationSnapshot!);
        Assert.Equal(w.Period, feeSource.RootElement.GetProperty("source").GetProperty("BillingPeriod").Deserialize<DateOnly>());
        Assert.Equal("3", feeSource.RootElement.GetProperty("source").GetProperty("RoomCapacity").GetString());
    }

    // Historical issued invoices retain same-period rent and their original
    // day policy. Do not call today's advance-rent generator to manufacture them.
    private async Task<InvoiceView> HistoricalFixedInvoice(Workspace w, BillingSchedule schedule, int occupiedDays)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var contract = await db.Set<Contract>().Include(c => c.Residents).SingleAsync(c => c.Id == w.Contract);
        var room = await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == w.Room);
        var invoice = new Invoice
        {
            RoomId = w.Room,
            LocationId = w.Location,
            RoomNumber = room.RoomNumber,
            LocationName = "Synthetic historical billing",
            BillingPeriod = w.Period,
            RepresentativeContractId = w.Contract,
            RepresentativeTenantUserId = w.Tenant.Id,
            CreatedByUserId = w.Owner.Id,
            ScheduleSnapshot = JsonSerializer.Serialize(schedule),
            ScheduledFinalDate = w.Period,
            DueDate = w.Period.AddMonths(1).AddDays(9),
            Recipients = new[] { w.Tenant.Id, w.OtherTenant.Id }.Select(id => new InvoiceRecipient { TenantUserId = id }).ToList()
        };
        var missing = new List<string>();
        var policies = ContractBillingPrices.Read(contract, w.Location, missing);
        Assert.Empty(missing);
        foreach (var policy in policies.Where(p => p.Method != BHome.Domain.PropertyManagement.ChargingMethod.Metered))
        {
            var people = PersonMonthOccupancy.ForRoomCapacity(room.Capacity, occupiedDays);
            var result = FixedChargeCalculation.Calculate(w.Period, policy, schedule, contract.SnapshotHashOrEmpty, occupiedDays, [], people);
            Assert.Empty(result.MissingInputs);
            invoice.Lines.Add(new InvoiceItem
            {
                InvoiceId = invoice.Id,
                Category = policy.Category,
                ChargeCode = policy.ChargeCode,
                Name = policy.Name,
                PolicyId = policy.Id == Guid.Empty ? null : policy.Id,
                PolicyVersion = policy.Id == Guid.Empty ? null : policy.Version,
                RateDate = w.Period,
                Rate = policy.Rate,
                Quantity = policy.Method == BHome.Domain.PropertyManagement.ChargingMethod.FixedPerPersonPerMonth ? room.Capacity : 1,
                OccupiedDays = occupiedDays,
                PeriodDays = DateTime.DaysInMonth(w.Period.Year, w.Period.Month),
                Amount = result.Amount!.Value,
                UtilityCalculationSnapshot = JsonSerializer.Serialize(new { kind = "FixedChargeCoverage/v1", source = result.Source })
            });
        }
        invoice.Total = invoice.Lines.Sum(l => l.Amount);
        db.Add(invoice); await db.SaveChangesAsync();
        invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = w.Owner.Id; invoice.FinalizedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return await Success<InvoiceView>(await w.Owner.Client.GetAsync($"/api/v1/invoices/{invoice.Id}"));
    }

    internal async Task FinalFixedChargesFollowOwnerPolicyWithoutDuplicateBilling(bool invoiceFirst = false, bool fullMonth = false, bool correctedDeparture = false, bool personFee = false)
    {
        if (correctedDeparture) invoiceFirst = true;
        var w = await Setup(DateTimeOffset.UtcNow.AddYears(-1), personFee: personFee); var finalDate = w.Period.AddDays(14);
        var route = $"/api/v1/contracts/{w.Contract}/move-out/receivables/final-fixed-charges";
        await ConfirmUtilities(w);
        // This test isolates fixed-charge policy/coverage. Inspection metadata is a
        // synthetic approved fixture; live inspection UI/storage is not asserted.
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            if (personFee) (await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == w.Room)).Capacity = 3;
            var contracts = await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync();
            foreach (var c in contracts)
            {
                c.ActualEndDate = finalDate;
                db.Add(new ContractMoveOut
                {
                    ContractId = c.Id,
                    ProposedDate = finalDate,
                    Status = MoveOutStatus.Inspected,
                    RequestedByUserId = w.Tenant.Id,
                    ApprovedByUserId = w.Owner.Id,
                    ApprovedAt = DateTimeOffset.UtcNow,
                    Reason = "Synthetic end"
                });
            }
            var point = new HandoverReading(Guid.NewGuid(), "Synthetic", 0, finalDate, 100, Guid.NewGuid(), "synthetic-private", new string('B', 64));
            var observed = new HandoverSnapshot(finalDate, "Synthetic", "Synthetic condition", "Synthetic keys", "Synthetic notes", [], point, point with { UtilityType = 1 }, []);
            db.Add(new ContractFinalInspection
            {
                ContractId = w.Contract,
                BaselineContractId = w.Contract,
                BaselineVersion = 1,
                Version = 1,
                BaselineSnapshot = JsonSerializer.Serialize(observed),
                ObservedSnapshot = JsonSerializer.Serialize(observed),
                StaffId = w.Staff.Id,
                InspectedAt = DateTimeOffset.UtcNow,
                OwnerDecision = "Confirmed",
                OwnerId = w.Owner.Id,
                OwnerReason = "Synthetic approved fixture",
                ReviewedAt = DateTimeOffset.UtcNow,
                NoAdditionalCharges = true
            });
            await db.SaveChangesAsync();
        }
        var missingSchedule = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
        Assert.Null(missingSchedule.Amount); Assert.Contains("billing_schedule_required", missingSchedule.MissingInputs);
        var schedule = await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync("/api/v1/billing-schedules", Schedule(w) with
        { PartialMonth = fullMonth ? PartialMonthRule.FullMonth : PartialMonthRule.OccupiedCalendarDays }));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            var other = await db.Set<Contract>().SingleAsync(c => c.RoomId == w.Room && c.Id != w.Contract);
            other.ActualEndDate = null; await db.SaveChangesAsync();
            var openRoom = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
            Assert.Null(openRoom.Amount); Assert.Contains("room_billing_period_still_open", openRoom.MissingInputs);
            other.ActualEndDate = finalDate; await db.SaveChangesAsync();
        }
        if (correctedDeparture)
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
            foreach (var tenancy in await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync()) tenancy.ActualEndDate = w.Period.AddMonths(1).AddDays(-1);
            await db.SaveChangesAsync();
        }
        var draft = invoiceFirst ? await HistoricalFixedInvoice(w, schedule, correctedDeparture ? DateTime.DaysInMonth(w.Period.Year, w.Period.Month) : 15) : null;
        var expected = fullMonth ? 3000000 : InvoiceMath.Amount(3000000, 1, 15, DateTime.DaysInMonth(w.Period.Year, w.Period.Month), PartialMonthRule.OccupiedCalendarDays, VndRounding.AwayFromZero, false);
        var expectedPerson = fullMonth ? 300003m : InvoiceMath.Amount(100001m, 45, 1,
            DateTime.DaysInMonth(w.Period.Year, w.Period.Month), PartialMonthRule.OccupiedCalendarDays, VndRounding.AwayFromZero, false);
        if (personFee && draft is not null)
        {
            var person = Assert.Single(draft.Lines, l => l.ChargeCode == "CLEANING");
            Assert.Equal(3m, person.Quantity); Assert.Equal(expectedPerson, person.Amount);
            using var snapshot = JsonDocument.Parse(person.UtilityCalculationSnapshot!);
            Assert.Equal("45", snapshot.RootElement.GetProperty("source").GetProperty("PersonDays").GetString());
            Assert.Equal("3", snapshot.RootElement.GetProperty("source").GetProperty("RoomCapacity").GetString());
        }
        var original = draft is null ? null : await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{draft.Id}");
        if (correctedDeparture)
        {
            await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetFixturePersistence();
                foreach (var tenancy in await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync()) tenancy.ActualEndDate = finalDate;
                await db.SaveChangesAsync();
            }
            var blocked = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)));
            Assert.Null(blocked.Amount); Assert.Contains("fixed_charge_occupancy_changed", blocked.MissingInputs);
            var request = await Success<AdjustmentView>(await UtilityPost(w.Tenant.Client, $"/api/v1/invoices/{draft!.Id}/adjustment-requests",
                new AdjustmentSubmit(draft.Lines.Single(l => l.Category == "Rent").Id, expected, "Synthetic actual departure under the approved daily policy", [], draft.Version), Guid.NewGuid()));
            Assert.Null(Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route))).Amount);
            await Success<AdjustmentView>(await UtilityPost(w.Owner.Client, $"/api/v1/invoice-adjustments/{request.Id}/approve",
                new AdjustmentDecisionInput(1, draft.Version, request.CurrentFinancialVersion, expected, "RENT", "Synthetic reviewed signed rent policy and actual departure", true), Guid.NewGuid()));
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(route)).StatusCode);
        var previews = await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route));
        var preview = Assert.Single(previews, p => p.ChargeCode == "RENT");
        Assert.Empty(preview.MissingInputs); Assert.Equal(invoiceFirst ? 0 : expected, preview.Amount);
        Assert.Equal(15, preview.Calculation!.OccupiedDays);
        if (correctedDeparture) { Assert.NotEmpty(preview.Calculation.ApprovedAdjustmentIds!); Assert.Equal(3000000 - expected, preview.Calculation.ApprovedReduction); }
        var input = new FinalFixedChargeApproval("RENT", preview.Reference, true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await UtilityPost(w.Owner.Client, route, input with { PolicyAppliesToSignedTermsConfirmed = false }, Guid.NewGuid())).StatusCode);
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => UtilityPost(w.Owner.Client, route, input, key)));
        var first = await Success<SettlementReceivable>(results[0]); var replay = await Success<SettlementReceivable>(results[1]); Assert.Equal(first.Id, replay.Id);
        Assert.Equal(invoiceFirst ? 0 : expected, first.Amount);
        Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route, input, Guid.NewGuid())).StatusCode);
        SettlementReceivable? personCharge = null;
        if (personFee)
        {
            var person = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route)), p => p.ChargeCode == "CLEANING");
            Assert.Empty(person.MissingInputs); Assert.Equal(invoiceFirst ? 0m : expectedPerson, person.Amount);
            Assert.Equal(3, person.Calculation!.ResidentCount); Assert.Equal(45, person.Calculation.PersonDays);
            personCharge = await Success<SettlementReceivable>(await UtilityPost(w.Owner.Client, route,
                new FinalFixedChargeApproval(person.ChargeCode, person.Reference, true), Guid.NewGuid()));
            Assert.Equal(person.Amount, personCharge.Amount);
        }
        var tenant = await Success<SettlementReceivablePage>(await w.OtherTenant.Client.GetAsync("/api/v1/tenant/settlement-receivables"));
        var tenantCharges = Assert.Single(tenant.Items).Receivables;
        Assert.Equal(personFee ? 2 : 1, tenantCharges.Count);
        Assert.Contains(tenantCharges, c => c.Charge.Id == first.Id);
        if (!invoiceFirst)
        {
            // Every tenancy has ended before next month. JOB-10 must leave the
            // settled month alone instead of inventing an advance-rent contract.
            var refused = await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period, w.Contract));
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Contains("no_reference_contract_for_period", await refused.Content.ReadAsStringAsync());
        }
        else Assert.Equal(original, await w.Owner.Client.GetStringAsync($"/api/v1/invoices/{draft!.Id}"));
        await using var verification = fixture.Factory.Services.CreateAsyncScope();
        var verifiedDb = verification.ServiceProvider.GetFixturePersistence();
        Assert.Equal(invoiceFirst ? 1 : 0, await verifiedDb.Set<Invoice>().CountAsync(i => i.RoomId == w.Room));
    }
}
