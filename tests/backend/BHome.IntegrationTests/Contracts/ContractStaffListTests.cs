using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

public sealed partial class ContractLifecycleApiTests
{
    internal async Task HoldingSettingsAreLocationScopedVersionedAndDoNotRewriteCreatedContracts()
    {
        var w = await Setup(); var outside = await Setup();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            foreach (var site in new[] { w, outside }) db.Add(new BillingPolicy
            {
                LocationId = site.Location,
                RoomId = site.Room,
                Category = ChargeCategory.Rent,
                ChargeCode = "RENT",
                Name = "Synthetic Holding configuration rate",
                Method = ChargingMethod.FixedPerRoomPerMonth,
                Rate = site == w ? 3000000 : 4000000,
                EffectiveFrom = Today
            });
            await db.SaveChangesAsync();
        }
        var path = $"/api/v1/contracts/holding-settings/{w.Location}";
        var config = new HoldingSettingsInput(2, 1.5m, "Synthetic location A terms", 0);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.PutAsJsonAsync(path, config)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await w.Owner.Client.PutAsJsonAsync(path, config)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await w.Owner.Client.PutAsJsonAsync($"/api/v1/contracts/holding-settings/{outside.Location}", new HoldingSettingsInput(1, 1m, "Synthetic location B terms", 0))).StatusCode);
        var quote = await Success<HoldingPreparation>(await w.Staff.Client.GetAsync($"/api/v1/contracts/holdings/preparation?roomId={w.Room}"));
        Assert.Equal(4500000, quote.HoldingDeposit); Assert.Equal(2, quote.HoldingMonths);
        var other = await Success<HoldingPreparation>(await outside.Staff.Client.GetAsync($"/api/v1/contracts/holdings/preparation?roomId={outside.Room}"));
        Assert.Equal(4000000, other.HoldingDeposit); Assert.Equal(1, other.HoldingMonths);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Staff.Client.GetAsync($"/api/v1/contracts/holdings/preparation?roomId={w.Room}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PutAsJsonAsync(path, config)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await w.Owner.Client.PutAsJsonAsync(path, config with { HoldingMonths = 3, DepositRentMonths = 2, ExpectedVersion = 1 })).StatusCode);
        var stale = new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, w.Resident, [w.Resident], quote.StartDate, quote.EndDate, quote.ExpiresAt, quote.HoldingDeposit, quote.Terms, 1, quote.SettingsVersion);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Staff, "/api/v1/contracts/holdings", stale)).StatusCode);
        quote = await Success<HoldingPreparation>(await w.Staff.Client.GetAsync($"/api/v1/contracts/holdings/preparation?roomId={w.Room}"));
        var id = (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts/holdings", stale with { StartDate = quote.StartDate, EndDate = quote.EndDate, ExpiresAt = quote.ExpiresAt, HoldingDeposit = quote.HoldingDeposit, SettingsVersion = quote.SettingsVersion }))).Id;
        Assert.Equal(HttpStatusCode.NoContent, (await w.Owner.Client.PutAsJsonAsync(path, config with { HoldingMonths = 4, ExpectedVersion = 2 })).StatusCode);
        var created = await Success<ContractView>(await w.Staff.Client.GetAsync(Path(id)));
        Assert.Equal(6000000, created.RequiredDeposit); Assert.Equal(quote.EndDate, created.EndDate);
    }
    [Fact]
    public async Task StaffListIncludesHoldingAndMainWithTypeSpecificFieldsAndPreservesLocationScope()
    {
        var main = await Setup(); var holding = await Setup(); var outside = await Setup();
        var mainId = await Draft(main); var outsideId = await Draft(outside);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            db.Add(new BillingPolicy
            {
                LocationId = holding.Location,
                RoomId = holding.Room,
                Category = ChargeCategory.Rent,
                ChargeCode = "RENT",
                Name = "Synthetic Holding rate",
                Method = ChargingMethod.FixedPerRoomPerMonth,
                Rate = 3000000,
                EffectiveFrom = Today
            });
            await db.SaveChangesAsync();
        }
        var expiry = DateTimeOffset.UtcNow.AddDays(2);
        var input = new HoldingDraftInput(holding.Room, holding.Owner.Id, holding.Tenant.Id, holding.Resident,
            [holding.Resident], Today, Today.AddYears(1), expiry, 750000, "Synthetic Holding list terms", 1);
        var holdingId = (await Success<ContractId>(await Post(holding.Staff, "/api/v1/contracts/holdings", input))).Id;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var prior = await db.StaffLocationAssignments.SingleAsync(a => a.LocationId == holding.Location);
            prior.ChangePeriod(Today.AddDays(-30), Today.AddDays(-1));
            await db.SaveChangesAsync();
            db.Add(new StaffLocationAssignment(holding.Location, main.Staff.Id, holding.Owner.Id, Today, Today.AddDays(30)));
            await db.SaveChangesAsync();
        }
        var response = await main.Staff.Client.GetAsync("/api/v1/contracts?page=1&pageSize=20");
        var page = await Success<ContractPage>(response);
        Assert.Equal(2, page.TotalCount);
        Assert.Contains(page.Items, c => c.Id == mainId && c.Kind == "Main");
        var item = Assert.Single(page.Items, c => c.Id == holdingId);
        Assert.Equal("Holding", item.Kind); Assert.Equal("Draft", item.Status);
        Assert.False(item.OnboardingDraft); Assert.Equal(750000, item.RequiredDeposit);
        Assert.NotNull(item.HoldingExpiresAt);
        Assert.InRange(Math.Abs((item.HoldingExpiresAt.Value - expiry).TotalSeconds), 0, 1);
        Assert.DoesNotContain(page.Items, c => c.Id == outsideId);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var serialized = json.RootElement.GetProperty("items").EnumerateArray().Single(c => c.GetProperty("id").GetGuid() == holdingId);
        Assert.Equal(JsonValueKind.String, serialized.GetProperty("requiredDeposit").ValueKind);
        var drafts = await Success<ContractPage>(await main.Staff.Client.GetAsync("/api/v1/contracts?page=1&pageSize=20&status=Draft"));
        Assert.Equal(2, drafts.TotalCount);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Staff.Client.GetAsync(Path(holdingId))).StatusCode);
    }
}
