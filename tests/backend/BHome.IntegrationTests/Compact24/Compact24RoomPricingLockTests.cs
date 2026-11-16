using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
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
            var person = new Resident
            {
                RoomId = w.Room,
                OwnerUserId = w.Owner.Id,
                TenantUserId = w.Tenant.Id,
                DisplayLabel = "Synthetic pricing lock",
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            residentId = person.Id; db.Add(person);
            db.Add(new BillingPolicy
            {
                LocationId = w.Location,
                RoomId = w.Room,
                Category = ChargeCategory.Rent,
                ChargeCode = "RENT",
                Name = "Rent",
                Method = ChargingMethod.FixedPerRoomPerMonth,
                Rate = 3000000,
                EffectiveFrom = Today
            });
            db.Add(new BillingPolicy
            {
                LocationId = w.Location,
                Category = ChargeCategory.Electricity,
                ChargeCode = "ELECTRICITY",
                Name = "Electricity",
                Method = ChargingMethod.Metered,
                Rate = 3500,
                EffectiveFrom = Today
            });
            db.Add(new BillingPolicy
            {
                LocationId = w.Location,
                Category = ChargeCategory.Water,
                ChargeCode = "WATER",
                Name = "Water",
                Method = ChargingMethod.Metered,
                Rate = 12000,
                EffectiveFrom = Today
            });
            await db.SaveChangesAsync();
        }
        var input = new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, residentId, [residentId], Today,
            Today.AddYears(1), DateTimeOffset.UtcNow.AddDays(1), 1000000, "Synthetic holding pricing lock");
        var charge = new PolicyWrite(w.Location, w.Room, ChargeCategory.Water, "WATER", "Water",
            ChargingMethod.Metered, 15000, Today, null);
        var water = await Read<PolicyDto>(await owner.PostAsJsonAsync("/api/v1/billing-policies", charge));
        var tariffInput = Tariff(w.Location, Today);
        var tariff = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-tariffs", tariffInput));
        var profileInput = new UtilityProfileWrite(w.Location, w.Room, UtilityType.Electricity, tariff.Id, Today, null, false, false);
        var holding = await Read<ContractId>(await Keyed(owner, "/api/v1/contracts/holdings", input, Guid.NewGuid()));
        await Read<ContractView>(await Keyed(owner, $"/api/v1/contracts/{holding.Id}/holding-approval", new HoldingDecisionInput("Approved"), Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/utility-profiles", profileInput)).StatusCode);
        // Simulate existing data from before the contract/profile mutual exclusion.
        // Do not relax the public contract-creation or profile-creation guards.
        SetupDocument profile;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            profile = await store.TransactionAsync(w.Location, () => store.SaveAsync(Guid.NewGuid(), w.Location,
                "UtilityProfile", "Recorded", profileInput, 0, w.Owner.Id, default), default);
        }
        var tariffRoute = $"/api/v1/utility-tariffs/{tariff.Id}/replacement";
        var tariffNext = tariffInput with { EffectiveFrom = Today.AddDays(2), Tiers = [new(null, 2400)] };
        var tariffBlocked = await owner.PostAsJsonAsync(tariffRoute, tariffNext);
        Assert.Equal(HttpStatusCode.Conflict, tariffBlocked.StatusCode);
        Assert.Contains("utility_tariff_locked_by_contract", await tariffBlocked.Content.ReadAsStringAsync());
        Assert.Equal(tariff.Id, (await Read<SetupDocument>(await owner.PostAsJsonAsync(tariffRoute, tariffInput))).Id);
        var profileRoute = $"/api/v1/utility-profiles/{profile.Id}/replacement";
        var sameProfile = await Read<SetupDocument>(await owner.PostAsJsonAsync(profileRoute, profileInput with { ExpectedVersion = profile.Version }));
        Assert.Equal(profile.Id, sameProfile.Id); Assert.Equal(profile.Version, sameProfile.Version);
        var profileNext = profileInput with { ExpectedVersion = profile.Version, EffectiveFrom = Today.AddDays(2), RequireQuota = true };
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(profileRoute, profileNext)).StatusCode);
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
        var newTariff = await Read<SetupDocument>(await owner.PostAsJsonAsync(tariffRoute, tariffNext));
        var newProfile = await Read<SetupDocument>(await owner.PostAsJsonAsync(profileRoute, profileNext with { TariffId = newTariff.Id }));
        Assert.NotEqual(tariff.Id, newTariff.Id); Assert.NotEqual(profile.Id, newProfile.Id);
        var retryProfile = await Read<SetupDocument>(await owner.PostAsJsonAsync(profileRoute, profileNext with { TariffId = newTariff.Id }));
        Assert.Equal(newProfile.Id, retryProfile.Id); Assert.Equal(newProfile.Version, retryProfile.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(profileRoute, profileNext with { TariffId = newTariff.Id, RequireQuota = false })).StatusCode);
        var released = await owner.PostAsJsonAsync($"/api/v1/billing-policies/{water.Id}/end", new PolicyEnd(Today.AddDays(1), water.Version, "Synthetic reason"));
        Assert.True(released.IsSuccessStatusCode, await released.Content.ReadAsStringAsync());
    }

    [CompactPostgresFact]
    public async Task SuccessorsAcrossRoomAndLocationScopesPreserveExactHoldingReferencesAndSelectNewOffers()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var today = Today; var cutover = today.AddDays(2);
        Guid residentId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var resident = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, TenantUserId = w.Tenant.Id,
                DisplayLabel = "Synthetic successor resident", VerificationStatus = IdentityVerificationStatus.Verified };
            residentId = resident.Id; db.Add(resident); await db.SaveChangesAsync();
        }
        PolicyWrite[] inputs = [
            new(w.Location, w.Room, ChargeCategory.Rent, "RENT", "Rent", ChargingMethod.FixedPerRoomPerMonth, 3000000, today, null),
            new(w.Location, null, ChargeCategory.Electricity, "ELECTRICITY", "Electricity", ChargingMethod.Metered, 3500, today, null),
            new(w.Location, w.Room, ChargeCategory.Water, "WATER", "Water", ChargingMethod.Metered, 12000, today, null),
            new(w.Location, null, ChargeCategory.ServiceFee, "INTERNET", "Internet", ChargingMethod.FixedPerRoomPerMonth, 100000, today, null)
        ];
        var originals = new List<PolicyDto>();
        foreach (var input in inputs)
            originals.Add(await Read<PolicyDto>(await owner.PostAsJsonAsync("/api/v1/billing-policies", input)));
        var shadowed = await Read<PolicyDto>(await owner.PostAsJsonAsync("/api/v1/billing-policies", inputs[2] with { RoomId = null, Rate = 15000 }));
        var holdingInput = new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, residentId, [residentId], today,
            today.AddYears(1), DateTimeOffset.UtcNow.AddDays(1), 1000000, "Synthetic successor holding");
        var holding = await Read<ContractId>(await Keyed(owner, "/api/v1/contracts/holdings", holdingInput, Guid.NewGuid()));
        await Read<ContractView>(await Keyed(owner, $"/api/v1/contracts/{holding.Id}/holding-approval", new HoldingDecisionInput("Approved"), Guid.NewGuid()));

        async Task<Contract> LoadContract(Guid id)
        {
            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            return await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).SingleAsync(c => c.Id == id);
        }
        async Task<PolicyDto> LoadPolicy(Guid id) => await Read<PolicyDto>(await owner.GetAsync($"/api/v1/billing-policies/{id}"));
        var sealedBefore = await LoadContract(holding.Id);
        var snapshot = ContractChargeSnapshot.Read(sealedBefore);
        Assert.True(ContractChargeSnapshot.IsIntact(sealedBefore));
        Assert.Equal(0, (await LoadPolicy(shadowed.Id)).BindingContractCount);
        Assert.Null((await LoadPolicy(shadowed.Id)).LastContractEndDate);
        var successors = new List<PolicyDto>();
        for (var i = 0; i < inputs.Length; i++)
        {
            var original = originals[i]; var input = inputs[i];
            var before = await LoadPolicy(original.Id);
            Assert.Equal(1, before.BindingContractCount); Assert.Equal(holdingInput.EndDate, before.LastContractEndDate);
            var reference = snapshot.Charges.Single(c => c.ChargeCode == original.ChargeCode);
            Assert.Equal(original.Id, reference.PolicyId); Assert.Equal(original.Version, reference.Version);
            Assert.Equal(w.Location, reference.PolicyLocationId); Assert.Equal(original.RoomId, reference.PolicyRoomId);
            var noop = await Read<PolicyDto>(await owner.PostAsJsonAsync($"/api/v1/billing-policies/{original.Id}/replacement",
                new PolicyReplacement(input with { EffectiveFrom = cutover }, original.Version)));
            Assert.Equal(original.Id, noop.Id); Assert.Equal(original.Version, noop.Version);
            var successor = await Read<PolicyDto>(await owner.PostAsJsonAsync($"/api/v1/billing-policies/{original.Id}/replacement",
                new PolicyReplacement(input with { EffectiveFrom = cutover, Rate = input.Rate + 100 }, original.Version)));
            successors.Add(successor);
            Assert.NotEqual(original.Id, successor.Id); Assert.Equal(original.Id, successor.FamilyId);
            Assert.Equal(original.Id, successor.PreviousPolicyId); Assert.Equal(2, successor.Edition);
            var prior = await LoadPolicy(original.Id);
            Assert.Equal(cutover.AddDays(-1), prior.EffectiveTo); Assert.Equal(holdingInput.EndDate, prior.LastContractEndDate);
            Assert.Equal(original.Rate, prior.Rate); Assert.Equal(1, prior.BindingContractCount);
            var next = await LoadPolicy(successor.Id);
            Assert.Equal(2, next.Edition); Assert.Equal(original.Id, next.FamilyId); Assert.True(next.CanEditInPlace);
            Assert.Equal(0, next.BindingContractCount); Assert.Null(next.LastContractEndDate);
            var stale = await owner.PostAsJsonAsync($"/api/v1/billing-policies/{original.Id}/replacement",
                new PolicyReplacement(input with { EffectiveFrom = cutover, Rate = input.Rate + 500 }, original.Version));
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        }
        var sealedAfter = await LoadContract(holding.Id);
        Assert.Equal(sealedBefore.AgreedPriceSnapshot, sealedAfter.AgreedPriceSnapshot);
        Assert.Equal(sealedBefore.SnapshotHash, sealedAfter.SnapshotHash);
        var missing = new List<string>();
        var billed = ContractBillingPrices.Read(sealedAfter, w.Location, missing);
        Assert.Empty(missing);
        Assert.All(originals, p => Assert.Equal(p.Rate, billed.Single(c => c.ChargeCode == p.ChargeCode).Rate));
        var oldOffers = await Read<ResolvedPrices>(await owner.GetAsync($"/api/v1/rooms/{w.Room}/prices?effectiveOn={today:yyyy-MM-dd}"));
        var newOffers = await Read<ResolvedPrices>(await owner.GetAsync($"/api/v1/rooms/{w.Room}/prices?effectiveOn={cutover:yyyy-MM-dd}"));
        Assert.Equal(originals.Select(p => p.Id).Order(), oldOffers.Charges.Select(p => p.Id).Order());
        Assert.Equal(successors.Select(p => p.Id).Order(), newOffers.Charges.Select(p => p.Id).Order());
        var unused = successors[3];
        var edited = await Read<PolicyDto>(await owner.PutAsJsonAsync($"/api/v1/billing-policies/{unused.Id}",
            new PolicyUpdate(inputs[3] with { EffectiveFrom = cutover, Rate = unused.Rate + 100 }, unused.Version)));
        Assert.Equal(unused.Id, edited.Id); Assert.Equal(2, edited.Edition); Assert.Equal(unused.Version + 1, edited.Version);
        await Read<ContractView>(await Keyed(owner, $"/api/v1/contracts/{holding.Id}/holding-cancellation",
            new HoldingCancellationInput("Synthetic cancellation", HoldingCancellationCause.TenantVoluntary, true), Guid.NewGuid()));
        var newHolding = await Read<ContractId>(await Keyed(owner, "/api/v1/contracts/holdings",
            holdingInput with { StartDate = cutover, EndDate = cutover.AddYears(1) }, Guid.NewGuid()));
        await Read<ContractView>(await Keyed(owner, $"/api/v1/contracts/{newHolding.Id}/holding-approval", new HoldingDecisionInput("Approved successor"), Guid.NewGuid()));
        var nextSnapshot = ContractChargeSnapshot.Read(await LoadContract(newHolding.Id));
        Assert.All(successors, p => Assert.Equal(p.Id, nextSnapshot.Charges.Single(c => c.ChargeCode == p.ChargeCode).PolicyId));
        Assert.Equal(edited.Rate, nextSnapshot.Charges.Single(c => c.ChargeCode == edited.ChargeCode).Rate);
        Assert.Equal(0, (await LoadPolicy(originals[0].Id)).BindingContractCount);
        Assert.Equal(cutover.AddYears(1), (await LoadPolicy(successors[0].Id)).LastContractEndDate);
    }
}
