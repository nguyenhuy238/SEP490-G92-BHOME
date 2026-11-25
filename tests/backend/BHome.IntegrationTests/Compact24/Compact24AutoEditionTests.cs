using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.TenantContracts;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task ReadyPolicySaveCreatesImmutableFamilyAndSelectsByContractStart()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var input = new OperatingPolicyWrite(w.Location, "Synthetic ready policy", "Original terms", Today.AddDays(-1));
        var v1 = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies/ready", input));
        Assert.Equal("Published", v1.Status);
        var unchanged = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/operating-policies/{v1.Id}/ready", input with { ExpectedVersion = v1.Version }));
        Assert.Equal(v1.Id, unchanged.Id); Assert.Equal(v1.Version, unchanged.Version);
        var v2 = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/operating-policies/{v1.Id}/ready", input with { Content = "New terms", EffectiveFrom = Today.AddDays(2), ExpectedVersion = v1.Version }));
        Assert.NotEqual(v1.Id, v2.Id); Assert.Equal(2, v2.Data.GetProperty("edition").GetInt32());
        Assert.Equal(v1.Id, v2.Data.GetProperty("familyId").GetGuid());
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/operating-policies/{v1.Id}/ready", input with { Content = "Stale edit", EffectiveFrom = Today.AddDays(3), ExpectedVersion = v1.Version })).StatusCode);
        var history = await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/operating-policies/{v2.Id}/family-versions");
        Assert.Equal(new[] { v1.Id, v2.Id }, history!.Select(d => d.Id));
        Assert.Equal("Original terms", history![0].Data.GetProperty("content").GetString());
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var workflow = scope.ServiceProvider.GetRequiredService<IOperatingPolicyWorkflow>();
        var earlier = new Contract { RoomId = w.Room, StartDate = Today, Terms = "Earlier" };
        var later = new Contract { RoomId = w.Room, StartDate = Today.AddDays(2), Terms = "Later" };
        await workflow.BindDraftAsync(earlier, default); await workflow.BindDraftAsync(later, default);
        Assert.Contains("Original terms", earlier.Terms); Assert.DoesNotContain("New terms", earlier.Terms);
        Assert.Contains("New terms", later.Terms);
        var frozen = earlier.OperatingPolicySnapshot;
        await workflow.BindDraftAsync(earlier, default); Assert.Equal(frozen, earlier.OperatingPolicySnapshot);
    }

    [CompactPostgresFact]
    public async Task ReadyAssetTemplateCreatesSuccessorWithoutChangingAssignedRoom()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var item = new AssetTemplateItem(Guid.NewGuid(), "Synthetic chair", "Furniture", "BulkQuantity", 2, "item");
        var input = new AssetTemplateWrite(w.Location, "Synthetic ready assets", [item]);
        var v1 = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/asset-templates/ready", input));
        Assert.Equal("Published", v1.Status);
        var route = $"/api/v1/asset-templates/{v1.Id}/ready";
        var unchanged = await Read<SetupDocument>(await owner.PutAsJsonAsync(route, input with { ExpectedVersion = v1.Version }));
        Assert.Equal(v1.Version, unchanged.Version);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room}/asset-template", new AssetTemplateAssignment(v1.Id)));
        var v2 = await Read<SetupDocument>(await owner.PutAsJsonAsync(route, input with { Items = [item with { Quantity = 4 }], ExpectedVersion = v1.Version }));
        Assert.NotEqual(v1.Id, v2.Id);
        Assert.Equal(2, v2.Data.GetProperty("edition").GetInt32());
        var inventory = await owner.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{w.Room}/asset-inventory");
        Assert.NotNull(inventory);
        Assert.Equal(v1.Id, inventory.AssignedTemplateId);
        Assert.Empty(inventory.Physical);
        var old = await owner.GetFromJsonAsync<SetupDocument>($"/api/v1/asset-templates/{v1.Id}");
        Assert.Equal(2, old!.Data.GetProperty("items")[0].GetProperty("quantity").GetInt32());
    }

    [CompactPostgresFact]
    public async Task TariffSuccessorRetryPreservesOldWindowAndRejectsHistoricalOverlap()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        var input = Tariff(w.Location, Today.AddDays(-10));
        var v1 = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-tariffs", input));
        var route = $"/api/v1/utility-tariffs/{v1.Id}/replacement";
        var same = await Read<SetupDocument>(await owner.PostAsJsonAsync(route, input));
        Assert.Equal(v1.Id, same.Id);
        var next = input with { EffectiveFrom = Today.AddDays(2) };
        var v2 = await Read<SetupDocument>(await owner.PostAsJsonAsync(route, next));
        Assert.NotEqual(v1.Id, v2.Id);
        var retry = await Read<SetupDocument>(await owner.PostAsJsonAsync(route, next));
        Assert.Equal(v2.Id, retry.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/utility-tariffs", input with { EffectiveTo = Today })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task HoldingSettingsHistoryPreservesOldValuesAndNoOpDoesNotCreateVersion()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var route = $"/api/v1/contracts/holding-settings/{w.Location}";
        // The Owner-global policy is shared by all locations in this fixture.
        // Preserve prior revisions regardless of the order of the other tests.
        using var currentResponse = await owner.GetAsync(route);
        var current = currentResponse.StatusCode == HttpStatusCode.NoContent ? null : await Read<HoldingSettings>(currentResponse);
        // Guarantee a pre-existing revision even when this test is run alone.
        var existingTerms = "Synthetic previous policy " + Guid.NewGuid().ToString("N");
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PutAsJsonAsync(route, new HoldingSettingsInput(existingTerms, current?.Version ?? 0))).StatusCode);
        current = await Read<HoldingSettings>(await owner.GetAsync(route));
        var priorHistory = await Read<HoldingSettings[]>(await owner.GetAsync($"{route}/versions"));
        Assert.Contains(priorHistory, d => d.Version == current.Version && d.Terms == existingTerms);
        var terms = "Synthetic holding terms " + Guid.NewGuid().ToString("N");
        var nextTerms = "New terms " + Guid.NewGuid().ToString("N");
        var input = new HoldingSettingsInput(terms, current?.Version ?? 0);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PutAsJsonAsync(route, input)).StatusCode);
        var v1 = await owner.GetFromJsonAsync<HoldingSettings>(route);
        Assert.NotNull(v1);
        Assert.Equal(input.ExpectedVersion + 1, v1.Version);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PutAsJsonAsync(route, input with { ExpectedVersion = v1.Version })).StatusCode);
        Assert.Equal(v1.Version, (await owner.GetFromJsonAsync<HoldingSettings>(route))!.Version);
        var afterNoOp = await Read<HoldingSettings[]>(await owner.GetAsync($"{route}/versions"));
        Assert.Equal(priorHistory.Length + 1, afterNoOp.Length);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PutAsJsonAsync(route, input with { Terms = nextTerms, ExpectedVersion = v1.Version })).StatusCode);
        var history = await owner.GetFromJsonAsync<HoldingSettings[]>($"{route}/versions");
        Assert.Equal(priorHistory.Length + 2, history!.Length);
        Assert.Contains(history, d => d.Version == v1.Version && d.HoldingMonths == 1 && d.Terms == terms);
        Assert.Contains(history, d => d.Version == v1.Version + 1 && d.HoldingMonths == 1 && d.DepositRentMonths == 1 && d.Terms == nextTerms);
        Assert.Equal(priorHistory, history.Skip(2).ToArray());
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"{route}/versions")).StatusCode);
    }
}
