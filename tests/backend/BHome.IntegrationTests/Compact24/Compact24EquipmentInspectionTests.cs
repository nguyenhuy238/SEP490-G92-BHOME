using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using OpenCvSharp;
using BHome.Application.PropertyManagement;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task EquipmentInspectionBatchesAreScopedIdempotentAndCreateProactiveRemediation()
    {
        var w = await Seed(); var outside = await Seed();
        using var host = Host();
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var stranger = await Client(outside.Staff, host);
        var asset = await Read<AssetDto>(await owner.PostAsJsonAsync("/api/v1/assets", new AssetWrite(w.Location, null, "Lobby", "SYN-INSPECT", "Synthetic equipment", "FireSafetyEquipment", "Unassessed", InitialTrackingMode: "BulkQuantity", InitialQuantity: 4)));
        var units = Enumerable.Range(0, 4).Select(_ => Guid.NewGuid()).ToArray();
        foreach (var unit in units) await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{unit}", new EquipmentUnitWrite("Synthetic unit", null, null, null, null, Today, "Lobby", "InService", null, null, null)));
        var policy = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/asset-lifecycle-policies/{Guid.NewGuid()}", LifecyclePolicy() with { EvidenceRequired = false }));
        policy = await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/asset-lifecycle-policies/{policy.Id}/publish", new TemplatePublish(policy.Version)));
        var schedule = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/inspection-schedules/{Guid.NewGuid()}", new InspectionScheduleWrite(asset.Id, policy.Id, policy.Version, Today, 30, 2, true)));
        var generation = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => owner.PostAsync($"/api/v1/equipment-inspection-schedules/{schedule.Id}/generate", null)));
        Assert.All(generation, response => Assert.True(response.IsSuccessStatusCode));
        var list = (await owner.GetFromJsonAsync<SetupPage>($"/api/v1/assets/{asset.Id}/inspections"))!;
        var inspection = Assert.Single(list.Items); var data = inspection.Data.Deserialize<EquipmentInspection>(new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        var route = $"/api/v1/equipment-inspections/{inspection.Id}";
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PutAsJsonAsync(route + "/answers", new InspectionBatch(inspection.Version, [], false))).StatusCode);
        var answers = units.Select((unit, i) => new InspectionAnswer(unit, "position", i == 0 ? "Failed" : "Passed", "Synthetic inspection", [])).ToArray();
        var partial = await Read<SetupDocument>(await staff.PutAsJsonAsync(route + "/answers", new InspectionBatch(inspection.Version, answers[..3], false)));
        Assert.Equal("Incomplete", partial.Data.GetProperty("outcome").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await staff.PutAsJsonAsync(route + "/answers", new InspectionBatch(partial.Version, answers[..3], true))).StatusCode);
        var submitted = await Read<SetupDocument>(await staff.PutAsJsonAsync(route + "/answers", new InspectionBatch(partial.Version, answers, true)));
        Assert.Equal("Failed", submitted.Data.GetProperty("outcome").GetString());
        var rework = await Read<SetupDocument>(await owner.PostAsJsonAsync(route + "/review", new InspectionReview(submitted.Version, "Rework", "Synthetic second look")));
        Assert.Equal("Draft", rework.Status);
        submitted = await Read<SetupDocument>(await staff.PutAsJsonAsync(route + "/answers", new InspectionBatch(rework.Version, answers, true)));
        var verified = await Read<SetupDocument>(await owner.PostAsJsonAsync(route + "/review", new InspectionReview(submitted.Version, "Verify", "Synthetic verification")));
        Assert.Equal("Verified", verified.Status);
        var summary = (await owner.GetFromJsonAsync<AssetLifecycleSummary>($"/api/v1/assets/{asset.Id}/lifecycle-summary"))!;
        Assert.Equal(4, summary.Quantity); Assert.Equal(4, summary.ActiveUnits); Assert.Equal(1, summary.FailedUnits);
        var unsafeUnit = (await owner.GetFromJsonAsync<SetupPage>($"/api/v1/assets/{asset.Id}/equipment-units"))!.Items.Single(item => item.Id == units[0]);
        var unsafeDetails = unsafeUnit.Data.Deserialize<EquipmentUnit>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!.Details;
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/equipment-units/{unsafeUnit.Id}", unsafeDetails with { Status = "InService", ExpectedVersion = unsafeUnit.Version })).StatusCode);
        var remediation = new InspectionRemediation(verified.Version, "Synthetic failed equipment", "Restore safe operation and reinspect", DateTimeOffset.UtcNow.AddDays(2));
        var linked = await Read<SetupDocument>(await owner.PostAsJsonAsync(route + "/remediation", remediation));
        var replay = await Read<SetupDocument>(await owner.PostAsJsonAsync(route + "/remediation", remediation));
        Assert.Equal(linked.Version, replay.Version); Assert.NotEqual(Guid.Empty, linked.Data.GetProperty("remediationWorkOrderId").GetGuid());
        var workId = linked.Data.GetProperty("remediationWorkOrderId").GetGuid();
        var workRoute = $"/api/v1/work-orders/{workId}";
        var work = (await staff.GetFromJsonAsync<WorkOrderView>(workRoute))!;
        await Read<IncidentCommandResult>(await Keyed(staff, workRoute + "/proposal", new RepairProposal(work.Version, "Synthetic inspection", "Synthetic repair", 30, 100000, []), Guid.NewGuid()));
        work = (await owner.GetFromJsonAsync<WorkOrderView>(workRoute))!;
        await Read<IncidentCommandResult>(await Keyed(owner, workRoute + "/plan-decision", new PlanDecision(work.Version, true), Guid.NewGuid()));
        work = (await staff.GetFromJsonAsync<WorkOrderView>(workRoute))!;
        await Read<IncidentCommandResult>(await Keyed(staff, workRoute + "/start", new WorkOrderAction(work.Version), Guid.NewGuid()));
        using var image = new Mat(12, 12, MatType.CV_8UC3, Scalar.White);
        Cv2.ImEncode(".png", image, out var bytes);
        using var upload = new HttpRequestMessage(HttpMethod.Put, workRoute + "/evidence?kind=Completion") { Content = new ByteArrayContent(bytes) };
        upload.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); upload.Content.Headers.ContentType = new("image/png");
        var evidence = await Read<IncidentCommandResult>(await staff.SendAsync(upload));
        work = (await staff.GetFromJsonAsync<WorkOrderView>(workRoute))!;
        await Read<IncidentCommandResult>(await Keyed(staff, workRoute + "/submit", new WorkOrderAction(work.Version, "Synthetic completion", [evidence.ResourceId!.Value]), Guid.NewGuid()));
        work = (await owner.GetFromJsonAsync<WorkOrderView>(workRoute))!;
        var verification = new MaintenanceVerification(work.Version, 100000, "Synthetic verification", null, "Repaired");
        var verificationKey = Guid.NewGuid();
        await Read<IncidentCommandResult>(await Keyed(owner, workRoute + "/verify", verification, verificationKey));
        await Read<IncidentCommandResult>(await Keyed(owner, workRoute + "/verify", verification, verificationKey));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(1, await db.Set<MaintenanceExpense>().CountAsync(expense => expense.WorkOrderId == workId));
        }
        var reinspectionSchedule = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/inspection-schedules/{Guid.NewGuid()}", new InspectionScheduleWrite(asset.Id, policy.Id, policy.Version, Today, null, 2, true)));
        Assert.True((await owner.PostAsync($"/api/v1/equipment-inspection-schedules/{reinspectionSchedule.Id}/generate", null)).IsSuccessStatusCode);
        var reinspection = (await owner.GetFromJsonAsync<SetupPage>($"/api/v1/assets/{asset.Id}/inspections"))!.Items.Single(item => item.Data.GetProperty("scheduleId").GetGuid() == reinspectionSchedule.Id);
        var reinspectionRoute = $"/api/v1/equipment-inspections/{reinspection.Id}";
        var passedResponse = await staff.PutAsJsonAsync(reinspectionRoute + "/answers", new InspectionBatch(reinspection.Version, answers.Select(answer => answer with { Result = "Passed" }).ToArray(), true));
        Assert.True(passedResponse.IsSuccessStatusCode, string.Join("\n", ApiFactory.Diagnostics.TakeLast(10)));
        var passed = await Read<SetupDocument>(passedResponse);
        await Read<SetupDocument>(await owner.PostAsJsonAsync(reinspectionRoute + "/review", new InspectionReview(passed.Version, "Verify", "Synthetic passed reinspection")));
        summary = (await owner.GetFromJsonAsync<AssetLifecycleSummary>($"/api/v1/assets/{asset.Id}/lifecycle-summary"))!;
        Assert.Equal(4, summary.Quantity); Assert.Equal(0, summary.FailedUnits);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route + "/review", new InspectionReview(submitted.Version, "Verify", "Stale"))).StatusCode);
        var cancelledSchedule = await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/inspection-schedules/{Guid.NewGuid()}", new InspectionScheduleWrite(asset.Id, policy.Id, policy.Version, Today, null, 2, true)));
        Assert.True((await owner.PostAsync($"/api/v1/equipment-inspection-schedules/{cancelledSchedule.Id}/generate", null)).IsSuccessStatusCode);
        var pending = (await owner.GetFromJsonAsync<SetupPage>($"/api/v1/assets/{asset.Id}/inspections"))!.Items.Single(item => item.Data.GetProperty("scheduleId").GetGuid() == cancelledSchedule.Id);
        var cancelRoute = $"/api/v1/equipment-inspections/{pending.Id}/review";
        var cancel = new InspectionReview(pending.Version, "Cancel", "Synthetic obsolete inspection");
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(cancelRoute, cancel)).StatusCode);
        Assert.Equal("Cancelled", (await Read<SetupDocument>(await owner.PostAsJsonAsync(cancelRoute, cancel))).Status);
        Assert.Equal("Cancelled", (await owner.GetFromJsonAsync<BHome.Application.StaffOperations.TaskView>($"/api/v1/operational-tasks/{pending.Data.GetProperty("taskId").GetGuid()}"))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(cancelRoute, cancel)).StatusCode);
    }
}
