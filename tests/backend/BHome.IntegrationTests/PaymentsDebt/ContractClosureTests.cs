using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;
using BHome.Application.Storage;
using BHome.Application.Operations;
using OpenCvSharp;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private async Task ReadySettlementFixture(Workspace w, bool others, bool payInvoices = true, decimal agreedDeposit = 0)
    {
        // Synthetic persisted financial/inspection preconditions, no mocked settlement result.
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var contract = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract); var prior = await db.Set<Invoice>().SingleAsync(i => i.Id == w.Invoice);
        contract.StartDate = prior.BillingPeriod;
        contract.RequiredDeposit = agreedDeposit;
        if (!others)
            foreach (var other in await db.Set<Contract>().Where(c => c.RoomId == w.Room && c.Id != w.Contract).ToArrayAsync())
                other.Status = ContractStatus.Terminated;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime); var period = new DateOnly(today.Year, today.Month, 1);
        var lines = new List<InvoiceLine> { new() { Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent", Rate = 100000, Quantity = 1, Amount = 100000, RateDate = period, OccupiedDays = 1, PeriodDays = DateTime.DaysInMonth(period.Year, period.Month) } };
        var readings = new List<HandoverReading>();
        foreach (var type in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var meter = new Meter { RoomId = w.Room, Code = "SYN-CLOSE-" + type, UtilityType = type, InstalledOn = prior.BillingPeriod }; db.Add(meter);
            MeterReading? periodic = null;
            foreach (var purpose in new[] { ReadingPurpose.Periodic, ReadingPurpose.Final })
            {
                var task = new OperationalTask { LocationId = w.Location, MeterId = meter.Id, ContractId = purpose == ReadingPurpose.Final ? w.Contract : null, Purpose = purpose, ReadingDate = today, BillingPeriod = purpose == ReadingPurpose.Periodic ? period : null, Status = MeterTaskStatus.Completed };
                using var image = new Mat(60, 120, MatType.CV_8UC3, Scalar.White);
                var photo = image.ImEncode(".png");
                var evidence = new MeterEvidence
                {
                    TaskId = task.Id,
                    UploadedByUserId = w.Staff,
                    ObjectKey = "synthetic-close/" + Guid.NewGuid(),
                    ImageHash = Convert.ToHexString(SHA256.HashData(photo)),
                    ContentType = "image/png",
                    Length = photo.Length,
                    IsUploaded = true,
                    IsLinked = true
                };
                using (var content = new MemoryStream(photo)) await scope.ServiceProvider.GetRequiredService<IObjectStorage>().PutAsync(evidence.ObjectKey, content, photo.Length, "image/png", default);
                var reading = new MeterReading { TaskId = task.Id, MeterId = meter.Id, EvidenceId = evidence.Id, PreviousValue = 100, ConfirmedValue = 100, Consumption = 0, ConfirmedByUserId = w.Staff, ConfirmedAt = DateTimeOffset.UtcNow }; db.AddRange(task, evidence, reading);
                if (purpose == ReadingPurpose.Periodic) periodic = reading;
                else readings.Add(new(reading.Id, meter.Code, (int)type, today, 100, evidence.Id, evidence.ObjectKey, evidence.ImageHash));
            }
            lines.Add(new() { Category = type == UtilityType.Electricity ? ChargeCategory.Electricity : ChargeCategory.Water, ChargeCode = type.ToString().ToUpperInvariant(), Name = "Synthetic utility", Rate = 0, Quantity = 0, Amount = 0, RateDate = period, OccupiedDays = 1, PeriodDays = DateTime.DaysInMonth(period.Year, period.Month), MeterReadingId = periodic!.Id, PreviousReading = 100, ConfirmedReading = 100 });
        }
        var invoice = new Invoice { RoomId = w.Room, LocationId = w.Location, RoomNumber = "PAY-TEST", LocationName = "Synthetic", BillingPeriod = period, RepresentativeContractId = w.Contract, RepresentativeTenantUserId = w.Tenants[0], Total = 100000, CreatedByUserId = w.Owner, ScheduleSnapshot = "{}", ScheduledFinalDate = period, DueDate = today, Lines = lines, Recipients = w.Tenants.Select(id => new InvoiceRecipient { TenantUserId = id }).ToList() }; db.Add(invoice);
        var snapshot = new HandoverSnapshot(today, "PAY-TEST", "Unchanged", "Returned", "Synthetic no additional charges", [], readings[0], readings[1], []);
        db.Add(new ContractFinalInspection { ContractId = w.Contract, BaselineContractId = w.Contract, BaselineVersion = 1, Version = 1, BaselineSnapshot = JsonSerializer.Serialize(snapshot), ObservedSnapshot = JsonSerializer.Serialize(snapshot), StaffId = w.Staff, InspectedAt = DateTimeOffset.UtcNow, OwnerDecision = "Confirmed", OwnerId = w.Owner, OwnerReason = "Synthetic checked", ReviewedAt = DateTimeOffset.UtcNow, NoAdditionalCharges = true });
        db.Add(new ContractMoveOut { ContractId = w.Contract, Status = MoveOutStatus.Inspected, ProposedDate = today, Reason = "Synthetic moveout", RequestedByUserId = w.Tenants[0], ApprovedByUserId = w.Owner, ApprovedAt = DateTimeOffset.UtcNow, InspectedAt = DateTimeOffset.UtcNow, ElectricityReadingId = readings[0].Id, WaterReadingId = readings[1].Id });
        await db.SaveChangesAsync(); invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = w.Owner; invoice.FinalizedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync();
        foreach (var bill in payInvoices ? new[] { prior, invoice } : [])
        {
            var input = Input(w) with { ProposedInvoiceId = bill.Id, TransferDescription = BHome.Domain.PaymentsDebt.PaymentRules.InvoiceReference(bill.Id) };
            var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(input, Guid.NewGuid(), default)); await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(bill.Id, w.Tenants[0], true), Guid.NewGuid(), default));
        }
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task RealLedgerRequiresReviewedSnapshotAndClosesOnlyDepartingContract(bool others)
    {
        var w = await Setup(); await ReadySettlementFixture(w, others); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); var path = $"/api/v1/contracts/{w.Contract}/move-out";
        var summary = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path + "/settlement-summary"))!; Assert.True(summary.Resolved, string.Join(',', summary.UnresolvedItems)); Assert.Equal(others, summary.OtherActiveContracts);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, path + "/settlement", new SettlementInput("Checked", "stale"))).StatusCode);
        (await Post(owner, path + "/settlement", new SettlementInput("Synthetic zero-deposit fully verified", summary.Reference))).EnsureSuccessStatusCode();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime); var key = Guid.NewGuid();
        var results = await Task.WhenAll(Post(owner, path + "/complete", new CompletionInput(today), key), Post(owner, path + "/complete", new CompletionInput(today), key)); Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); Assert.Equal(ContractStatus.Terminated, (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).Status);
        Assert.Equal(others ? RoomStatus.Occupied : RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.Equal(others ? 2 : 0, await db.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
        Assert.Equal(HttpStatusCode.OK, (await tenant.GetAsync($"/api/v1/invoices/{w.Invoice}/payment")).StatusCode);
        Assert.Equal(today, (await tenant.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{w.Contract}"))!.ActualEndDate);
    }
    [Fact]
    public async Task NewAdjustmentAfterSettlementReviewPreservesDebtButDoesNotPreventPhysicalRelease()
    {
        var w = await Setup(); await ReadySettlementFixture(w, true); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); var path = $"/api/v1/contracts/{w.Contract}/move-out";
        var summary = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path + "/settlement-summary"))!; (await Post(owner, path + "/settlement", new SettlementInput("Synthetic reviewed", summary.Reference))).EnsureSuccessStatusCode();
        await AdjustRequest(tenant, w.Invoice, 1, 90000);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        (await Post(owner, path + "/complete", new CompletionInput(today))).EnsureSuccessStatusCode();
        var pending = await owner.GetFromJsonAsync<ContractSettlementSummary>(path + "/settlement-summary");
        Assert.False(pending!.Resolved);
        Assert.Contains("invoice_adjustment_pending", pending.UnresolvedItems);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PhysicalHandoverPreservesUnpaidRoomDebtAndHistoricalAccessAndClosesOnlyDepartingResidents(bool otherOccupancy)
    {
        var w = await Setup(); await ReadySettlementFixture(w, otherOccupancy, payInvoices: false);
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var path = $"/api/v1/contracts/{w.Contract}/move-out";
        var before = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path + "/settlement-summary"))!;
        Assert.True(before.Calculation!.RoomOutstanding > 0); Assert.False(before.Resolved);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        (await Post(owner, path + "/complete", new CompletionInput(today))).EnsureSuccessStatusCode();
        var after = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path + "/settlement-summary"))!;
        Assert.Equal(before.Calculation.RoomOutstanding, after.Calculation!.RoomOutstanding);
        Assert.False(after.Resolved);
        (await tenant.GetAsync($"/api/v1/invoices/{w.Invoice}/payment")).EnsureSuccessStatusCode();
        var ownContract = (await tenant.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{w.Contract}"))!;
        Assert.Equal("Terminated", ownContract.Status); Assert.NotEmpty(ownContract.Occupants!);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var members = await db.Set<ContractResident>().Where(cr => cr.ContractId == w.Contract).ToArrayAsync();
        var ids = members.Select(cr => cr.ResidentId).ToArray();
        Assert.All(members, cr => Assert.Equal(today, cr.ResidenceTo));
        Assert.Equal(otherOccupancy ? RoomStatus.Occupied : RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
        {
            Assert.All(await db.Set<Resident>().Where(r => ids.Contains(r.Id)).ToArrayAsync(), r => Assert.Null(r.RoomId));
            foreach (var id in ids)
            {
                var profile = (await owner.GetFromJsonAsync<ResidentAdministrationView>($"/api/v1/residents/{id}"))!;
                Assert.Null(profile.RoomId); Assert.NotEmpty(profile.Tenancies);
            }
            var dates = await db.Database.SqlQuery<DateOnly>($"""
                SELECT actual_move_out_date AS "Value" FROM contract_residents WHERE contract_id={w.Contract}
                """).ToArrayAsync();
            Assert.All(dates, date => Assert.Equal(today, date));
            if (otherOccupancy) Assert.True(await db.Set<Resident>().AnyAsync(r => r.RoomId == w.Room && !ids.Contains(r.Id)));
        }
    }
}
