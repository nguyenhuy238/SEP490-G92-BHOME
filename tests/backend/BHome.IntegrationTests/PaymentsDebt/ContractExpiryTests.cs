using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task ExpiryJobDoesNotOpenMoveOutWhileRenewalIsPending()
    {
        var w = await Setup();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            var main = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract);
            main.EndDate = today.AddDays(-1);
            db.Add(new Contract
            {
                RoomId = main.RoomId,
                Kind = ContractKind.Renewal,
                Status = ContractStatus.Draft,
                OwnerSignerId = main.OwnerSignerId,
                TenantUserId = main.TenantUserId,
                RepresentativeResidentId = main.RepresentativeResidentId,
                PreviousContractId = main.Id,
                StartDate = today,
                EndDate = today.AddYears(1),
                MonthlyRent = main.MonthlyRent,
                Terms = "Synthetic pending renewal"
            });
            await db.SaveChangesAsync();
        }
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>()
                .Single(h => h.Name == "contract-expiry");
            await handler.ExecuteAsync(new(Guid.NewGuid(), "pending-renewal", "{}"), default);
        }
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            Assert.False(await db.Set<ContractMoveOut>().AnyAsync(m => m.ContractId == w.Contract));
            Assert.Equal(ContractStatus.Active, (await db.Set<Contract>()
                .SingleAsync(c => c.Id == w.Contract)).Status);
        }
    }

    [Fact]
    public async Task ExpiryJobDeduplicatesParallelRunsPreservesOccupancyAndScopesRecipients()
    {
        var w = await Setup(); var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        Guid future, expired;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            var contracts = await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync();
            future = contracts.Single(c => c.TenantUserId == w.Tenants[1]).Id; expired = contracts.Single(c => c.TenantUserId == w.Tenants[2]).Id;
            contracts.Single(c => c.Id == w.Contract).EndDate = today.AddDays(30); contracts.Single(c => c.Id == future).EndDate = today.AddDays(31); contracts.Single(c => c.Id == expired).EndDate = today.AddDays(-1);
            await db.SaveChangesAsync();
        }
        async Task Run()
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "contract-expiry");
            await handler.ExecuteAsync(new(Guid.NewGuid(), "synthetic-expiry", "{}"), default);
        }
        await Task.WhenAll(Run(), Run()); await Run();
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var notices = (await tenant.GetFromJsonAsync<ContractExpiryNoticeView[]>("/api/v1/contracts/expiry-reminders"))!;
        Assert.Single(notices); Assert.Equal(w.Contract, notices[0].ContractId); Assert.Equal("Upcoming30", notices[0].Stage);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/contracts/expiry-reminders")).StatusCode);
        var owners = (await owner.GetFromJsonAsync<ContractExpiryNoticeView[]>("/api/v1/contracts/expiry-reminders"))!;
        Assert.Single(owners, n => n.ContractId == w.Contract); Assert.Single(owners, n => n.ContractId == expired); Assert.DoesNotContain(owners, n => n.ContractId == future);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            Assert.Equal(4, await db.Set<ContractExpiryNotice>().CountAsync(n => n.ContractId == w.Contract || n.ContractId == expired || n.ContractId == future));
            var expiryMoveOut = Assert.Single(await db.Set<ContractMoveOut>()
                .Where(m => m.ContractId == expired).ToArrayAsync());
            Assert.True(expiryMoveOut.IsExpiry);
            Assert.Equal(MoveOutStatus.Approved, expiryMoveOut.Status);
            Assert.Equal(today.AddDays(-1), expiryMoveOut.ProposedDate);
            Assert.Null(expiryMoveOut.ApprovedByUserId); // Trigger is system-origin, not signed Owner consent.
            Assert.Null(expiryMoveOut.InspectionStaffId);
            Assert.Null(expiryMoveOut.InspectionScheduledAt);
            Assert.Equal("inspection_and_financial_dependencies", expiryMoveOut.PendingReason);
            Assert.Equal(1, await db.Set<ContractMoveOutHistory>().CountAsync(h =>
                h.ContractId == expired && h.Action == "ExpiryInspectionOpenedBySystem"));
            Assert.False(await db.Set<ContractMoveOut>().AnyAsync(m => m.ContractId == future));
            Assert.Equal(3, await db.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
            Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
            await db.Set<Contract>().Where(c => c.Id == w.Contract).ExecuteUpdateAsync(s => s.SetProperty(c => c.EndDate, today.AddDays(29)));
        }
        await Run();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence(); Assert.Equal(4, await db.Set<ContractExpiryNotice>().CountAsync(n => n.ContractId == w.Contract));
            Assert.Equal(1, await db.Set<ContractMoveOut>().CountAsync(m => m.ContractId == expired));
            Assert.Single((await tenant.GetFromJsonAsync<ContractExpiryNoticeView[]>("/api/v1/contracts/expiry-reminders"))!);
            await db.Set<Contract>().Where(c => c.Id == w.Contract).ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, ContractStatus.Terminated));
        }
        await Run(); Assert.Empty((await tenant.GetFromJsonAsync<ContractExpiryNoticeView[]>("/api/v1/contracts/expiry-reminders"))!);
    }
}
