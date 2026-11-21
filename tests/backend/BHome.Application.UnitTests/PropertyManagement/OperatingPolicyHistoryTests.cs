using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class OperatingPolicyHistoryTests
{
    [Theory]
    [InlineData(Roles.Owner, 3)]
    [InlineData(Roles.Staff, 1)]
    public async Task RevisionsAreOrderedAndStaffNeverReceivesDrafts(string role, int count)
    {
        var (service, store, _, _) = Create(role);
        var id = Guid.NewGuid(); var location = Guid.NewGuid();
        var published = Document(id, location, 3, "Published");
        store.GetAsync(id, "OperatingPolicy", default).Returns(published);
        store.HistoryAsync(id, "OperatingPolicy", default).Returns(new[]
        {
            published, Document(Guid.NewGuid(), location, 1, "Published"),
            Document(id, location, 2, "Draft"), Document(id, location, 1, "Draft")
        });
        var history = await service.RevisionsAsync(id, default);
        Assert.Equal(count, history.Count);
        Assert.All(history, revision => Assert.Equal(id, revision.Id));
        Assert.Equal(role == Roles.Owner ? new[] { 1, 2, 3 } : new[] { 3 }, history.Select(r => r.Version));
        await store.DidNotReceiveWithAnyArgs().ListAsync(default, default!, default);
    }

    [Fact]
    public async Task UnassignedStaffCannotReadHistoryEvenForPublishedPolicy()
    {
        var (service, store, user, assignments) = Create(Roles.Staff);
        var id = Guid.NewGuid(); var location = Guid.NewGuid();
        assignments.IsAssignedAsync(user.UserId!.Value, location, default).Returns(false);
        store.GetAsync(id, "OperatingPolicy", default).Returns(Document(id, location, 2, "Published"));
        Assert.Equal(404, (await Assert.ThrowsAsync<PropertyException>(() => service.RevisionsAsync(id, default))).Status);
        await store.DidNotReceiveWithAnyArgs().HistoryAsync(default, default!, default);
    }

    [Theory]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task DraftHistoryCannotBeDiscoveredByOtherRoles(string role)
    {
        var (service, store, _, _) = Create(role); var id = Guid.NewGuid();
        store.GetAsync(id, "OperatingPolicy", default).Returns(Document(id, Guid.NewGuid(), 1, "Draft"));
        Assert.Equal(404, (await Assert.ThrowsAsync<PropertyException>(() => service.RevisionsAsync(id, default))).Status);
        await store.DidNotReceiveWithAnyArgs().HistoryAsync(default, default!, default);
    }

    [Fact]
    public async Task MissingPolicyReturnsNotFoundBeforeReadingHistory()
    {
        var (service, store, _, _) = Create(Roles.Owner);
        Assert.Equal(404, (await Assert.ThrowsAsync<PropertyException>(() => service.RevisionsAsync(Guid.NewGuid(), default))).Status);
        await store.DidNotReceiveWithAnyArgs().HistoryAsync(default, default!, default);
    }

    private static SetupDocument Document(Guid id, Guid location, int version, string status) =>
        new(id, location, "OperatingPolicy", status, version, JsonSerializer.SerializeToElement(new { title = "Synthetic rules" }), DateTimeOffset.UtcNow);

    private static (OperatingPolicyService Service, ISetupWorkspaceStore Store, ICurrentUser User, IStaffLocationAccess Assignments) Create(string role)
    {
        var store = Substitute.For<ISetupWorkspaceStore>(); var user = Substitute.For<ICurrentUser>();
        var assignments = Substitute.For<IStaffLocationAccess>();
        user.UserId.Returns(Guid.NewGuid()); user.IsInRole(role).Returns(true);
        assignments.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        return (new(store, user, new(user, assignments), TimeProvider.System), store, user, assignments);
    }
}
