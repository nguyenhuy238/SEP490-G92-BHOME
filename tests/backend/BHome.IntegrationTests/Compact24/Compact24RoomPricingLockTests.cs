using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task ApprovedHoldingLocksRoomChargesUntilCancelledButDoesNotLockLocationOffers()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        Guid residentId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var person = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, TenantUserId = w.Tenant.Id,
                DisplayLabel = "Synthetic pricing lock", VerificationStatus = IdentityVerificationStatus.Verified };
            residentId = person.Id; db.Add(person);
            db.Add(new BillingPolicy { LocationId = w.Location, RoomId = w.Room, Category = ChargeCategory.Rent,
                ChargeCode = "RENT", Name = "Rent", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 3000000, EffectiveFrom = Today });
            db.Add(new BillingPolicy { LocationId = w.Location, Category = ChargeCategory.Electricity,
                ChargeCode = "ELECTRICITY", Name = "Electricity", Method = ChargingMethod.Metered, Rate = 3500, EffectiveFrom = Today });
            db.Add(new BillingPolicy { LocationId = w.Location, Category = ChargeCategory.Water,
                ChargeCode = "WATER", Name = "Water", Method = ChargingMethod.Metered, Rate = 12000, EffectiveFrom = Today });
            await db.SaveChangesAsync();
        }
        var input = new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, residentId, [residentId], Today,
            Today.AddYears(1), DateTimeOffset.UtcNow.AddDays(1), 1000000, "Synthetic holding pricing lock");
        var charge = new PolicyWrite(w.Location, w.Room, ChargeCategory.Water, "WATER", "Water",
            ChargingMethod.Metered, 15000, Today, null);
        var water = await Read<PolicyDto>(await owner.PostAsJsonAsync("/api/v1/billing-policies", charge));
        var holding = await Read<ContractId>(await Keyed(owner, "/api/v1/contracts/holdings", input, Guid.NewGuid()));
        await Read<ContractView>(await Keyed(owner, $"/api/v1/contracts/{holding.Id}/holding-approval", new HoldingDecisionInput("Approved"), Guid.NewGuid()));
        var blocked = await owner.PostAsJsonAsync("/api/v1/billing-policies", charge with { Category = ChargeCategory.Electricity, ChargeCode = "ELECTRICITY" });
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Contains("room_pricing_locked_by_contract", await blocked.Content.ReadAsStringAsync());
        var ended = await owner.PostAsJsonAsync($"/api/v1/billing-policies/{water.Id}/end", new PolicyEnd(Today.AddDays(1), water.Version, "Synthetic reason"));
        Assert.Equal(HttpStatusCode.Conflict, ended.StatusCode);
        Assert.Contains("room_pricing_locked_by_contract", await ended.Content.ReadAsStringAsync());
        var general = await owner.PostAsJsonAsync("/api/v1/billing-policies", charge with { RoomId = null, Category = ChargeCategory.ServiceFee, ChargeCode = "INTERNET", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 20000 });
        Assert.True(general.IsSuccessStatusCode, await general.Content.ReadAsStringAsync());
        var cancelled = await Read<ContractView>(await Keyed(owner, $"/api/v1/contracts/{holding.Id}/holding-cancellation",
            new HoldingCancellationInput("Synthetic cancellation", HoldingCancellationCause.TenantVoluntary, true), Guid.NewGuid()));
        Assert.Equal("Cancelled", cancelled.Status);
        var released = await owner.PostAsJsonAsync($"/api/v1/billing-policies/{water.Id}/end", new PolicyEnd(Today.AddDays(1), water.Version, "Synthetic reason"));
        Assert.True(released.IsSuccessStatusCode, await released.Content.ReadAsStringAsync());
    }
}
