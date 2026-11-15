using System.Net;
using System.Net.Http.Json;
using BHome.IntegrationTests.Compact24;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.IncidentMaintenance;

public sealed partial class IncidentApiTests
{
    [CompactPostgresFact]
    public async Task FastRepairCompletesOnlyAfterOwnerVerificationAndCreatesNoZeroExpense()
    {
        var w = await Setup(); var policy = (await w.Owner.Client.GetFromJsonAsync<FastRepairPolicyView>($"{Orders}/fast-repair-policy"))!;
        const string category = "Synthetic no-material adjustment";
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/fast-repair-policy", new FastRepairPolicyWrite(policy.Version, [category])));
        var id = (await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w)))).WorkOrderId!.Value;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/fast-repair-start", new FastRepairStart(1, category, "Inspected", "Adjust without material", 5, 0, false)));
        using var upload = new HttpRequestMessage(HttpMethod.Put, $"{Orders}/{id}/evidence?kind=Completion") { Content = new ByteArrayContent(Image()) };
        upload.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var evidence = (await Ok<IncidentCommandResult>(await w.Staff.Client.SendAsync(upload))).ResourceId!.Value;
        var work = (await Work(w.Staff, id))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/submit", new WorkOrderAction(work.Version, "Synthetic zero-cost completion", [evidence])));
        Assert.Equal("PendingVerification", (await Work(w.Staff, id))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Verify(w, id, cost: 1)).StatusCode);
        await Ok<IncidentCommandResult>(await Verify(w, id, cost: 0));
        work = (await Work(w.Owner, id))!; Assert.Equal("Verified", work.Status); Assert.Null(work.ApprovedById);
        Assert.NotNull(work.FastRepairPolicyVersion);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.False(await db.Set<MaintenanceExpense>().AnyAsync(e => e.WorkOrderId == id));
        Assert.Equal(0, (await db.Set<MaintenanceHistory>().SingleAsync(h => h.WorkOrderId == id)).ActualCost);
    }

    [CompactPostgresFact]
    public async Task OwnerCreatesAssetOnlyAfterStaffProposalAndPreservesItsScope()
    {
        var w = await Setup(); var id = (await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w) with { AssetId = null }))).WorkOrderId!.Value;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/asset-proposal",
            new AssetLinkProposal(1, null, "Synthetic new fan", "Synthetic device", "Inspected synthetic condition", "Found an unmanaged device")));
        var work = (await Work(w.Owner, id))!; Assert.Null(work.AssetId);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{id}/asset-decision", new AssetLinkDecision(work.Version, true, "Owner confirmed device")));
        work = (await Work(w.Owner, id))!; Assert.NotNull(work.AssetId);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var asset = await db.Set<BHome.Domain.PropertyManagement.Asset>().SingleAsync(a => a.Id == work.AssetId);
        Assert.Equal(w.Room, asset.RoomId); Assert.Equal(w.Location, asset.LocationId); Assert.Equal("Synthetic new fan", asset.Name);
    }
    [CompactPostgresFact]
    public async Task TenantWithoutAssetCompletesIncidentAndRepeatReportPreservesVerifiedWork()
    {
        var w = await Setup();
        var incident = (await Ok<IncidentCommandResult>(await Submit(w.Tenant, w, omitAsset: true))).IncidentId!.Value;
        Assert.Null((await Report(w.Owner, incident))!.AssetId);
        await Review(w, incident); var work = await Assign(w, incident);
        await ProposeAndStart(w, work); await Complete(w, incident, work);
        await Ok<IncidentCommandResult>(await Verify(w, work));
        Assert.Equal("Resolved", (await Report(w.Tenant, incident))!.Status);
        var repeated = (await Ok<IncidentCommandResult>(await Submit(w.Tenant, w, omitAsset: true))).IncidentId!.Value;
        Assert.NotEqual(incident, repeated); Assert.Equal("Submitted", (await Report(w.Tenant, repeated))!.Status);
        Assert.Equal("Verified", (await Work(w.Owner, work))!.Status);
        var inbox = await w.Staff.Client.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<BHome.Application.Notifications.NotificationView>>("/api/v1/notifications?category=Incident");
        Assert.Contains(inbox!.Items, n => n.RelatedObjectId == incident);
    }

    [CompactPostgresFact]
    public async Task OwnerAssetHistoryIncludesIncidentLinkedLaterThroughWorkOrderWithoutChangingOriginalReport()
    {
        var w = await Setup();
        var incident = (await Ok<IncidentCommandResult>(await Submit(w.Tenant, w, omitAsset: true))).IncidentId!.Value;
        await Review(w, incident);
        var id = await Assign(w, incident);
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/asset-proposal", new AssetLinkProposal(1, w.Asset, null, null, null, "Identified during inspection")));
        var work = (await Work(w.Owner, id))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{id}/asset-decision", new AssetLinkDecision(work.Version, true, "Confirmed managed asset")));
        var reports = await w.Owner.Client.GetFromJsonAsync<IncidentPage<IncidentView>>($"{Base}?locationId={w.Location}&assetId={w.Asset}&pageSize=1");
        Assert.Equal(1, reports!.TotalCount);
        Assert.Equal(incident, Assert.Single(reports.Items).Id);
        Assert.Null((await Report(w.Tenant, incident))!.AssetId);
        var orders = await w.Owner.Client.GetFromJsonAsync<IncidentPage<WorkOrderView>>($"{Orders}?locationId={w.Location}&assetId={w.Asset}");
        Assert.Equal(id, Assert.Single(orders!.Items).Id);
        var other = await Setup();
        var unrelated = await w.Owner.Client.GetFromJsonAsync<IncidentPage<IncidentView>>($"{Base}?locationId={other.Location}&assetId={w.Asset}");
        Assert.Empty(unrelated!.Items);
    }

    [CompactPostgresFact]
    public async Task CoOccupantCanReportOnlyWithinTheContractBoundRoom()
    {
        var w = await Setup(); var coTenant = await User(BHome.Domain.IdentityAccess.Roles.Tenant);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var room = await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == w.Room); room.Capacity = 3;
            var resident = new BHome.Domain.TenantContracts.Resident
            {
                RoomId = w.Room,
                OwnerUserId = w.Owner.Id,
                TenantUserId = coTenant.Id,
                DisplayLabel = "Synthetic co-occupant"
            };
            db.Add(resident);
            db.Add(new BHome.Domain.TenantContracts.ContractResident
            {
                ContractId = w.Contract,
                ResidentId = resident.Id,
                ResidenceFrom = Today.AddDays(-1),
                Role = BHome.Domain.TenantContracts.ResidentType.CoOccupant
            });
            await db.SaveChangesAsync();
        }
        var result = await Ok<IncidentCommandResult>(await Submit(coTenant, w, omitAsset: true));
        Assert.NotNull(await Report(coTenant, result.IncidentId!.Value));
        var other = await Setup();
        Assert.Equal(HttpStatusCode.NotFound, (await Submit(coTenant, other, omitAsset: true)).StatusCode);
    }
    [CompactPostgresFact]
    public async Task FastRepairPolicyStartsDisabledRequiresOwnerAndSupportsSafeFallback()
    {
        var w = await Setup();
        var policy = (await w.Owner.Client.GetFromJsonAsync<FastRepairPolicyView>($"{Orders}/fast-repair-policy"))!;
        var created = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w)));
        var id = created.WorkOrderId!.Value;
        var start = new FastRepairStart(1, "Synthetic zero-cost adjustment", "Inspected", "Adjust without materials", 10, 0, false);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{id}/fast-repair-start", start)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Staff, $"{Orders}/fast-repair-policy", new FastRepairPolicyWrite(policy.Version, [start.Category]))).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/fast-repair-policy", new FastRepairPolicyWrite(policy.Version, [start.Category])));
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{id}/fast-repair-start", start with { UsesMaterials = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{id}/fast-repair-start", start with { EstimatedCost = 1 })).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/fast-repair-start", start));
        var work = (await Work(w.Staff, id))!;
        Assert.Equal("InProgress", work.Status); Assert.Null(work.ApprovedById); Assert.False(work.PlanApproved);
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/fast-repair-fallback", new WorkOrderAction(work.Version, "Needs paid materials")));
        work = (await Work(w.Staff, id))!;
        Assert.Equal("Assigned", work.Status); Assert.Null(work.FastRepairPolicyVersion);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{id}/start", new WorkOrderAction(work.Version))).StatusCode);
        await ProposeAndStart(w, id);
    }

    [CompactPostgresFact]
    public async Task StaffProposesAssetAndOwnerConfirmsWithinWorkScope()
    {
        var w = await Setup(); var created = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w) with { AssetId = null }));
        var id = created.WorkOrderId!.Value;
        var proposal = new AssetLinkProposal(1, w.Asset, null, null, null, "Identified during inspection");
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/asset-proposal", proposal));
        var work = (await Work(w.Owner, id))!;
        Assert.Null(work.AssetId); Assert.True(work.AssetProposalPending);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Staff, $"{Orders}/{id}/asset-decision", new AssetLinkDecision(work.Version, true, "Confirm"))).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{id}/asset-decision", new AssetLinkDecision(work.Version, true, "Confirmed matching managed asset")));
        work = (await Work(w.Owner, id))!; Assert.Equal(w.Asset, work.AssetId); Assert.False(work.AssetProposalPending);
        var other = await Setup();
        var another = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w) with { AssetId = null }));
        Assert.Equal(HttpStatusCode.NotFound, (await Send(w.Staff, $"{Orders}/{another.WorkOrderId}/asset-proposal", proposal with { AssetId = other.Asset })).StatusCode);
    }

    private static ProactiveMaintenance Proactive(Workspace w) => new(w.Location, w.Room, null, w.Asset,
        "Synthetic proactive inspection", "Synthetic maintenance outcome", DateTimeOffset.UtcNow.AddDays(3));

    [CompactPostgresFact]
    public async Task ProactiveLifecyclePersistsWithoutIncidentAndReplaysExactlyOnce()
    {
        var w = await Setup(); var key = Guid.NewGuid(); var input = Proactive(w);
        var created = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, input, key));
        Assert.Null(created.IncidentId); var id = created.WorkOrderId!.Value;
        Assert.Equal(created, await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, input, key)));
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, Orders, input with { Description = "Changed synthetic description" }, key)).StatusCode);
        var before = (await Work(w.Staff, id))!;
        Assert.Equal("Proactive", before.Source); Assert.Null(before.IncidentId);
        await ProposeAndStart(w, id);
        using var upload = new HttpRequestMessage(HttpMethod.Put, $"{Orders}/{id}/evidence?kind=Completion") { Content = new ByteArrayContent(Image()) };
        upload.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var evidence = await Ok<IncidentCommandResult>(await w.Staff.Client.SendAsync(upload));
        before = (await Work(w.Staff, id))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/submit", new WorkOrderAction(before.Version, "Synthetic finished", [evidence.ResourceId!.Value])));
        await Ok<IncidentCommandResult>(await Verify(w, id));
        Assert.Equal("Verified", (await Work(w.Owner, id))!.Status);
        var timeline = await w.Owner.Client.GetFromJsonAsync<IncidentPage<IncidentActivityView>>($"{Orders}/{id}/history");
        Assert.Contains(timeline!.Items, a => a.Action == "verified");
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.False(await db.Set<IncidentReport>().AnyAsync(r => r.LocationId == w.Location));
        Assert.Single(await db.Set<MaintenanceExpense>().Where(e => e.WorkOrderId == id).ToArrayAsync());
        Assert.Single(await db.Set<MaintenanceHistory>().Where(h => h.WorkOrderId == id).ToArrayAsync());
    }

    [CompactPostgresFact]
    public async Task ProactiveRejectsMissingAssignmentCrossLocationAndTenantAccess()
    {
        var w = await Setup(false);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, Orders, Proactive(w))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Staff, Orders, Proactive(w))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Tenant, Orders, Proactive(w))).StatusCode);
        var other = await Setup();
        Assert.Equal(HttpStatusCode.NotFound, (await Send(w.Owner, Orders, Proactive(other) with { RoomId = w.Room })).StatusCode);
        var created = await Ok<IncidentCommandResult>(await Send(other.Owner, Orders, Proactive(other)));
        Assert.Equal(HttpStatusCode.NotFound, (await w.Staff.Client.GetAsync($"{Orders}/{created.WorkOrderId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.Tenant.Client.GetAsync($"{Orders}/{created.WorkOrderId}")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task ProactiveCommonAreaAndVacantRoomAreSupportedAndServerChoosesAssignee()
    {
        var w = await Setup();
        var assignment = await w.Owner.Client.GetFromJsonAsync<MaintenanceAssignment>($"{Orders}/assignment?locationId={w.Location}");
        Assert.Equal(w.Staff.Id, assignment!.StaffId);
        var common = Proactive(w) with { RoomId = null, AssetId = null, CommonArea = "Synthetic corridor" };
        var created = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, common));
        Assert.Equal("Synthetic corridor", (await Work(w.Owner, created.WorkOrderId!.Value))!.CommonArea);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var room = new BHome.Domain.PropertyManagement.Room { LocationId = w.Location, RoomNumber = "SYNTHETIC-VACANT" };
        db.Add(room); await db.SaveChangesAsync();
        created = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w) with { RoomId = room.Id, AssetId = null }));
        Assert.Equal(w.Staff.Id, (await Work(w.Owner, created.WorkOrderId!.Value))!.AssignedStaffId);
    }
}
