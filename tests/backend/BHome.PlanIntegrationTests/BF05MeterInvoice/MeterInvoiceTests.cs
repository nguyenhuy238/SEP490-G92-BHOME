using System.Net;
using System.Text.Json;
using static BHome.PlanIntegrationTests.BF05MeterInvoice.BillingFlow;

namespace BHome.PlanIntegrationTests.BF05MeterInvoice;

/// <summary>
/// Sheet "BF-05 Meter Invoice" (UC-20 capture/confirm meter readings, UC-21 generate/finalize invoice).
/// Steps and expected results come from the plan; routes and bodies from docs/api (CAPTURE via OCR_MOBILE_DELIVERY,
/// BILLING_AUTOMATION.md, INVOICES.md) and the Postman collection. Environment variables: see <see cref="BillingFlow"/>.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-05 Meter Invoice")]
public sealed class MeterInvoiceTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "ITC-BF05-001 Test that meter-reading tasks are generated once for each period.")]
    [Trait("TestCase", "ITC-BF05-001")]
    public async Task ITC_BF05_001()
    {
        var locationId = Env("BHOME_IT_BF05_LOCATION_ID", "a Location with a billing schedule and an enabled automation plan");
        var period = Env("BHOME_IT_BF05_BILLING_PERIOD", "a yyyy-MM-01 period whose meter day has arrived");
        var future = Env("BHOME_IT_BF05_FUTURE_PERIOD", "a later yyyy-MM-01 period whose meter day has not arrived");
        var roomId = Env("BHOME_IT_BF05_ROOM_ID", "a Room of BHOME_IT_BF05_LOCATION_ID");
        var owner = await sessions.TokenAsync("owner");

        // 1. Run the meter-task job for the billing period, at the same time as a manual request (Development/Testing run-now).
        var runs = await Task.WhenAll(
            RunNowAsync(_api, owner, locationId, period, "Meter"),
            RunNowAsync(_api, owner, locationId, period, "Meter"));
        foreach (var run in runs)
        {
            await PlanAssert.SuccessAsync(run, "step 1 run meter-task job");
        }

        // There is one task for the same Room, meter type and period.
        var first = await AssertOneTaskPerRoomTypeAsync(owner, locationId, period, "step 1");
        Assert.NotEmpty(first);

        // 2. Replace a meter (new meter in the Room) and run it again.
        var current = first.Values.FirstOrDefault(t => string.Equals(t.Str("roomId"), roomId, StringComparison.OrdinalIgnoreCase));
        Skip.If(current.ValueKind == JsonValueKind.Undefined, $"BHOME_IT_BF05_ROOM_ID has no meter task in {period}; give it a meter so the job creates a task.");
        await PlanAssert.SuccessAsync(
            await _api.PostAsync(
                "api/v1/capture/meters",
                new
                {
                    roomId,
                    code = PlanData.Unique("IT-REPLACED-METER"),
                    utilityType = BillingFlow.Int(current, "utilityType"),
                    display = 1,
                    decimalPlaces = 0,
                    installedOn = PlanData.Iso(PlanData.TodayVietnam),
                },
                owner),
            "step 2 replace meter");
        await PlanAssert.SuccessAsync(await RunNowAsync(_api, owner, locationId, period, "Meter"), "step 2 run again");

        // Replacing a meter does not duplicate the task.
        var second = await AssertOneTaskPerRoomTypeAsync(owner, locationId, period, "step 2");
        Assert.Equal(first.Keys.OrderBy(k => k), second.Keys.OrderBy(k => k));
        Assert.Equal(first.Values.Select(t => t.Str("id")).OrderBy(i => i), second.Values.Select(t => t.Str("id")).OrderBy(i => i));

        // 3. Run it before the scheduled date.
        await PlanAssert.SuccessAsync(await RunNowAsync(_api, owner, locationId, future, "Meter"), "step 3 run future period");

        // A future schedule does not run early.
        var early = (await MeterTasksAsync(_api, owner, locationId)).Where(t => SamePeriod(t.Str("billingPeriod"), future)).ToList();
        Assert.True(early.Count == 0, $"step 3: no task may be generated for {future} before its date. Found: {string.Join(", ", early)}");
    }

    [SkippableFact(DisplayName = "ITC-BF05-002 Test capturing and confirming a meter reading.")]
    [Trait("TestCase", "ITC-BF05-002")]
    public async Task ITC_BF05_002()
    {
        var taskId = Env("BHOME_IT_BF05_OPEN_TASK_ID", "an open periodic meter task assigned to 'staff' whose previous reading is confirmed");
        var staff = await sessions.TokenAsync("staff");

        // 1. Sign in as Staff and open the meter task.
        var task = await GetOkAsync(_api, $"api/v1/capture/meter-tasks/{taskId}", staff, "step 1 open task");
        Skip.If(!string.IsNullOrEmpty(task.Str("confirmedReadingId")), "BHOME_IT_BF05_OPEN_TASK_ID is already completed; prepare a new open task.");
        var openStatus = task.Str("status");

        // 2. Take the meter image.
        var evidenceId = await UploadEvidenceAsync(_api, staff, taskId);

        // 3. Read the OCR proposal and correct it if needed.
        var proposal = Parse(await PlanAssert.SuccessAsync(
            await _api.SendBytesAsync(HttpMethod.Post, $"api/v1/ocr/meter-tasks/{taskId}", MeterImage, "image/png", staff),
            "step 3 OCR proposal"));
        var corrected = NextValue(task); // the synthetic image is not a real meter: the reviewer types the checked value.

        // The proposal is saved only as a proposal (the task is still open, no reading).
        await AssertTaskOpenAsync(_api, staff, taskId, "step 3 after OCR");
        _ = proposal;

        // 4. Confirm the reading.
        var confirmed = Parse(await PlanAssert.SuccessAsync(await ConfirmAsync(_api, staff, taskId, corrected, evidenceId), "step 4 confirm"));
        var readingId = confirmed.Str("id");
        Assert.False(string.IsNullOrEmpty(readingId), "The confirmation answer has no reading id.");

        // After the confirmation the task is Completed and only the confirmed usage is shown.
        var done = await GetOkAsync(_api, $"api/v1/capture/meter-tasks/{taskId}", staff, "task after confirmation");
        Assert.Equal(readingId, done.Str("confirmedReadingId"));
        Assert.NotEqual(openStatus, done.Str("status"));
        var reading = await GetOkAsync(_api, $"api/v1/capture/readings/{readingId}", staff, "read confirmed reading");
        Assert.Equal(Dec(corrected), Dec(reading.Str("confirmedValue")));
        Assert.Equal(Dec(corrected) - Dec(task.Str("previousValue")), Dec(reading.Str("consumption")));

        // The image is stored privately (no anonymous download; scoped Staff can download).
        await PlanAssert.StatusAsync(await _api.GetAsync($"api/v1/capture/readings/{readingId}/evidence"), HttpStatusCode.Unauthorized, "anonymous image");
        await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/capture/readings/{readingId}/evidence", staff), "staff image");

        // Confirming again does not create a second reading.
        using var again = await ConfirmAsync(_api, staff, taskId, corrected, evidenceId);
        if (again.IsSuccessStatusCode)
        {
            Assert.Equal(readingId, (await again.JsonAsync()).Str("id"));
        }

        var after = await GetOkAsync(_api, $"api/v1/capture/meter-tasks/{taskId}", staff, "task after second confirmation");
        Assert.Equal(readingId, after.Str("confirmedReadingId"));
    }

    [SkippableFact(DisplayName = "ITC-BF05-003 Test readings that cannot complete the task.")]
    [Trait("TestCase", "ITC-BF05-003")]
    public async Task ITC_BF05_003()
    {
        var noBaselineTask = Env("BHOME_IT_BF05_NO_BASELINE_TASK_ID", "an open periodic meter task (assigned to 'staff') whose meter has no confirmed baseline");
        var taskId = Env("BHOME_IT_BF05_REFUSAL_TASK_ID", "an open periodic meter task (assigned to 'staff') with a confirmed baseline");
        var staff = await sessions.TokenAsync("staff");

        // 1. Confirm a reading when there is no baseline.
        var noBaselineEvidence = await UploadEvidenceAsync(_api, staff, noBaselineTask);
        await PlanAssert.RefusedAsync(await ConfirmAsync(_api, staff, noBaselineTask, "10", noBaselineEvidence), "step 1 no baseline");
        await AssertTaskOpenAsync(_api, staff, noBaselineTask, "step 1");

        var task = await GetOkAsync(_api, $"api/v1/capture/meter-tasks/{taskId}", staff, "open task");
        var value = NextValue(task);

        // 2. Confirm with a wrong image (evidence that does not belong to this task).
        await PlanAssert.RefusedAsync(await ConfirmAsync(_api, staff, taskId, value, Guid.NewGuid().ToString()), "step 2 wrong image");

        // 3. Confirm an unconfirmed or negative reading.
        var evidenceId = await UploadEvidenceAsync(_api, staff, taskId);
        await PlanAssert.RefusedAsync(await ConfirmAsync(_api, staff, taskId, value, evidenceId, humanConfirmed: false), "step 3 not human-confirmed");
        await PlanAssert.RefusedAsync(await ConfirmAsync(_api, staff, taskId, "-1", evidenceId), "step 3 negative reading");
        if (task.Str("previousValue") is { } previous && Dec(previous) > 0)
        {
            await PlanAssert.RefusedAsync(await ConfirmAsync(_api, staff, taskId, Text(Dec(previous) - 1), evidenceId), "step 3 negative usage");
        }

        // Every confirmation is refused and the task is not completed.
        await AssertTaskOpenAsync(_api, staff, taskId, "after the refused confirmations");
    }

    [Fact(DisplayName = "ITC-BF05-004 Test a failed file upload while confirming.", Skip = PlanSkip.FailureInjection + " (storage must fail after the upload)")]
    [Trait("TestCase", "ITC-BF05-004")]
    public void ITC_BF05_004()
    {
        // 1. Confirm a reading while the storage fails after the upload.
        // Expected: no confirmed reading is created; the clean-up of the file is kept and retried.
    }

    [SkippableFact(DisplayName = "ITC-BF05-005 Test the Draft invoice of a shared Room.")]
    [Trait("TestCase", "ITC-BF05-005")]
    public async Task ITC_BF05_005()
    {
        var roomId = Env("BHOME_IT_BF05_SHARED_ROOM_ID", "a Room with several Tenants ('tenant' and 'tenant2')");
        var contractId = Env("BHOME_IT_BF05_SHARED_CONTRACT_ID", "the representative contract of BHOME_IT_BF05_SHARED_ROOM_ID");
        var period = Env("BHOME_IT_BF05_SHARED_PERIOD", "a yyyy-MM-01 period of that Room with policies, some readings confirmed and one not confirmed");
        var owner = await sessions.TokenAsync("owner");
        var tenant = await sessions.TokenAsync("tenant");
        var tenant2 = await sessions.TokenAsync("tenant2");
        var request = new { roomId, billingPeriod = period, representativeContractId = contractId };

        // 1. Run the Draft generation for a Room with several Tenants (3. one reading is left unconfirmed).
        var draft = Parse(await PlanAssert.SuccessAsync(await _api.PostAsync("api/v1/invoices/drafts", request, owner), "step 1 generate Draft"));
        var invoiceId = draft.Str("id")!;

        // 2. Run it again.
        var again = Parse(await PlanAssert.SuccessAsync(await _api.PostAsync("api/v1/invoices/drafts", request, owner), "step 2 generate again"));

        // One Draft is created for the Room and the period; the second run does not create another Draft.
        Assert.Equal(invoiceId, again.Str("id"));
        var invoice = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "owner reads Draft");
        Assert.Equal("Draft", invoice.Str("status"));
        Assert.True(SamePeriod(invoice.Str("billingPeriod"), period), $"Wrong period: {invoice.Str("billingPeriod")}");
        var page = await GetOkAsync(_api, $"api/v1/invoices?roomId={roomId}&page=1&pageSize=100", owner, "owner invoice list");
        Assert.Single(page.Items(), i => SamePeriod(i.Str("billingPeriod"), period));

        // The missing reading is shown explicitly.
        Assert.True(invoice.Find("missingInputs") is { ValueKind: JsonValueKind.Array } m && m.GetArrayLength() > 0, $"missingInputs must list the missing reading. Invoice: {invoice}");

        // With the viewers of that period (every Tenant of the Room can open it).
        await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/invoices/{invoiceId}", tenant), "tenant views Draft");
        await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/invoices/{invoiceId}", tenant2), "tenant2 views Draft");
    }

    [SkippableFact(DisplayName = "ITC-BF05-006 Test finalizing the invoice.")]
    [Trait("TestCase", "ITC-BF05-006")]
    public async Task ITC_BF05_006()
    {
        var invoiceId = Env("BHOME_IT_BF05_COMPLETE_DRAFT_ID", "a Draft invoice of the Room of 'tenant' with all data confirmed and the Final date reached");
        var owner = await sessions.TokenAsync("owner");
        var tenant = await sessions.TokenAsync("tenant");

        // 1. Review the Draft as Owner.
        var draft = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "step 1 review");
        Skip.If(draft.Str("status") != "Draft", "BHOME_IT_BF05_COMPLETE_DRAFT_ID is no longer a Draft; prepare a new complete Draft.");
        var version = BillingFlow.Int(draft, "version");

        // 2. Finalize it.
        await PlanAssert.SuccessAsync(await _api.PostAsync($"api/v1/invoices/{invoiceId}/finalize", new { expectedVersion = version }, owner), "step 2 finalize");
        var final = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "read Final");

        // 3. Try to edit it afterwards.
        await PlanAssert.RefusedAsync(
            await _api.PostAsync($"api/v1/invoices/{invoiceId}/refresh", new { expectedVersion = BillingFlow.Int(final, "version") }, owner),
            "step 3 edit Final");

        // 4. Finalize it twice at the same time.
        var twice = await Task.WhenAll(
            _api.PostAsync($"api/v1/invoices/{invoiceId}/finalize", new { expectedVersion = version }, owner),
            _api.PostAsync($"api/v1/invoices/{invoiceId}/finalize", new { expectedVersion = version }, owner));
        foreach (var r in twice)
        {
            Assert.True((int)r.StatusCode < 500, $"step 4: unexpected {(int)r.StatusCode}");
        }

        // It is finalized once with the due date; a final invoice cannot be edited.
        var after = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "read after double finalize");
        Assert.Equal("Final", after.Str("status"));
        Assert.False(string.IsNullOrEmpty(after.Str("dueDate")), "The Final invoice has no due date.");
        Assert.Equal(final.Str("finalizedAt"), after.Str("finalizedAt"));
        Assert.Equal(final.Str("version"), after.Str("version"));
        Assert.Equal(final.Str("total"), after.Str("total"));

        // The Tenants are notified.
        Assert.Contains(invoiceId, await InvoiceNotificationTargetsAsync(_api, owner, tenant));

        // History of old periods stays visible.
        var roomInvoices = await GetOkAsync(_api, "api/v1/invoices?page=1&pageSize=100", tenant, "tenant invoice history");
        Assert.Contains(roomInvoices.Items(), i => i.Str("id") == invoiceId);
        foreach (var old in roomInvoices.Items().Where(i => string.CompareOrdinal(i.Str("billingPeriod"), after.Str("billingPeriod")) < 0))
        {
            await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/invoices/{old.Str("id")}", tenant), $"old period {old.Str("billingPeriod")}");
        }
    }

    [SkippableFact(DisplayName = "ITC-BF05-007 Test the schedule settings.")]
    [Trait("TestCase", "ITC-BF05-007")]
    public async Task ITC_BF05_007()
    {
        var locationId = Env("BHOME_IT_BF05_LOCATION_ID", "a Location managed by 'owner' with 'staff' assigned");
        var owner = await sessions.TokenAsync("owner");
        var staff = await sessions.TokenAsync("staff");

        using var current = await _api.GetAsync($"api/v1/billing-schedules/{locationId}", owner);
        var saved = current.StatusCode == HttpStatusCode.OK ? (JsonElement?)await current.JsonAsync() : null;
        int Value(string name, int fallback) => saved?.Str(name) is { } s ? int.Parse(s, System.Globalization.CultureInfo.InvariantCulture) : fallback;
        object Schedule(int expectedVersion, int draftDay, int finalDay, int dueDay) => new
        {
            locationId,
            rateDate = Value("rateDate", 0),
            rentSource = Value("rentSource", 0),
            partialMonth = Value("partialMonth", 0),
            rounding = Value("rounding", 0),
            draftDay,
            draftMonthOffset = Value("draftMonthOffset", 1),
            finalDay,
            finalMonthOffset = Value("finalMonthOffset", 1),
            dueDay,
            dueMonthOffset = Value("dueMonthOffset", 1),
            expectedVersion,
        };
        var version = Value("version", 0);
        var valid = Schedule(version, Value("draftDay", 1), Value("finalDay", 3), Value("dueDay", 10));

        // 1. Save the billing schedule as Staff.  Only the Owner can save it.
        await PlanAssert.RefusedAsync(await _api.PutAsync("api/v1/billing-schedules", valid, staff), "step 1 Staff save");

        // 2. Save it as Owner with invalid dates.  Invalid dates are refused.
        await PlanAssert.RefusedAsync(await _api.PutAsync("api/v1/billing-schedules", Schedule(version, 32, 3, 10), owner), "step 2 day 32");
        await PlanAssert.RefusedAsync(
            await _api.PutAsync("api/v1/billing-schedules", new { locationId, rateDate = 0, rentSource = 0, partialMonth = 0, rounding = 0, draftDay = 20, draftMonthOffset = 0, finalDay = 10, finalMonthOffset = 0, dueDay = 5, dueMonthOffset = 0, expectedVersion = version }, owner),
            "step 2 Draft after Final after Due");

        // 3. Save it with an old version.  An old version gets a conflict.
        await PlanAssert.SuccessAsync(await _api.PutAsync("api/v1/billing-schedules", valid, owner), "Owner saves the current version");
        await PlanAssert.StatusAsync(await _api.PutAsync("api/v1/billing-schedules", valid, owner), HttpStatusCode.Conflict, "step 3 old version");
    }

    [SkippableFact(DisplayName = "ITC-BF05-008 Test the scheduled finalization.")]
    [Trait("TestCase", "ITC-BF05-008")]
    public async Task ITC_BF05_008()
    {
        var locationId = Env("BHOME_IT_BF05_SCHED_LOCATION_ID", "a Location whose plan authorizes automatic Final and whose Final date has arrived");
        var period = Env("BHOME_IT_BF05_SCHED_PERIOD", "the yyyy-MM-01 period of the scheduled finalization");
        var invoiceId = Env("BHOME_IT_BF05_SCHED_INVOICE_ID", "a Draft invoice of that Location/period with one missing reading");
        var taskId = Env("BHOME_IT_BF05_SCHED_TASK_ID", "the open meter task (assigned to 'staff') of that missing reading");
        var revokeLocation = Env("BHOME_IT_BF05_REVOKE_LOCATION_ID", "a second Location whose plan authorizes automatic Final");
        var revokePeriod = Env("BHOME_IT_BF05_REVOKE_PERIOD", "the yyyy-MM-01 period of the revoked run (Final date arrived)");
        var revokeInvoice = Env("BHOME_IT_BF05_REVOKE_INVOICE_ID", "a complete Draft invoice of that second Location/period");
        var owner = await sessions.TokenAsync("owner");
        var staff = await sessions.TokenAsync("staff");

        // 1. Let the finalization date arrive while data is missing (the date is already reached; run the Final phase twice).
        var before = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Draft before");
        Skip.If(before.Str("status") != "Draft", "BHOME_IT_BF05_SCHED_INVOICE_ID is no longer a Draft; prepare new data.");
        await PlanAssert.SuccessAsync(await RunNowAsync(_api, owner, locationId, period, "Final"), "step 1 first run");
        var afterFirst = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Draft after first run");
        await PlanAssert.SuccessAsync(await RunNowAsync(_api, owner, locationId, period, "Final"), "step 1 second run");
        var afterSecond = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Draft after second run");

        // With missing data the invoice stays Draft and is not changed again and again.
        Assert.Equal("Draft", afterFirst.Str("status"));
        Assert.Equal("Draft", afterSecond.Str("status"));
        Assert.Equal(afterFirst.Str("version"), afterSecond.Str("version"));

        // 2. Confirm the missing reading and run again.
        var task = await GetOkAsync(_api, $"api/v1/capture/meter-tasks/{taskId}", staff, "missing reading task");
        var evidenceId = await UploadEvidenceAsync(_api, staff, taskId);
        await PlanAssert.SuccessAsync(await ConfirmAsync(_api, staff, taskId, NextValue(task), evidenceId), "step 2 confirm missing reading");
        await PlanAssert.SuccessAsync(await RunNowAsync(_api, owner, locationId, period, "Final"), "step 2 run");
        var final = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "invoice after run");
        await PlanAssert.SuccessAsync(await RunNowAsync(_api, owner, locationId, period, "Final"), "step 2 run again");
        var finalAgain = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "invoice after second run");

        // After the data is confirmed it is finalized once.
        Assert.Equal("Final", final.Str("status"));
        Assert.Equal(final.Str("finalizedAt"), finalAgain.Str("finalizedAt"));
        Assert.Equal(final.Str("version"), finalAgain.Str("version"));

        // 3. Revoke the Owner authorization before a queued run (new plan version without Final authorization), then run.
        var plan = await GetOkAsync(_api, $"api/v1/billing-automation/{revokeLocation}?period={revokePeriod}", owner, "current plan");
        using var scheduleAnswer = await _api.GetAsync($"api/v1/billing-schedules/{revokeLocation}", owner);
        var schedule = await scheduleAnswer.JsonAsync();
        await PlanAssert.SuccessAsync(
            await _api.PutAsync(
                "api/v1/billing-automation",
                new
                {
                    locationId = revokeLocation,
                    effectiveFrom = revokePeriod,
                    enabled = true,
                    authorizeAutomaticFinalization = false,
                    meterDay = BillingFlow.Int(plan, "meterDay"),
                    meterDueDay = BillingFlow.Int(plan, "meterDueDay"),
                    meterDueMonthOffset = BillingFlow.Int(plan, "meterDueMonthOffset"),
                    timeZone = "Asia/Ho_Chi_Minh",
                    expectedVersion = BillingFlow.Int(plan, "version"),
                    expectedBillingScheduleVersion = BillingFlow.Int(schedule, "version"),
                },
                owner),
            "step 3 revoke authorization");
        using (await RunNowAsync(_api, owner, revokeLocation, revokePeriod, "Final"))
        {
        }

        // Without the Owner authorization nothing is finalized.
        var revoked = await GetOkAsync(_api, $"api/v1/invoices/{revokeInvoice}", owner, "invoice after revoked run");
        Assert.Equal("Draft", revoked.Str("status"));
    }

    /// <summary>Tasks of the period keyed by Room + meter type; fails when a key has more than one task.</summary>
    private async Task<Dictionary<string, JsonElement>> AssertOneTaskPerRoomTypeAsync(string owner, string locationId, string period, string step)
    {
        var groups = (await MeterTasksAsync(_api, owner, locationId))
            .Where(t => SamePeriod(t.Str("billingPeriod"), period))
            .GroupBy(t => $"{t.Str("roomId")}|{t.Str("utilityType")}")
            .ToList();
        foreach (var g in groups)
        {
            Assert.True(g.Count() == 1, $"{step}: {g.Count()} tasks for Room|type {g.Key} in {period}: {string.Join(", ", g.Select(t => t.Str("id")))}");
        }

        return groups.ToDictionary(g => g.Key, g => g.First());
    }
}
