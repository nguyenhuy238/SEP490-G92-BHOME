using System.Net;
using System.Text.Json;
using BHome.PlanIntegrationTests.BF03OnboardingContract;

namespace BHome.PlanIntegrationTests.BF04RenewalMoveOut;

/// <summary>
/// Sheet "BF-04 Renewal Move-out" (UC-16, UC-18, UC-19, JOB-02). Steps and expected results come only from the plan;
/// routes/bodies from docs/api/CONTRACT_LIFECYCLE.md, docs/development/CONTRACT_LIFECYCLE_DELIVERY.md,
/// docs/development/BE_03_05_07_08_09_10_18_37_38_DELIVERY.md, docs/api/NOTIFICATIONS.md and the Postman collections.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-04 Renewal Move-out")]
public sealed class RenewalMoveOutTests(PlanSessions sessions)
{
    private const string NoIssuedInvoice =
        PlanSkip.ServerClock + " The precondition needs an issued (Final) invoice for the Room inside the contract: docs require a Periodic reading dated after the "
        + "baseline and a reached billing calendar (Postman guide 5.3, CONTRACT_LIFECYCLE.md settlement), which a contract created today cannot have";

    private readonly ContractFlow _flow = new(sessions);
    private PlanApi Api => sessions.Api;

    // ================= Contract Expiry, Renewal and Termination (UC-16, UC-19) =================

    [Fact(
        DisplayName = "ITC-BF04-001 Test the contract expiry reminder job.",
        Skip = PlanSkip.BackgroundJob + " JOB-02 contract-expiry only runs from the scheduler (CONTRACT_LIFECYCLE.md); the Postman guide says not to call any fake JOB-02 trigger. Plan precondition: Active contract expiring in 25 days.")]
    [Trait("TestCase", "ITC-BF04-001")]
    public void ITC_BF04_001()
    {
    }

    [SkippableFact(DisplayName = "ITC-BF04-002 Test renewing a contract.")]
    [Trait("TestCase", "ITC-BF04-002")]
    public async Task ITC_BF04_002()
    {
        // Precondition: active contract.
        var lease = await _flow.ActiveLeaseAsync();
        var parent = await _flow.GetOkAsync($"api/v1/contracts/{lease.ContractId}", "owner", "read parent contract");
        var parentEnd = DateOnly.Parse(parent.Str("endDate")!);
        var renewalBody = new { endDate = ContractFlow.Iso(parentEnd.AddYears(1)), monthlyRent = "3200000", terms = "SYNTHETIC RENEWAL - new terms" };

        // 1. Prepare a renewal with the new terms.
        using var created = await _flow.PostKeyedAsync($"api/v1/contracts/{lease.ContractId}/renewals", renewalBody, "owner");
        var renewalId = ContractFlow.Id(ContractFlow.Parse(await PlanAssert.SuccessAsync(created, "prepare renewal")), "renewal");

        // 2. Both parties sign.
        await _flow.SignBothAsync(renewalId);

        // 3. Prepare a second renewal for the same contract.
        using var second = await _flow.PostKeyedAsync($"api/v1/contracts/{lease.ContractId}/renewals", renewalBody, "owner");

        // 4. Check the contract before and after the new start date (before: today).
        var renewal = await _flow.GetOkAsync($"api/v1/contracts/{renewalId}", "owner", "read renewal");
        var parentNow = await _flow.GetOkAsync($"api/v1/contracts/{lease.ContractId}", "owner", "read parent after renewal");
        var versions = (await _flow.GetOkAsync($"api/v1/contracts/{lease.ContractId}/versions", "owner", "version chain")).Items();

        // Expected: a new version is created and the signed version is kept.
        Assert.Contains(versions, v => string.Equals(v.Str("id"), renewalId, StringComparison.OrdinalIgnoreCase));
        Assert.Contains(versions, v => string.Equals(v.Str("id"), lease.ContractId, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(lease.ContractId, renewal.Str("previousContractId"), ignoreCase: true);
        Assert.Equal(parent.Str("terms"), parentNow.Str("terms"));
        Assert.Equal(parent.Str("endDate"), parentNow.Str("endDate"));
        Assert.Equal(parent.Find("signatures")!.Value.GetRawText(), parentNow.Find("signatures")!.Value.GetRawText());

        // Expected: the second renewal is refused.
        await PlanAssert.RefusedAsync(second, "second renewal");

        // Expected: the renewal starts on its effective date (before it, the parent stays Active and the renewal is not Active).
        Assert.Equal("Active", parentNow.Str("status"));
        Assert.NotEqual("Active", renewal.Str("status"));
        Assert.Equal(ContractFlow.Iso(parentEnd.AddDays(1)), renewal.Str("startDate"));

        Skip.If(true, "Steps 1-3 and the 'before the new start date' check passed. " + PlanSkip.ServerClock + " (the 'after the new start date' check needs the date after " + parent.Str("endDate") + ").");
    }

    [SkippableFact(DisplayName = "ITC-BF04-003 Test the termination request and the Owner approval.")]
    [Trait("TestCase", "ITC-BF04-003")]
    public async Task ITC_BF04_003()
    {
        // Precondition: active contract.
        var lease = await _flow.ActiveLeaseAsync();
        var c = lease.ContractId;

        // 1. Sign in as Tenant and request an early termination with a date.
        var request = await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/termination-requests", new { proposedDate = ContractFlow.Iso(ContractFlow.Today.AddDays(7)), reason = "SYNTHETIC early termination" }, "tenant", "Tenant requests termination");

        // Expected: the request is stored. The contract is not closed and the Room is not released by the request.
        var stored = await _flow.GetOkAsync($"api/v1/contracts/{c}/move-out", "owner", "read move-out");
        Assert.Equal(request.Str("id"), stored.Str("id"));
        Assert.Equal(ContractFlow.Iso(ContractFlow.Today.AddDays(7)), stored.Str("proposedDate"));
        Assert.Equal("Active", (await _flow.GetOkAsync($"api/v1/contracts/{c}", "owner", "read contract")).Str("status"));
        var room = await _flow.RoomStatusAsync(lease.Space.RoomId);
        Assert.True(ContractFlow.RoomIs(room, "Occupied", 2), $"Room status is '{room}', expected Occupied.");

        // 2. Sign in as Owner and approve it.
        var approved = await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/move-out/approve", null, "owner", "Owner approves");
        Assert.Equal("Approved", approved.Str("status"));

        // 3. Schedule the inspection for a Staff.
        var staffId = await _flow.UserIdAsync("staff");
        var scheduled = await _flow.PostKeyedOkAsync(
            $"api/v1/contracts/{c}/move-out/schedule",
            new { scheduledAt = DateTime.UtcNow.AddDays(7).ToString("yyyy-MM-ddTHH:mm:ssZ"), staffUserId = staffId, expectedVersion = int.Parse(approved.Str("version") ?? "0") },
            "owner",
            "Owner schedules the inspection");

        // Expected: the inspection is assigned to a Staff of the Location.
        Assert.Equal(staffId, scheduled.Str("inspectionStaffId"), ignoreCase: true);
        using var assignments = await Api.GetAsync("api/v1/contracts/move-out-assignments", await _flow.Token("staff"));
        Assert.Contains(c, await PlanAssert.SuccessAsync(assignments, "Staff move-out assignments"), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Active", (await _flow.GetOkAsync($"api/v1/contracts/{c}", "owner", "read contract after approval")).Str("status"));
    }

    [SkippableFact(DisplayName = "ITC-BF04-004 Test the move-out inspection and completing the move-out.")]
    [Trait("TestCase", "ITC-BF04-004")]
    public async Task ITC_BF04_004()
    {
        // Precondition: move-out approved and scheduled (move-in handover done; move-out date = today so the inspection can run).
        var lease = await _flow.HandedOverLeaseAsync();
        var c = lease.ContractId;
        var version = await ScheduledMoveOutAsync(c);

        // 1. Staff opens the inspection and records the condition, photos and the final meter readings.
        var preparation = await _flow.GetOkAsync($"api/v1/contracts/{c}/move-out/inspection-preparation", "staff", "Staff opens the inspection");
        var finalElectricity = await _flow.ConfirmedReadingAsync(lease.ElectricityMeterId, 2, "100", c);
        var finalWater = await _flow.ConfirmedReadingAsync(lease.WaterMeterId, 2, "100", c);
        var photo = ContractFlow.Id(await _flow.UploadPngOkAsync(HttpMethod.Post, $"api/v1/contracts/{c}/move-out/evidence", "staff", "upload inspection photo"), "inspection photo");
        await _flow.PostKeyedOkAsync(
            $"api/v1/contracts/{c}/move-out/inspection",
            new
            {
                electricityReadingId = finalElectricity,
                waterReadingId = finalWater,
                notes = "SYNTHETIC inspection",
                evidenceIds = new[] { photo },
                assets = Array.Empty<object>(),
                roomCondition = "Room checked (synthetic)",
                keysAndAccess = "Keys returned (synthetic)",
                expectedVersion = version,
            },
            "staff",
            "Staff records the inspection");

        // Expected: the inspection uses the move-in handover as the baseline.
        Assert.NotEqual(JsonValueKind.Null, preparation.Find("baseline")?.ValueKind ?? JsonValueKind.Null);
        Assert.Equal(c, preparation.Str("baselineContractId"), ignoreCase: true);
        var inspection = (await _flow.GetOkAsync($"api/v1/contracts/{c}/move-out/inspections", "owner", "Owner reads inspections")).Items()[0];
        Assert.Equal(c, inspection.Str("baselineContractId"), ignoreCase: true);
        Assert.NotNull(inspection.Find("baseline"));

        // 2. Owner reviews the inspection and the settlement.
        await _flow.PostKeyedOkAsync(
            $"api/v1/contracts/{c}/move-out/inspection-review",
            new { version = int.Parse(inspection.Str("version") ?? "1"), confirmed = true, reason = "SYNTHETIC inspection review", noAdditionalCharges = true },
            "owner",
            "Owner reviews the inspection");

        // Expected: the settlement is reviewed before the contract is closed.
        using (var early = await _flow.PostKeyedAsync($"api/v1/contracts/{c}/move-out/complete", new { actualEndDate = ContractFlow.Iso(ContractFlow.Today) }, "owner"))
        {
            await PlanAssert.RefusedAsync(early, "complete before the settlement review");
        }

        var summary = await _flow.GetOkAsync($"api/v1/contracts/{c}/move-out/settlement-summary", "owner", "settlement summary");
        await _flow.PostKeyedOkAsync(
            $"api/v1/contracts/{c}/move-out/settlement",
            new { decision = "SYNTHETIC Owner settlement review", expectedReference = summary.Str("reference") },
            "owner",
            "Owner reviews the settlement");
        Assert.NotEmpty((await _flow.GetOkAsync($"api/v1/contracts/{c}/move-out/settlement-history", "owner", "settlement history")).Items());

        // 3. Owner completes the move-out.
        var closed = await _flow.PostKeyedOkAsync($"api/v1/contracts/{c}/move-out/complete", new { actualEndDate = ContractFlow.Iso(ContractFlow.Today) }, "owner", "Owner completes the move-out");

        // Expected: the contract is closed and the Room is released when no other tenancy remains.
        Assert.Equal("false", preparation.Str("otherTenantsRemain"));
        Assert.Equal("Terminated", closed.Str("status"));
        var room = await _flow.RoomStatusAsync(lease.Space.RoomId);
        Assert.True(ContractFlow.RoomIs(room, "Available", 0), $"Room status is '{room}', expected Available.");
    }

    [Fact(DisplayName = "ITC-BF04-005 Test that the settlement uses the real debt, adjustments and deposits.", Skip = NoIssuedInvoice + " (plan precondition: Move-out with an invoice and a deposit).")]
    [Trait("TestCase", "ITC-BF04-005")]
    public void ITC_BF04_005()
    {
    }

    [Fact(DisplayName = "ITC-BF04-006 Test that a new adjustment blocks the closing of the contract.", Skip = NoIssuedInvoice + " (plan precondition: Settlement under review; step 2 approves an invoice adjustment).")]
    [Trait("TestCase", "ITC-BF04-006")]
    public void ITC_BF04_006()
    {
    }

    // ================= Temporary Residence Registration (UC-18) =================

    [SkippableFact(DisplayName = "ITC-BF04-007 Test tracking the temporary residence registration.")]
    [Trait("TestCase", "ITC-BF04-007")]
    public async Task ITC_BF04_007()
    {
        // Precondition: active contract.
        var lease = await _flow.ActiveLeaseAsync();
        var task = $"api/v1/residence-tasks/{lease.ContractId}/{lease.ResidentId}";
        var ownerBefore = await NotificationCountAsync("owner");
        var tenantBefore = await NotificationCountAsync("tenant");
        var tenant = await _flow.Token("tenant");

        // 1. Record the actual residence start date.
        var current = await _flow.GetOkAsync(task, "tenant", "Tenant reads the residence task");
        using (var start = await Api.PutAsync(task, new { actualResidenceFrom = ContractFlow.Iso(ContractFlow.Today), status = current.Str("status"), resultAt = (string?)null, note = "Actual residence start (synthetic)" }, tenant))
        {
            await PlanAssert.SuccessAsync(start, "record the actual residence start date");
        }

        // 2. Open the Temporary Residence task of the Tenant.
        using var list = await Api.GetAsync("api/v1/residence-tasks?page=1&pageSize=100", tenant);
        Assert.Contains(lease.ContractId, await PlanAssert.SuccessAsync(list, "Tenant residence tasks"), StringComparison.OrdinalIgnoreCase);
        var opened = await _flow.GetOkAsync(task, "tenant", "open the residence task");
        Assert.Equal(ContractFlow.Iso(ContractFlow.Today), opened.Str("actualResidenceFrom"));

        // 3. Record the result and upload the evidence.
        await _flow.UploadPngOkAsync(HttpMethod.Put, task + "/evidence", "tenant", "upload residence evidence");
        using (var result = await Api.PutAsync(task, new { actualResidenceFrom = ContractFlow.Iso(ContractFlow.Today), status = "Completed", resultAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"), note = "Registered outside BHOME (synthetic)" }, tenant))
        {
            await PlanAssert.SuccessAsync(result, "record the residence result");
        }

        // Expected: the status and the evidence are stored.
        var stored = await _flow.GetOkAsync(task, "owner", "Owner reads the residence task");
        Assert.Equal("Completed", stored.Str("status"));
        Assert.Equal("true", stored.Str("hasEvidence"));
        Assert.NotNull(stored.Str("resultAt"));
        using (var evidence = await Api.GetAsync(task + "/evidence", await _flow.Token("owner")))
        {
            await PlanAssert.SuccessAsync(evidence, "Owner downloads the evidence");
        }

        // Expected: the Owner and the Tenant are notified (inbox publication: Development/Testing process-events, NOTIFICATIONS.md).
        using (var publish = await Api.PostAsync("api/v1/notifications/process-events", null, await _flow.Token("owner")))
        {
            Skip.If(publish.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden, "Notification publication needs the Development/Testing process-events route (or the worker); it is not available here.");
            await PlanAssert.SuccessAsync(publish, "publish pending notification events");
        }

        Assert.True(await NotificationCountAsync("owner") > ownerBefore, "The Owner received no new notification.");
        Assert.True(await NotificationCountAsync("tenant") > tenantBefore, "The Tenant received no new notification.");
    }

    // ---------- helpers ----------
    /// <summary>Tenant requests termination for today, Owner approves and schedules the assigned Staff. Returns the move-out version.</summary>
    private async Task<int> ScheduledMoveOutAsync(string contractId)
    {
        await _flow.PostKeyedOkAsync($"api/v1/contracts/{contractId}/termination-requests", new { proposedDate = ContractFlow.Iso(ContractFlow.Today), reason = "SYNTHETIC move-out" }, "tenant", "Tenant requests termination");
        var approved = await _flow.PostKeyedOkAsync($"api/v1/contracts/{contractId}/move-out/approve", null, "owner", "Owner approves");
        var scheduled = await _flow.PostKeyedOkAsync(
            $"api/v1/contracts/{contractId}/move-out/schedule",
            new { scheduledAt = DateTime.UtcNow.AddMinutes(5).ToString("yyyy-MM-ddTHH:mm:ssZ"), staffUserId = await _flow.UserIdAsync("staff"), expectedVersion = int.Parse(approved.Str("version") ?? "0") },
            "owner",
            "Owner schedules the inspection");
        return int.Parse(scheduled.Str("version") ?? "0");
    }

    private async Task<int> NotificationCountAsync(string account)
        => int.Parse((await _flow.GetOkAsync("api/v1/notifications?page=1&pageSize=1", account, account + " inbox")).Str("totalCount") ?? "0");
}
