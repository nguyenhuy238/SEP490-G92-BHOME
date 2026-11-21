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
    public async Task ExpiryJobDeduplicatesParallelRunsPreservesOccupancyAndScopesRecipients()
    {
        var w = await Setup(); var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        Guid future, expired;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
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
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            Assert.Equal(4, await db.Set<ContractExpiryNotice>().CountAsync(n => n.ContractId == w.Contract || n.ContractId == expired || n.ContractId == future));
            Assert.Equal(3, await db.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
            Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
            await db.Set<Contract>().Where(c => c.Id == w.Contract).ExecuteUpdateAsync(s => s.SetProperty(c => c.EndDate, today.AddDays(29)));
        }
        await Run();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); Assert.Equal(4, await db.Set<ContractExpiryNotice>().CountAsync(n => n.ContractId == w.Contract));
            Assert.Single((await tenant.GetFromJsonAsync<ContractExpiryNoticeView[]>("/api/v1/contracts/expiry-reminders"))!);
            await db.Set<Contract>().Where(c => c.Id == w.Contract).ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, ContractStatus.Terminated));
        }
        await Run(); Assert.Empty((await tenant.GetFromJsonAsync<ContractExpiryNoticeView[]>("/api/v1/contracts/expiry-reminders"))!);
    }
}
