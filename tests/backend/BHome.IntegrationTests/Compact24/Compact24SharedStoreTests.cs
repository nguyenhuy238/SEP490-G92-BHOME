using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24SharedStoreTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private sealed class User(Guid? id, string role) : ICurrentUser { public Guid? UserId => id; public bool IsInRole(string value) => value == role; }
    private sealed class Validator : ISharedDataValidator
    {
        public bool Supports(string resource) => resource == "store-test";
        public Task<JsonElement> ValidateAsync(string resource, JsonElement data, CancellationToken t) => Task.FromResult(data);
    }
    [CompactPostgresFact]
    public async Task GlobalDocumentsPersistHistoryAndRollbackWithoutFabricatedLocation()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var actor = await db.Users.FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner));
        actor ??= await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.invalid", EmailConfirmed = true }, Roles.Owner, "Synthetic!Shared-9273");
        var store = scope.ServiceProvider.GetRequiredService<ISharedConfigurationStore>(); var now = DateTimeOffset.UtcNow;
        var document = new SharedDocument(Guid.NewGuid(), "store-test", Guid.NewGuid(), 1, 1, Guid.NewGuid().ToString("N"), "Synthetic", "Draft", "BHOME", actor.Id, now, actor.Id, now, JsonSerializer.SerializeToElement(new { capacity = 3 }));
        await store.TransactionAsync([], async () => { await store.SaveAsync(document, 0, default); return true; }, default);
        await store.TransactionAsync([], async () => { await store.SaveAsync(document with { Version = 2, Status = "Published" }, 1, default); return true; }, default);
        Assert.Equal(2, (await store.GetAsync(document.Id, "store-test", default))!.Version);
        Assert.Equal(new[] { 1, 2 }, (await store.HistoryAsync(document.Id, default)).Select(x => x.Version));
        Assert.True(await store.NameExistsAsync("store-test", document.Name.ToUpperInvariant(), Guid.NewGuid(), default));
        Assert.Single((await store.ListAsync("store-test", document.Name, "Published", 1, 10, default)).Items);
        await Assert.ThrowsAsync<InvalidOperationException>(() => store.TransactionAsync<bool>([], async () => { await store.SaveAsync(document with { Id = Guid.NewGuid() }, 0, default); throw new InvalidOperationException("Synthetic rollback"); }, default));
        Assert.Equal(1, (await store.ListAsync("store-test", document.Name, "", 1, 10, default)).Total);
        var nullLocations = await db.Database.SqlQueryRaw<int>("SELECT count(*)::integer AS \"Value\" FROM operational_tasks WHERE task_data->>'recordType'='SharedConfiguration' AND id={0} AND location_id IS NULL", document.Id).SingleAsync();
        Assert.Equal(1, nullLocations);
        var service = new SharedConfigurationService(store, new Validator(), new User(actor.Id, Roles.Owner), TimeProvider.System);
        var draft = await service.SaveAsync("store-test", null, new(Guid.NewGuid().ToString("N"), "Synthetic", document.Data), default);
        var published = await service.TransitionAsync("store-test", draft.Id, new(1), false, default);
        Assert.Equal("Published", published.Status);
        var immutable = await Assert.ThrowsAsync<PropertyException>(() => service.SaveAsync("store-test", draft.Id, new(draft.Name, "changed", document.Data, 2), default));
        Assert.Equal(409, immutable.Status);
        var next = await service.DeriveAsync("store-test", draft.Id, new("", 2), true, default);
        Assert.Equal(draft.FamilyId, next.FamilyId); Assert.Equal(2, next.Edition); Assert.Equal(1, next.Version);
        var duplicate = await service.DeriveAsync("store-test", draft.Id, new(Guid.NewGuid().ToString("N"), 2), false, default);
        Assert.NotEqual(draft.FamilyId, duplicate.FamilyId);
        foreach (var role in new[] { Roles.Staff, Roles.Tenant })
        {
            var forbidden = new SharedConfigurationService(store, new Validator(), new User(actor.Id, role), TimeProvider.System);
            Assert.Equal(403, (await Assert.ThrowsAsync<PropertyException>(() => forbidden.GetAsync("store-test", draft.Id, default))).Status);
        }
        Assert.Equal(401, (await Assert.ThrowsAsync<PropertyException>(() => new SharedConfigurationService(store, new Validator(), new User(null, ""), TimeProvider.System).GetAsync("store-test", draft.Id, default))).Status);
    }
}
