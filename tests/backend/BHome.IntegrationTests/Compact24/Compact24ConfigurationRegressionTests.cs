using System.Net;
using System.Net.Http.Json;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task SharedPreviewWritesNeitherBusinessRecordsNorAuditAndParallelApplyCreditsOnce()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var doc = await Published(owner, "policy-templates"); var route = $"/api/v1/shared-configuration/policy-templates/{doc.Id}";
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var auditBefore = await db.SecurityAudit.CountAsync();
        var recordsBefore = await db.Database.SqlQueryRaw<long>("SELECT count(*) AS \"Value\" FROM operational_tasks").SingleAsync();
        var input = new SharedApply(w.Location, doc.Version); var plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/apply-preview", input));
        Assert.Equal(auditBefore, await db.SecurityAudit.CountAsync());
        Assert.Equal(recordsBefore, await db.Database.SqlQueryRaw<long>("SELECT count(*) AS \"Value\" FROM operational_tasks").SingleAsync());
        input = input with { TargetState = plan.TargetState }; var key = Guid.NewGuid();
        var responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Keyed(owner, route + "/apply", input, key)));
        var results = new List<SharedOperation>(); foreach (var response in responses) results.Add(await Read<SharedOperation>(response));
        Assert.Single(results.Select(r => r.Id).Distinct());
        Assert.Single(await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().ListAsync(w.Location, "OperatingPolicy", default));
        Assert.Equal(1, (await owner.GetFromJsonAsync<SharedUsage>(route + "/applications"))!.Total);
    }
    [CompactPostgresFact]
    public async Task SharedConcurrentNameCreationAndDraftEditsHaveOneWinner()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var input = SharedInput("room-type-templates"); const string route = "/api/v1/shared-configuration/room-type-templates";
        var creates = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => owner.PostAsJsonAsync(route, input)));
        Assert.Single(creates, r => r.IsSuccessStatusCode); Assert.Single(creates, r => r.StatusCode == HttpStatusCode.Conflict);
        var draft = await Read<SharedDocument>(creates.Single(r => r.IsSuccessStatusCode));
        var edits = await Task.WhenAll(Enumerable.Range(0, 2).Select(i => owner.PutAsJsonAsync(route + "/" + draft.Id, input with { ExpectedVersion = draft.Version, Description = "Concurrent " + i })));
        Assert.Single(edits, r => r.IsSuccessStatusCode); Assert.Single(edits, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(new[] { 1, 2 }, (await owner.GetFromJsonAsync<SharedDocument[]>(route + "/" + draft.Id + "/history"))!.Select(d => d.Version));
    }
    [CompactPostgresFact]
    public async Task ParallelConfigurationCopyReplaysOneResult()
    {
        var source = await Seed(); var target = await Seed(); using var owner = await Client(source.Owner); var input = await CopySource(owner, source.Location, target.Location);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var auditBefore = await db.SecurityAudit.CountAsync(); var recordsBefore = await db.Database.SqlQueryRaw<long>("SELECT count(*) AS \"Value\" FROM operational_tasks").SingleAsync();
        var plan = await Read<ConfigurationCopyPlan>(await owner.PostAsJsonAsync("/api/v1/location-configuration/copy-preview", input));
        Assert.Equal(auditBefore, await db.SecurityAudit.CountAsync()); Assert.Equal(recordsBefore, await db.Database.SqlQueryRaw<long>("SELECT count(*) AS \"Value\" FROM operational_tasks").SingleAsync());
        input = input with { SourceState = plan.SourceState, TargetState = plan.TargetState }; var key = Guid.NewGuid();
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Keyed(owner, "/api/v1/location-configuration/copy", input, key)));
        var results = new List<SharedOperation>(); foreach (var response in responses) results.Add(await Read<SharedOperation>(response));
        Assert.Single(results.Select(r => r.Id).Distinct()); Assert.Single(await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().ListAsync(target.Location, "AssetTemplate", default));
    }
    [CompactPostgresFact]
    public async Task SharedApplyRollsBackTargetWhenApplicationProvenanceCannotPersist()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var doc = await Published(owner, "fee-templates"); var route = $"/api/v1/shared-configuration/fee-templates/{doc.Id}";
        var input = new SharedApply(w.Location, doc.Version); var plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/apply-preview", input));
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); var name = "test_apply_failure_" + Guid.NewGuid().ToString("N");
        var create = $"CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.location_id = ''{w.Location}''::uuid AND NEW.task_data->>''recordType''=''SharedConfigurationOperation'' THEN RAISE EXCEPTION ''Synthetic late application failure''; END IF; RETURN NEW; END'; CREATE TRIGGER {name} BEFORE INSERT ON operational_tasks FOR EACH ROW EXECUTE FUNCTION {name}();";
        await db.Database.ExecuteSqlRawAsync(create);
        try
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await Keyed(owner, route + "/apply", input with { TargetState = plan.TargetState }, Guid.NewGuid())).StatusCode);
            Assert.False(await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AnyAsync(p => p.LocationId == w.Location));
            Assert.Equal(0, (await owner.GetFromJsonAsync<SharedUsage>(route + "/applications"))!.Total);
        }
        finally { var drop = $"DROP TRIGGER {name} ON operational_tasks; DROP FUNCTION {name}();"; await db.Database.ExecuteSqlRawAsync(drop); }
    }
    [CompactPostgresFact]
    public async Task SharedApplyRejectsArchivedSourceAfterPreviewAndReportsOverlappingFees()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); var doc = await Published(owner, "fee-templates"); var route = $"/api/v1/shared-configuration/fee-templates/{doc.Id}";
        var input = new SharedApply(w.Location, doc.Version); var plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(route + "/apply-preview", input));
        await owner.PostAsJsonAsync(route + "/archive", new SharedVersion(doc.Version));
        Assert.Equal(HttpStatusCode.Conflict, (await Keyed(owner, route + "/apply", input with { TargetState = plan.TargetState }, Guid.NewGuid())).StatusCode);
        var first = await Published(owner, "fee-templates"); var firstRoute = $"/api/v1/shared-configuration/fee-templates/{first.Id}"; input = new(w.Location, first.Version);
        plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync(firstRoute + "/apply-preview", input));
        await Read<SharedOperation>(await Keyed(owner, firstRoute + "/apply", input with { TargetState = plan.TargetState }, Guid.NewGuid()));
        var second = await Published(owner, "fee-templates"); plan = await Read<ConfigurationPlan>(await owner.PostAsJsonAsync($"/api/v1/shared-configuration/fee-templates/{second.Id}/apply-preview", new SharedApply(w.Location, second.Version)));
        Assert.False(plan.CanProceed); Assert.NotEmpty(plan.Conflicts);
    }
}
