using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF07Incident;

/// <summary>
/// Sheet "BF-07 Incident" (ITC-BF07-001..017). Steps and expected results come only from the plan; routes and payloads come
/// from docs/api/INCIDENT_MAINTENANCE.md, LOCATION_ROOM_API.md, the Staff assignment docs and the Postman collection "BHome.Simple".
/// The plan's "Work Order" is the documented /api/v1/work-orders resource.
///
/// Accounts (plan-tests.settings.json or BHOME_IT_ACCOUNT_{NAME}_EMAIL / _PASSWORD):
///   owner, staff, tenant — tenant must have an Active Contract in a Room that has at least one Asset;
///   tenant2 — a second Tenant with an Active Contract (ITC-BF07-003);
///   staff2  — a second active Staff account used as the replacement Staff (ITC-BF07-012);
///   formertenant — a Tenant whose tenancy has ended (ITC-BF07-003 step 2), together with
///   BHOME_IT_BF07_FORMER_TENANT_INCIDENT_ID = id of a report that this former Tenant submitted while the tenancy was active.
/// Tenant reports (001, 002, 003, 005, 006) use the Tenant's Room found through GET /incidents/reporting-rooms; Staff 'staff' must be
/// (or can be made) the Staff assigned today to that Location. Other cases build their own Location/Room/Asset as Owner.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-07 Incident")]
public sealed class IncidentTests(PlanSessions sessions)
{
    private readonly IncidentFlow _flow = new(sessions);
    private readonly PlanApi _api = sessions.Api;

    // ===== Submit Incident or Maintenance Report (UC-26) =====

    [SkippableFact(DisplayName = "ITC-BF07-001 Test submitting a Normal incident with photos.")]
    [Trait("TestCase", "ITC-BF07-001")]
    public async Task ITC_BF07_001()
    {
        var place = await _flow.TenantPlaceAsync("tenant", needAsset: true);
        var tenantId = await _flow.UserIdAsync("tenant");

        // 1. Sign in as Tenant.
        var tenant = await _flow.TokenAsync("tenant");
        // 2. Open the report function and choose the Room and the asset.
        // 3. Choose severity Normal and enter a description.
        // 4. Add photos and submit.
        const string description = "Vòi nước bồn rửa bị rò rỉ liên tục - kiểm thử BF07-001";
        var response = await _flow.SubmitAsync(
            tenant, IncidentFlow.Fields(place.LocationId, place.RoomId, place.AssetId, "Normal", description), PlanData.TinyPng, PlanData.TinyPng);

        // The report is Submitted with the reporter, the scope, the severity, the description and the photos.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created, "submit");
        var incidentId = IncidentFlow.Id(await response.JsonAsync(), "incidentId");
        var report = await _flow.IncidentAsync(incidentId, "tenant");
        IncidentFlow.AssertState(report, "Submitted", "report");
        Assert.Equal(place.LocationId, report.Str("locationId"), ignoreCase: true);
        Assert.Equal(place.RoomId, report.Str("roomId"), ignoreCase: true);
        Assert.Equal(place.AssetId, report.Str("assetId"), ignoreCase: true);
        Assert.True(IncidentFlow.SameState(report.Str("severity"), "Normal"), $"severity is \"{report.Str("severity")}\".");
        Assert.Equal(description, report.Str("description"));
        var photos = await IncidentFlow.OkJsonAsync(await _api.GetAsync($"api/v1/incidents/{incidentId}/evidence", tenant), "read the photos");
        Assert.Equal(2, photos.Items().Count);
        var history = await _flow.HistoryAsync(incidentId);
        Assert.True(
            history.Any(a => string.Equals(a.Str("actorId"), tenantId, StringComparison.OrdinalIgnoreCase)),
            "The report history (Owner view) does not record the Tenant as the reporter.");

        // The Owner is notified.
        Assert.True(await _flow.NotificationCountAsync("owner", incidentId) > 0, "The Owner has no notification linked to the new report.");
    }

    [SkippableFact(DisplayName = "ITC-BF07-002 Test reports with invalid scope, size or classification.")]
    [Trait("TestCase", "ITC-BF07-002")]
    public async Task ITC_BF07_002()
    {
        var place = await _flow.TenantPlaceAsync("tenant", needAsset: false);
        var tenant = await _flow.TokenAsync("tenant");
        var foreign = await _flow.CreateSiteAsync(staffAccount: null);
        var before = await _flow.IncidentTotalAsync("owner");

        // 1. Report for a Room that is not the Tenant's.
        var otherRoom = await _flow.SubmitAsync(tenant, IncidentFlow.Fields(foreign.LocationId, foreign.RoomId, foreign.AssetId, "Normal"));
        // 2. Send a description or a photo over the limit.
        var longText = await _flow.SubmitAsync(tenant, IncidentFlow.Fields(place.LocationId, place.RoomId, place.AssetId, "Normal", new string('a', 8001)));
        var bigPhoto = new byte[5_000_001];
        PlanData.TinyPng.CopyTo(bigPhoto, 0);
        var largePhoto = await _flow.SubmitAsync(tenant, IncidentFlow.Fields(place.LocationId, place.RoomId, place.AssetId, "Normal"), bigPhoto);

        // The requests are refused with a message and no report is created.
        foreach (var (answer, step) in new[] { (otherRoom, "Room of another Tenant"), (longText, "description over 8000 characters"), (largePhoto, "photo over 5,000,000 bytes") })
        {
            var body = await PlanAssert.RefusedAsync(answer, step);
            Assert.False(string.IsNullOrWhiteSpace(body), $"{step}: the refusal has no message.");
        }

        Assert.Equal(before, await _flow.IncidentTotalAsync("owner"));

        // 3. Cancel or mark a report as duplicate in a wrong way.
        var incidentId = await _flow.SubmitOkAsync("tenant", place.LocationId, place.RoomId, place.AssetId, "Normal");
        var version = await _flow.IncidentVersionAsync(incidentId);
        var cancelNoReason = await _flow.CommandAsync($"api/v1/incidents/{incidentId}/cancel", new { version }, "tenant");
        var tenantDuplicate = await _flow.CommandAsync($"api/v1/incidents/{incidentId}/duplicate", new { version, reason = "Trùng", duplicateOfId = incidentId }, "tenant");
        var duplicateOfItself = await _flow.CommandAsync($"api/v1/incidents/{incidentId}/duplicate", new { version, reason = "Trùng với chính nó", duplicateOfId = incidentId }, "owner");

        // The requests are refused with a message.
        foreach (var (answer, step) in new[] { (cancelNoReason, "cancel without reason"), (tenantDuplicate, "Tenant marks duplicate"), (duplicateOfItself, "duplicate of itself") })
        {
            var body = await PlanAssert.RefusedAsync(answer, step);
            Assert.False(string.IsNullOrWhiteSpace(body), $"{step}: the refusal has no message.");
        }

        IncidentFlow.AssertState(await _flow.IncidentAsync(incidentId), "Submitted", "report after the wrong cancel/duplicate");
    }

    [SkippableFact(DisplayName = "ITC-BF07-003 Test that a Tenant only sees their own reports and files.")]
    [Trait("TestCase", "ITC-BF07-003")]
    public async Task ITC_BF07_003()
    {
        var place = await _flow.TenantPlaceAsync("tenant", needAsset: false);
        var place2 = await _flow.TenantPlaceAsync("tenant2", needAsset: false);
        await _flow.SubmitOkAsync("tenant", place.LocationId, place.RoomId, place.AssetId, "Normal", PlanData.TinyPng);
        var otherId = await _flow.SubmitOkAsync("tenant2", place2.LocationId, place2.RoomId, place2.AssetId, "Normal", PlanData.TinyPng);
        var otherPhotos = await IncidentFlow.OkJsonAsync(await _api.GetAsync($"api/v1/incidents/{otherId}/evidence", await _flow.TokenAsync("tenant2")), "precondition: photos of tenant2");
        var photoId = IncidentFlow.Id(otherPhotos.Items().First(), "id");
        var tenant = await _flow.TokenAsync("tenant");

        // 1. Open a report and a photo of another Tenant.
        // The other Tenant's data is refused.
        await PlanAssert.RefusedAsync(await _api.GetAsync($"api/v1/incidents/{otherId}", tenant), "other Tenant's report");
        await PlanAssert.RefusedAsync(await _api.GetAsync($"api/v1/incidents/{otherId}/evidence", tenant), "other Tenant's photo list");
        await PlanAssert.RefusedAsync(await _api.GetAsync($"api/v1/incidents/{otherId}/evidence/{photoId}", tenant), "other Tenant's photo");
        await PlanAssert.RefusedAsync(await _api.GetAsync($"api/v1/incidents/{otherId}/history", tenant), "other Tenant's history");
        var own = await IncidentFlow.OkJsonAsync(await _api.GetAsync("api/v1/incidents?page=1&pageSize=100", tenant), "Tenant's report list");
        Assert.DoesNotContain(own.Items(), i => string.Equals(i.Str("id"), otherId, StringComparison.OrdinalIgnoreCase));

        // 2. Open an old report after the tenancy ended.
        var oldReport = Environment.GetEnvironmentVariable("BHOME_IT_BF07_FORMER_TENANT_INCIDENT_ID");
        Skip.If(
            string.IsNullOrWhiteSpace(oldReport),
            "Step 2 needs a Tenant whose tenancy ended: configure account 'formertenant' and set BHOME_IT_BF07_FORMER_TENANT_INCIDENT_ID to a report this Tenant submitted during the tenancy.");
        var former = await _flow.TokenAsync("formertenant");
        var answer = await _api.GetAsync($"api/v1/incidents/{oldReport}", former);

        // Historical access of the own report is checked on the server: a deliberate answer (the own report, or a refusal), never a server error.
        await PlanAssert.StatusInAsync(answer, "old report after the tenancy ended", HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
        if (answer.StatusCode == HttpStatusCode.OK)
        {
            Assert.Equal(oldReport, (await answer.JsonAsync()).Str("id"), ignoreCase: true);
        }
    }

    [SkippableFact(DisplayName = "ITC-BF07-004 Test a failed photo upload.", Skip = PlanSkip.FailureInjection)]
    [Trait("TestCase", "ITC-BF07-004")]
    public void ITC_BF07_004()
    {
        // 1. Submit a report while the photo upload fails.
        // No report is saved and the unused file is cleaned up.
    }

    // ===== Respond to Emergency Incident (UC-27) =====

    [SkippableFact(DisplayName = "ITC-BF07-005 Test the emergency notification and the cost confirmation.")]
    [Trait("TestCase", "ITC-BF07-005")]
    public async Task ITC_BF07_005()
    {
        var place = await _flow.TenantPlaceAsync("tenant", needAsset: false);
        await _flow.EnsureStaffAssignedAsync(place.LocationId);

        // 1. Submit a report with severity Emergency.
        var incidentId = await _flow.SubmitOkAsync("tenant", place.LocationId, place.RoomId, place.AssetId, "Emergency");

        // 2. Check the notifications of the Owner and the Staff.
        // The notifications are stored.
        Assert.True(await _flow.NotificationCountAsync("owner", incidentId) > 0, "The Owner has no notification for the Emergency report.");
        Assert.True(await _flow.NotificationCountAsync("staff", incidentId) > 0, "The Staff has no notification for the Emergency report.");

        // 3. Staff records an emergency action with a cost (docs: the Staff acknowledges first; a cost > 0 needs a receipt photo).
        await _flow.CommandOkAsync($"api/v1/incidents/{incidentId}/acknowledge", new { version = await _flow.IncidentVersionAsync(incidentId) }, "staff", "Staff acknowledges");
        var receipt = await _flow.UploadAsync("staff", incidentId, "EmergencyAction");
        var action = await _flow.CommandOkAsync(
            $"api/v1/incidents/{incidentId}/emergency-actions",
            new { version = await _flow.IncidentVersionAsync(incidentId), note = "Khóa van tổng, đặt thùng hứng nước", evidenceIds = new[] { receipt }, requestedCost = 50000 },
            "staff",
            "Staff records the emergency action with a cost");
        var entryId = IncidentFlow.Id(action, "resourceId");

        // 4. Owner decides on the cost, twice.
        var decision = $"api/v1/incidents/{incidentId}/emergency-actions/{entryId}/cost-decision";
        var first = await _flow.CommandAsync(decision, new { version = await _flow.IncidentVersionAsync(incidentId), approve = true, reason = "Đã kiểm tra chứng từ" }, "owner");
        await PlanAssert.SuccessAsync(first, "first cost decision");
        var second = await _flow.CommandAsync(decision, new { version = await _flow.IncidentVersionAsync(incidentId), approve = true, reason = "Quyết định lần hai" }, "owner");

        // The cost is confirmed exactly once.
        await PlanAssert.RefusedAsync(second, "second cost decision");
        var expenses = await _flow.ExpensesAsync(incidentId);
        Assert.Single(expenses, e => string.Equals(e.Str("emergencyActionId"), entryId, StringComparison.OrdinalIgnoreCase));
    }

    [SkippableFact(DisplayName = "ITC-BF07-006 Test acknowledging an emergency.")]
    [Trait("TestCase", "ITC-BF07-006")]
    public async Task ITC_BF07_006()
    {
        var place = await _flow.TenantPlaceAsync("tenant", needAsset: false);
        var staffId = await _flow.EnsureStaffAssignedAsync(place.LocationId);
        var incidentId = await _flow.SubmitOkAsync("tenant", place.LocationId, place.RoomId, place.AssetId, "Emergency");
        bool ByStaff(JsonElement a) => string.Equals(a.Str("actorId"), staffId, StringComparison.OrdinalIgnoreCase);
        var staffStepsBefore = (await _flow.HistoryAsync(incidentId)).Count(ByStaff);

        // 1. Sign in as the responsible Staff.
        await _flow.TokenAsync("staff");
        // 2. Acknowledge the Emergency report.
        await _flow.CommandOkAsync($"api/v1/incidents/{incidentId}/acknowledge", new { version = await _flow.IncidentVersionAsync(incidentId) }, "staff", "acknowledge");
        var afterAck = await _flow.IncidentAsync(incidentId);
        var staffStepsAfterAck = (await _flow.HistoryAsync(incidentId)).Where(ByStaff).ToList();
        // 3. Record the containment action.
        await _flow.CommandOkAsync(
            $"api/v1/incidents/{incidentId}/emergency-actions",
            new { version = IncidentFlow.Version(afterAck), note = "Ngắt điện khu vực, cô lập rò rỉ", evidenceIds = Array.Empty<string>(), requestedCost = (decimal?)null },
            "staff",
            "record the containment action");

        // The acknowledgement and the action are stored with the actor and the time.
        Assert.False(string.IsNullOrEmpty(afterAck.Str("acknowledgedAt")), "acknowledgedAt is empty after the acknowledgement.");
        Assert.True(staffStepsAfterAck.Count > staffStepsBefore, "The history has no step by the Staff after the acknowledgement.");
        Assert.All(staffStepsAfterAck, a => Assert.False(string.IsNullOrEmpty(a.Str("occurredAt")), "A Staff step has no time."));
        var actions = await IncidentFlow.OkJsonAsync(await _api.GetAsync($"api/v1/incidents/{incidentId}/emergency-actions", await _flow.TokenAsync("owner")), "read the emergency actions");
        var activityId = IncidentFlow.Id(Assert.Single(actions.Items()), "activityId");
        var actionStep = (await _flow.HistoryAsync(incidentId)).SingleOrDefault(a => string.Equals(a.Str("id"), activityId, StringComparison.OrdinalIgnoreCase));
        Assert.True(actionStep.ValueKind == JsonValueKind.Object, "The containment action is not in the report history.");
        Assert.Equal(staffId, actionStep.Str("actorId"), ignoreCase: true);
        Assert.False(string.IsNullOrEmpty(actionStep.Str("occurredAt")), "The containment action has no time.");
    }

    [SkippableFact(DisplayName = "ITC-BF07-007 Test the re-alert after 15 minutes and the \"overdue\" flag after 30 minutes.", Skip = PlanSkip.ServerClock)]
    [Trait("TestCase", "ITC-BF07-007")]
    public void ITC_BF07_007()
    {
        // 1. Do not acknowledge the report.
        // 2. Advance the time to 15 and then to 30 minutes.
        // The alert is sent again at 15 minutes and the report is flagged "Acknowledgement overdue" at 30 minutes.
        // (docs/api/INCIDENT_MAINTENANCE.md: OQ-04 open, no 15/30-minute reminder and no trigger route.)
    }

    // ===== Review and Assign Incident Handling (UC-28) =====

    [SkippableFact(DisplayName = "ITC-BF07-008 Test reviewing a report and creating a Work Order.")]
    [Trait("TestCase", "ITC-BF07-008")]
    public async Task ITC_BF07_008()
    {
        var site = await _flow.CreateSiteAsync();
        var incidentId = await _flow.StaffReportAsync(site);
        var staffNotesBefore = await _flow.NotificationCountAsync("staff", incidentId);

        // 1. Sign in as Owner and open a Submitted report.
        IncidentFlow.AssertState(await _flow.IncidentAsync(incidentId), "Submitted", "report before review");
        // 2. Confirm the type and the category and set the expected outcome.
        await _flow.ReviewAsync(incidentId);
        // 3. Create a Work Order for a Staff.
        var wo = await _flow.AssignAsync(incidentId, site.StaffId!);

        // The Work Order is Assigned and linked to the report.
        var order = await _flow.WorkOrderAsync(wo);
        IncidentFlow.AssertState(order, "Assigned", "Work Order");
        Assert.Equal(incidentId, order.Str("incidentId"), ignoreCase: true);
        Assert.Equal(site.StaffId, order.Str("assignedStaffId"), ignoreCase: true);
        // The report becomes In Progress and the Staff is notified.
        IncidentFlow.AssertState(await _flow.IncidentAsync(incidentId), "In Progress", "report");
        Assert.True(await _flow.NotificationCountAsync("staff", incidentId) > staffNotesBefore, "The Staff got no new notification for the Work Order.");
    }

    [SkippableFact(DisplayName = "ITC-BF07-009 Test the Owner handling the incident directly.")]
    [Trait("TestCase", "ITC-BF07-009")]
    public async Task ITC_BF07_009()
    {
        var site = await _flow.CreateSiteAsync();
        var incidentId = await _flow.StaffReportAsync(site);
        var path = $"api/v1/incidents/{incidentId}/direct-completion";

        // 1. Choose direct completion (docs: the Owner reviews the report first).
        await _flow.ReviewAsync(incidentId);
        // 2. Complete it without a photo or without the cost.
        var photo = await _flow.UploadAsync("owner", incidentId, "Direct");
        var version = await _flow.IncidentVersionAsync(incidentId);
        var noPhoto = await _flow.CommandAsync(path, new { version, actualCost = 150000, result = "Owner đã thay vòi nước", evidenceIds = Array.Empty<string>(), assetCondition = "Đã khắc phục", assetStatus = 0 }, "owner");
        var noCost = await _flow.CommandAsync(path, new { version, result = "Owner đã thay vòi nước", evidenceIds = new[] { photo }, assetCondition = "Đã khắc phục", assetStatus = 0 }, "owner");

        // The first try is refused.
        await PlanAssert.RefusedAsync(noPhoto, "direct completion without a photo");
        await PlanAssert.RefusedAsync(noCost, "direct completion without the cost");

        // 3. Complete it with a photo and the cost.
        await _flow.CommandOkAsync(
            path,
            new { version = await _flow.IncidentVersionAsync(incidentId), actualCost = 150000, result = "Owner đã thay vòi nước", evidenceIds = new[] { photo }, assetCondition = "Đã khắc phục", assetStatus = 0 },
            "owner",
            "direct completion with photo and cost");

        // With the photo and the explicit cost the report is Resolved and one expense is created, not two.
        IncidentFlow.AssertState(await _flow.IncidentAsync(incidentId), "Resolved", "report");
        Assert.Single(await _flow.ExpensesAsync(incidentId));
    }

    [SkippableFact(DisplayName = "ITC-BF07-010 Test rejecting a report or marking it as a duplicate.")]
    [Trait("TestCase", "ITC-BF07-010")]
    public async Task ITC_BF07_010()
    {
        var site = await _flow.CreateSiteAsync();
        var first = await _flow.StaffReportAsync(site);
        var second = await _flow.StaffReportAsync(site);
        var firstNotes = await _flow.NotificationCountAsync("staff", first);
        var secondNotes = await _flow.NotificationCountAsync("staff", second);

        // 1. Reject a report without a reason, then with a reason.
        var noReason = await _flow.CommandAsync($"api/v1/incidents/{first}/reject", new { version = await _flow.IncidentVersionAsync(first) }, "owner");
        // A reason is needed.
        await PlanAssert.RefusedAsync(noReason, "reject without a reason");
        await _flow.CommandOkAsync($"api/v1/incidents/{first}/reject", new { version = await _flow.IncidentVersionAsync(first), reason = "Không thuộc phạm vi bảo trì" }, "owner", "reject with a reason");

        // 2. Mark another report as Duplicate of the first.
        await _flow.CommandOkAsync(
            $"api/v1/incidents/{second}/duplicate",
            new { version = await _flow.IncidentVersionAsync(second), reason = "Trùng với báo cáo trước", duplicateOfId = first },
            "owner",
            "mark as duplicate of the first");

        // The status becomes Rejected or Duplicate and the reporter is notified.
        IncidentFlow.AssertState(await _flow.IncidentAsync(first), "Rejected", "first report");
        IncidentFlow.AssertState(await _flow.IncidentAsync(second), "Duplicate", "second report");
        Assert.True(await _flow.NotificationCountAsync("staff", first) > firstNotes, "The reporter got no notification for the rejection.");
        Assert.True(await _flow.NotificationCountAsync("staff", second) > secondNotes, "The reporter got no notification for the duplicate.");
    }

    // ===== Inspect, Propose and Execute Repair (UC-29) =====

    [SkippableFact(DisplayName = "ITC-BF07-011 Test the proposal, the plan decision and the execution.")]
    [Trait("TestCase", "ITC-BF07-011")]
    public async Task ITC_BF07_011()
    {
        var site = await _flow.CreateSiteAsync();
        var incidentId = await _flow.StaffReportAsync(site);
        await _flow.ReviewAsync(incidentId);
        var wo = await _flow.AssignAsync(incidentId, site.StaffId!);
        var states = new List<string?> { (await _flow.WorkOrderAsync(wo)).Str("status") };
        bool OfOrder(JsonElement a) => string.Equals(a.Str("workOrderId"), wo, StringComparison.OrdinalIgnoreCase);
        var stepsBefore = (await _flow.HistoryAsync(incidentId)).Count(OfOrder);
        var ownerNotesBefore = await _flow.NotificationCountAsync("owner", incidentId);

        // 1. Staff opens the Work Order and records the inspection.
        await _flow.WorkOrderAsync(wo, "staff");
        var inspection = await _flow.UploadAsync("staff", incidentId, "Inspection", wo);
        // 2. Staff submits the proposal with the time and the cost.
        await _flow.CommandOkAsync(
            $"api/v1/work-orders/{wo}/proposal",
            new { version = await _flow.WorkOrderVersionAsync(wo), inspectionResult = "Gioăng vòi nước bị mục", solution = "Thay gioăng và vòi mới", estimatedMinutes = 90, estimatedCost = 200000, evidenceIds = new[] { inspection } },
            "staff",
            "proposal");
        states.Add((await _flow.WorkOrderAsync(wo)).Str("status"));
        // 3. Owner approves the plan.
        await _flow.CommandOkAsync($"api/v1/work-orders/{wo}/plan-decision", new { version = await _flow.WorkOrderVersionAsync(wo), approve = true }, "owner", "plan decision");
        // 4. Staff starts the work, records the progress and a blocker, and submits the completion.
        await _flow.CommandOkAsync($"api/v1/work-orders/{wo}/start", new { version = await _flow.WorkOrderVersionAsync(wo) }, "staff", "start");
        states.Add((await _flow.WorkOrderAsync(wo)).Str("status"));
        await _flow.CommandOkAsync($"api/v1/work-orders/{wo}/progress", new { version = await _flow.WorkOrderVersionAsync(wo), note = "Đã tháo vòi cũ" }, "staff", "progress");
        await _flow.CommandOkAsync($"api/v1/work-orders/{wo}/blocker", new { version = await _flow.WorkOrderVersionAsync(wo), note = "Chờ vật tư gioăng" }, "staff", "blocker");
        await _flow.SubmitCompletionAsync(incidentId, wo);
        states.Add((await _flow.WorkOrderAsync(wo)).Str("status"));

        // The Work Order goes Assigned -> Pending Approval -> In Progress -> Pending Verification.
        var expected = new[] { "Assigned", "Pending Approval", "In Progress", "Pending Verification" };
        Assert.True(
            expected.Zip(states).All(p => IncidentFlow.SameState(p.Second, p.First)),
            $"Expected {string.Join(" -> ", expected)} but the API answered {string.Join(" -> ", states)}.");
        // The history keeps every step (proposal, plan decision, start, progress, blocker, submit) and the Owner is notified.
        var steps = (await _flow.HistoryAsync(incidentId)).Where(OfOrder).ToList();
        Assert.True(steps.Count >= stepsBefore + 6, $"Expected at least {stepsBefore + 6} history steps for the Work Order but found {steps.Count}.");
        Assert.True(await _flow.NotificationCountAsync("owner", incidentId) > ownerNotesBefore, "The Owner got no notification during the execution.");
    }

    [SkippableFact(DisplayName = "ITC-BF07-012 Test a replacement Staff.")]
    [Trait("TestCase", "ITC-BF07-012")]
    public async Task ITC_BF07_012()
    {
        var newStaffId = await _flow.UserIdAsync("staff2");
        var site = await _flow.CreateSiteAsync();
        var incidentId = await _flow.StaffReportAsync(site);
        await _flow.ReviewAsync(incidentId);
        var wo = await _flow.ToInProgressAsync(incidentId, site.StaffId!);
        var owner = await _flow.TokenAsync("owner");

        // 1. Owner replaces the Staff of the Location.
        var location = await IncidentFlow.OkJsonAsync(await _api.GetAsync($"api/v1/locations/{site.LocationId}", owner), "read the Location version");
        await IncidentFlow.OkJsonAsync(
            await _api.PutAsync(
                $"api/v1/staff-location-assignments/{site.LocationId}",
                new { staffUserId = newStaffId, locationVersion = IncidentFlow.Version(location), effectiveFrom = IncidentFlow.Today, reason = "Thay Staff phụ trách - kiểm thử BF07-012" },
                owner),
            "Owner replaces the Staff of the Location");

        // 2. The old Staff tries to continue the Work Order.
        var oldStaff = await _flow.CommandAsync($"api/v1/work-orders/{wo}/progress", new { version = await _flow.WorkOrderVersionAsync(wo), note = "Staff cũ tiếp tục" }, "staff");
        var newBefore = await _flow.CommandAsync($"api/v1/work-orders/{wo}/progress", new { version = await _flow.WorkOrderVersionAsync(wo), note = "Staff mới trước khi được giao" }, "staff2");

        // The old Staff is refused. The new Staff cannot work before the Owner reassigns the Work Order.
        await PlanAssert.RefusedAsync(oldStaff, "old Staff continues");
        await PlanAssert.RefusedAsync(newBefore, "new Staff before reassignment");

        // 3. Owner reassigns the Work Order.
        await _flow.CommandOkAsync(
            $"api/v1/work-orders/{wo}/reassign",
            new { version = await _flow.WorkOrderVersionAsync(wo), staffId = newStaffId, reason = "Staff cũ đã hết phân công" },
            "owner",
            "Owner reassigns the Work Order");

        // The new Staff can work only after the Owner reassigns the Work Order.
        await _flow.CommandOkAsync($"api/v1/work-orders/{wo}/progress", new { version = await _flow.WorkOrderVersionAsync(wo), note = "Staff mới tiếp tục" }, "staff2", "new Staff after reassignment");
        Assert.Equal(newStaffId, (await _flow.WorkOrderAsync(wo)).Str("assignedStaffId"), ignoreCase: true);
    }

    // ===== Verify Completion and Update Maintenance History (UC-30) =====

    [SkippableFact(DisplayName = "ITC-BF07-013 Test verifying a Work Order and resolving the report.")]
    [Trait("TestCase", "ITC-BF07-013")]
    public async Task ITC_BF07_013()
    {
        // Precondition: Work Order Pending Verification. A second required Work Order of the same report checks "only after all".
        var (site, incidentId, wo) = await _flow.PendingVerificationAsync();
        var wo2 = await _flow.ToInProgressAsync(incidentId, site.StaffId!);
        await _flow.SubmitCompletionAsync(incidentId, wo2);
        var owner = await _flow.TokenAsync("owner");

        // 1. Owner opens the Work Order, checks the evidence and verifies it with the actual cost.
        await _flow.WorkOrderAsync(wo);
        var evidence = await IncidentFlow.OkJsonAsync(await _api.GetAsync($"api/v1/incidents/{incidentId}/evidence", owner), "Owner checks the evidence");
        Assert.Contains(evidence.Items(), e => string.Equals(e.Str("workOrderId"), wo, StringComparison.OrdinalIgnoreCase));
        await Verify(wo, 180000);
        var afterFirst = await _flow.IncidentAsync(incidentId);
        await Verify(wo2, 120000);

        // 2. Check the report, the asset and the expense.
        // The Work Order is Verified.
        IncidentFlow.AssertState(await _flow.WorkOrderAsync(wo), "Verified", "first Work Order");
        IncidentFlow.AssertState(await _flow.WorkOrderAsync(wo2), "Verified", "second Work Order");
        // The linked asset is Active again.
        Assert.True(IncidentFlow.SameState(await _flow.AssetStatusAsync(site.AssetId), "Active"), $"Asset status is \"{await _flow.AssetStatusAsync(site.AssetId)}\".");
        // The cost is linked to the Work Order.
        var expenses = await _flow.ExpensesAsync(incidentId);
        Assert.Single(expenses, e => string.Equals(e.Str("workOrderId"), wo, StringComparison.OrdinalIgnoreCase) && e.Str("amount") == "180000");
        Assert.Single(expenses, e => string.Equals(e.Str("workOrderId"), wo2, StringComparison.OrdinalIgnoreCase) && e.Str("amount") == "120000");
        // The report is Resolved only after all required orders are verified.
        Assert.False(IncidentFlow.SameState(afterFirst.Str("status"), "Resolved"), "The report was Resolved while a second Work Order was still waiting for verification.");
        IncidentFlow.AssertState(await _flow.IncidentAsync(incidentId), "Resolved", "report after all Work Orders are verified");

        async Task Verify(string id, int cost)
            => await _flow.CommandOkAsync(
                $"api/v1/work-orders/{id}/verify",
                new { version = await _flow.WorkOrderVersionAsync(id), actualCost = cost, result = "Đã kiểm tra kết quả", costVarianceReason = "Chi phí thực tế khác dự toán", assetCondition = "Đã sửa", assetStatus = 0 },
                "owner",
                "verify with the actual cost");
    }

    [SkippableFact(DisplayName = "ITC-BF07-014 Test returning a Work Order for rework.")]
    [Trait("TestCase", "ITC-BF07-014")]
    public async Task ITC_BF07_014()
    {
        var (_, incidentId, wo) = await _flow.PendingVerificationAsync();
        var staffNotesBefore = await _flow.NotificationCountAsync("staff", incidentId);
        const string reason = "Vẫn còn rò nước ở chân vòi - BF07-014";

        // 1. Owner returns the Work Order with a reason.
        await _flow.CommandOkAsync($"api/v1/work-orders/{wo}/rework", new { version = await _flow.WorkOrderVersionAsync(wo), note = reason }, "owner", "rework");

        // The Work Order goes back to In Progress with the reason and the Staff is notified.
        IncidentFlow.AssertState(await _flow.WorkOrderAsync(wo), "In Progress", "Work Order after rework");
        bool IsRework(JsonElement a) => string.Equals(a.Str("workOrderId"), wo, StringComparison.OrdinalIgnoreCase) && (a.Str("note") ?? string.Empty).Contains(reason, StringComparison.Ordinal);
        Assert.Contains(await _flow.HistoryAsync(incidentId), IsRework);
        Assert.True(await _flow.NotificationCountAsync("staff", incidentId) > staffNotesBefore, "The Staff got no notification for the rework.");

        // 2. Staff continues and submits again.
        await _flow.SubmitCompletionAsync(incidentId, wo);

        // The history keeps the rework.
        IncidentFlow.AssertState(await _flow.WorkOrderAsync(wo), "Pending Verification", "Work Order after the new submit");
        Assert.Contains(await _flow.HistoryAsync(incidentId), IsRework);
    }

    [SkippableFact(DisplayName = "ITC-BF07-015 Test cancelling Work Orders.")]
    [Trait("TestCase", "ITC-BF07-015")]
    public async Task ITC_BF07_015()
    {
        var site = await _flow.CreateSiteAsync();
        var incidentId = await _flow.StaffReportAsync(site);
        await _flow.ReviewAsync(incidentId);
        var wo = await _flow.AssignAsync(incidentId, site.StaffId!);

        // 1. Cancel the only Work Order of a report with a reason.
        await _flow.CommandOkAsync(
            $"api/v1/work-orders/{wo}/cancel",
            new { version = await _flow.WorkOrderVersionAsync(wo), reason = "Hủy để giao lại sau", assetStatus = 1, assetCondition = "Còn hỏng" },
            "owner",
            "cancel the only Work Order");

        // 2. Check the report and the asset.
        // The report is not resolved by itself.
        var report = await _flow.IncidentAsync(incidentId);
        Assert.False(IncidentFlow.SameState(report.Str("status"), "Resolved"), "The report was Resolved by itself after its only Work Order was cancelled.");
        // The asset keeps tracking other incidents.
        var another = await _flow.StaffReportAsync(site);
        var byAsset = await IncidentFlow.OkJsonAsync(await _api.GetAsync($"api/v1/incidents?assetId={site.AssetId}&page=1&pageSize=100", await _flow.TokenAsync("owner")), "reports of the asset");
        var ids = byAsset.Items().Select(i => i.Str("id")?.ToLowerInvariant()).ToList();
        Assert.Contains(incidentId.ToLowerInvariant(), ids);
        Assert.Contains(another.ToLowerInvariant(), ids);
    }

    [SkippableFact(DisplayName = "ITC-BF07-016 Test verifying and cancelling at the same time.")]
    [Trait("TestCase", "ITC-BF07-016")]
    public async Task ITC_BF07_016()
    {
        var (_, _, wo) = await _flow.PendingVerificationAsync();
        var owner = await _flow.TokenAsync("owner");
        var version = await _flow.WorkOrderVersionAsync(wo);

        // 1. Send a verification and a cancellation of the same Work Order at once, and with an old version.
        var answers = await Task.WhenAll(
            _api.PostAsync($"api/v1/work-orders/{wo}/verify", new { version, actualCost = 200000, result = "Đạt", assetCondition = "Đã sửa", assetStatus = 0 }, owner, PlanData.IdempotencyKey()),
            _api.PostAsync($"api/v1/work-orders/{wo}/cancel", new { version, reason = "Hủy đồng thời", assetStatus = 1, assetCondition = "Còn hỏng" }, owner, PlanData.IdempotencyKey()));
        var stale = await _api.PostAsync($"api/v1/work-orders/{wo}/cancel", new { version, reason = "Hủy với version cũ", assetStatus = 1, assetCondition = "Còn hỏng" }, owner, PlanData.IdempotencyKey());

        // Only one request wins. The other gets a conflict.
        var codes = answers.Select(a => (int)a.StatusCode).ToArray();
        Assert.True(
            answers.Count(a => a.IsSuccessStatusCode) == 1 && answers.Count(a => a.StatusCode == HttpStatusCode.Conflict) == 1,
            $"Expected one success and one 409 but got {string.Join(", ", codes)}. Bodies: {await answers[0].TextAsync()} | {await answers[1].TextAsync()}");
        await PlanAssert.StatusAsync(stale, HttpStatusCode.Conflict, "old version");
    }

    [SkippableFact(DisplayName = "ITC-BF07-017 Test that a failed notification does not undo the business data.", Skip = PlanSkip.FailureInjection)]
    [Trait("TestCase", "ITC-BF07-017")]
    public void ITC_BF07_017()
    {
        // 1. Make the notification delivery fail.
        // 2. Check the incident.
        // 3. Replay the delivery.
        // The incident stays saved. The delivery is replayed without sending twice.
    }
}
