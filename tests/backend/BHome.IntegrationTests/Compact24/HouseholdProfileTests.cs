using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task HouseholdCrudIsEncryptedVersionedIdempotentCapacityCheckedAndTenantScoped()
    {
        var w = await Seed();
        var keyMaterial = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["IdentityProtection:ActiveEncryptionVersion"] = "family-test",
            ["IdentityProtection:ActiveHmacVersion"] = "family-test",
            ["IdentityProtection:EncryptionKeys:family-test"] = keyMaterial,
            ["IdentityProtection:HmacKeys:family-test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        })));
        int usersBefore;
        ApplicationUser unassignedStaff;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            unassignedStaff = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.invalid", EmailConfirmed = true }, "Staff", Password);
            usersBefore = await db.Users.CountAsync();
            foreach (var c in await db.Set<Contract>().Where(c => w.Contracts.Contains(c.Id)).ToArrayAsync()) c.Status = ContractStatus.Cancelled;
            var room = await db.Set<Room>().SingleAsync(r => r.Id == w.Room); room.Capacity = 3;
            await db.SaveChangesAsync();
        }
        using var staff = await Client(w.Staff, host);
        using var tenant = await Client(w.Tenants[0], host);
        using var otherTenant = await Client(w.Tenants[1], host);
        var path = $"/api/v1/capture/residents/{w.Residents[0]}/household";
        using var outside = await Client(unassignedStaff, host);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.PutAsJsonAsync(path, new HouseholdSaveInput(0, true, []))).StatusCode);
        async Task<HttpResponseMessage> Save(HouseholdSaveInput input, Guid key)
        {
            var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", key.ToString()); return await staff.SendAsync(request);
        }
        var input = new HouseholdSaveInput(0, true, [new("child-one", "SYNTHETIC FAMILY CHILD", new(2015, 1, 1), "Con")]);
        var key = Guid.NewGuid();
        var responses = await Task.WhenAll(Save(input, key), Save(input, key));
        foreach (var response in responses) Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var first = (await responses[0].Content.ReadFromJsonAsync<HouseholdView>())!;
        var child = Assert.Single(first.Members);
        Assert.Equal(child.ResidentId, Assert.Single((await responses[1].Content.ReadFromJsonAsync<HouseholdView>())!.Members).ResidentId);
        var stale = await Save(input, Guid.NewGuid()); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Contains("household_version_changed", await stale.Content.ReadAsStringAsync());
        var mismatch = await Save(input with { Members = [input.Members[0] with { FullName = "DIFFERENT SYNTHETIC NAME" }] }, key);
        Assert.Equal(HttpStatusCode.Conflict, mismatch.StatusCode);
        var updatedInput = new HouseholdSaveInput(first.Version, true, [new("child-one", "SYNTHETIC EDITED CHILD", new(2015, 1, 1), "Con", "0900000001", null, child.ResidentId)]);
        var updatedResponse = await Save(updatedInput, Guid.NewGuid()); updatedResponse.EnsureSuccessStatusCode();
        var updated = (await updatedResponse.Content.ReadFromJsonAsync<HouseholdView>())!;
        Assert.Equal(child.ResidentId, Assert.Single(updated.Members).ResidentId);
        Assert.Equal("SYNTHETIC EDITED CHILD", (await staff.GetFromJsonAsync<HouseholdView>(path))!.Members[0].FullName);
        var oversized = await Save(new(updated.Version, true, [updatedInput.Members[0], new("two", "SYNTHETIC TWO", new(2016, 1, 1), "Con"), new("three", "SYNTHETIC THREE", new(2017, 1, 1), "Con")]), Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Conflict, oversized.StatusCode);
        await using (var check = host.Services.CreateAsyncScope())
        {
            var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var representative = await db.Set<Resident>().SingleAsync(r => r.Id == w.Residents[0]);
            var index = check.ServiceProvider.GetRequiredService<IIdentityProtection>().CreateMatchIndex("000000000123", representative.OwnerUserId);
            representative.IdentityHmac = index.Digest; representative.HmacKeyVersion = index.KeyVersion;
            await db.SaveChangesAsync();
        }
        var duplicate = await Save(new(updated.Version, true, [updatedInput.Members[0] with { FullName = "SHOULD ROLL BACK" }, new("duplicate", "SYNTHETIC DUPLICATE", new(2016, 1, 1), "Con", null, "000000000123")]), Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Contains("duplicate_or_conflicting_record", await duplicate.Content.ReadAsStringAsync());
        Assert.Equal("SYNTHETIC EDITED CHILD", Assert.Single((await staff.GetFromJsonAsync<HouseholdView>(path))!.Members).FullName);
        await using (var check = host.Services.CreateAsyncScope())
        {
            var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(usersBefore, await db.Users.CountAsync());
            var saved = await db.Set<Resident>().SingleAsync(r => r.Id == child.ResidentId);
            Assert.DoesNotContain("SYNTHETIC", saved.HouseholdProfile); Assert.Null(saved.TenantUserId);
            Assert.Equal(1, await db.Set<Resident>().CountAsync(r => r.HouseholdRepresentativeId == w.Residents[0]));
            var c = await db.Set<Contract>().Include(c => c.Residents).SingleAsync(c => c.Id == w.Contracts[0]);
            c.Status = ContractStatus.Active; c.Residents.Add(new ContractResident { ContractId = c.Id, ResidentId = child.ResidentId, Role = ResidentType.CoOccupant, ResidenceFrom = c.StartDate });
            await db.SaveChangesAsync();
        }
        var own = await tenant.GetFromJsonAsync<HouseholdView>($"/api/v1/contracts/{w.Contracts[0]}/household");
        Assert.Equal("SYNTHETIC EDITED CHILD", Assert.Single(own!.Members).FullName);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.GetAsync($"/api/v1/contracts/{w.Contracts[0]}/household")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Save(updatedInput with { ExpectedVersion = updated.Version, Members = [] }, Guid.NewGuid())).StatusCode);
        await using (var check = host.Services.CreateAsyncScope())
        {
            var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var c = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contracts[0]); c.Status = ContractStatus.Cancelled; await db.SaveChangesAsync();
        }
        var removed = await Save(new(updated.Version, true, []), Guid.NewGuid()); removed.EnsureSuccessStatusCode();
        Assert.Empty((await removed.Content.ReadFromJsonAsync<HouseholdView>())!.Members);
        Assert.Empty((await staff.GetFromJsonAsync<HouseholdView>(path))!.Members);
    }

    [CompactPostgresFact]
    public async Task HouseholdDraftRosterAdditionPersistsPhysicalVersionAndEncryptedHistoryAndRemovalRollsBack()
    {
        var w = await Seed();
        using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["IdentityProtection:ActiveEncryptionVersion"] = "family-draft-test",
            ["IdentityProtection:ActiveHmacVersion"] = "family-draft-test",
            ["IdentityProtection:EncryptionKeys:family-draft-test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            ["IdentityProtection:HmacKeys:family-draft-test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        })));
        Guid draftId;
        string oldHash;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            foreach (var contract in await db.Set<Contract>().Where(c => w.Contracts.Contains(c.Id)).ToArrayAsync())
                contract.Status = ContractStatus.Cancelled;
            await db.SaveChangesAsync();
            var draft = new Contract
            {
                RoomId = w.Room, OwnerSignerId = w.Owner.Id, RepresentativeResidentId = w.Residents[0],
                StartDate = Today, EndDate = Today.AddMonths(6), MonthlyRent = 100_000m, RequiredDeposit = 100_000m
            };
            draft.Residents.Add(new ContractResident { ContractId = draft.Id, ResidentId = w.Residents[0], ResidenceFrom = Today });
            var state = new MainDraftState(new(w.Room, w.Residents[0], [w.Residents[0]], draft.StartDate, draft.EndDate,
                "", null, ""), [], 1, "synthetic-settings", "synthetic-template");
            draft.DraftMetadata = scope.ServiceProvider.GetRequiredService<IMainDraftData>().Protect(draft, state);
            oldHash = draft.SnapshotHash = MainDraftService.Snapshot(draft, state);
            db.Add(draft); await db.SaveChangesAsync(); draftId = draft.Id;
        }
        using var staff = await Client(w.Staff, host);
        async Task<HttpResponseMessage> Save(HouseholdSaveInput input)
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/capture/residents/{w.Residents[0]}/household")
            { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            return await staff.SendAsync(request);
        }
        const string name = "SYNTHETIC DRAFT FAMILY";
        var response = await Save(new(0, true, [new("child", name, new(2015, 1, 1), "Con")]));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var saved = (await response.Content.ReadFromJsonAsync<HouseholdView>())!;
        var child = Assert.Single(saved.Members);
        Assert.Equal(draftId, saved.DraftId);
        string newHash;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var physical = await db.Set<Native.Contract>().AsNoTracking().SingleAsync(c => c.Id == draftId);
            Assert.Equal(2, physical.Version); Assert.NotEqual(oldHash, physical.SnapshotHash);
            newHash = physical.SnapshotHash!;
            var history = physical.History.EnumerateArray().Where(h => h.GetProperty("recordType").GetString() == "Contract").ToArray();
            Assert.Equal(2, history.Length);
            Assert.Equal(oldHash, history[0].GetProperty("state").GetProperty("snapshotHash").GetString());
            Assert.Equal(newHash, history[1].GetProperty("state").GetProperty("snapshotHash").GetString());
            Assert.DoesNotContain(name, physical.History.GetRawText());
            var roster = await db.Set<Native.ContractResident>().AsNoTracking().Where(r => r.ContractId == draftId).ToArrayAsync();
            Assert.Equal(2, roster.Length);
            var member = Assert.Single(roster, r => r.ResidentId == child.ResidentId);
            Assert.Equal((short)ResidentType.CoOccupant, member.ResidentRole);
            Assert.Equal("ContractResident", Assert.Single(member.History.EnumerateArray()).GetProperty("recordType").GetString());
            var resident = await db.Set<Native.Resident>().AsNoTracking().SingleAsync(r => r.Id == child.ResidentId);
            Assert.DoesNotContain(name, resident.History.GetRawText());
            var legacy = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).SingleAsync(c => c.Id == draftId);
            var state = scope.ServiceProvider.GetRequiredService<IMainDraftData>().Unprotect(legacy);
            Assert.Equal(2, state.Input.ExpectedVersion);
            Assert.Equal(new[] { w.Residents[0], child.ResidentId }, state.Input.ResidentIds);
            Assert.Equal(newHash, MainDraftService.Snapshot(legacy, state));
        }
        // The existing schema forbids deleting a bound ContractResident. The
        // historical failure must roll back both the roster and encrypted profile.
        Assert.Equal(HttpStatusCode.InternalServerError, (await Save(new(saved.Version, true, []))).StatusCode);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var physical = await db.Set<Native.Contract>().AsNoTracking().SingleAsync(c => c.Id == draftId);
            Assert.Equal(2, physical.Version); Assert.Equal(newHash, physical.SnapshotHash);
            Assert.Equal(2, await db.Set<Native.ContractResident>().CountAsync(r => r.ContractId == draftId));
        }
        var reloaded = (await staff.GetFromJsonAsync<HouseholdView>($"/api/v1/capture/residents/{w.Residents[0]}/household"))!;
        Assert.Equal(saved.Version, reloaded.Version);
        Assert.Equal(child.ResidentId, Assert.Single(reloaded.Members).ResidentId);
    }
}
