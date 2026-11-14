using System.Net;
using BHome.PlanIntegrationTests.BF01LocationSetup;

namespace BHome.PlanIntegrationTests.BF02StaffTasks;

/// <summary>
/// Sheet "BF-02 Staff Tasks" (UC-10, UC-11, UC-12, GBR-02, GBR-18). Steps and expected results come from the plan only;
/// routes and payloads from docs/api/OPERATIONAL_TASKS.md, NOTIFICATIONS.md, development/BE_03_05_07_08_09_10_18_37_38_DELIVERY.md
/// (Staff replacement) and Postman BHome.Simple 81-118, 215.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-02 Staff Tasks")]
public sealed class StaffTaskTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;
    private readonly TaskSetup _tasks = new(sessions);

    [SkippableFact(DisplayName = "ITC-BF02-001 Test creating an ad-hoc task for a Location.")]
    [Trait("TestCase", "ITC-BF02-001")]
    public async Task ITC_BF02_001()
    {
        // Pre-condition: L1 has a responsible Staff.
        var l1 = await _tasks.LocationWithStaffAsync();
        var staffUserId = await _tasks.Property.UserIdAsync("staff");

        // 1. Sign in as Owner.
        var owner = await sessions.TokenAsync("owner");

        // 2. Create a task for L1 with a name, priority, deadline and required evidence.
        var title = PlanData.Unique("BF02-001 task");
        var created = await _tasks.PostCreateAsync(l1, TaskSetup.Work(title, evidenceRequired: true, priority: "High"), token: owner);

        // 3. Sign in as the responsible Staff and open My Tasks.
        await PlanAssert.StatusAsync(created, HttpStatusCode.Created, "step 2 create task");
        var task = await created.JsonAsync();
        var taskId = TaskSetup.Id(task);
        var myTasks = await _tasks.TasksOfLocationAsync(l1, "staff");

        // Expected: The task is created as Assigned for the responsible Staff.
        Assert.Equal("Assigned", task.Str("status"));
        Assert.Equal(staffUserId, task.Str("currentResponsibleStaffUserId"), StringComparer.OrdinalIgnoreCase);
        Assert.Equal(title, task.Str("title"));
        Assert.Equal("High", task.Str("priority"));
        Assert.Equal("true", task.Str("evidenceRequired"));
        Assert.False(string.IsNullOrEmpty(task.Str("dueAt")), "dueAt is missing.");

        // Expected: The Staff gets a notification and sees the task.
        Assert.Contains(myTasks, t => t.Str("id") == taskId);
        Assert.True(await _tasks.CountTaskNotificationsAsync("staff", taskId) >= 1, "The responsible Staff has no notification for the new task.");
    }

    [SkippableFact(DisplayName = "ITC-BF02-002 Test creating a task with no responsible Staff or with invalid data.")]
    [Trait("TestCase", "ITC-BF02-002")]
    public async Task ITC_BF02_002()
    {
        // Pre-condition: A Location without a Staff assignment (and one with a Staff for the invalid-deadline step).
        var noStaff = PropertySetup.Id(await _tasks.Property.CreateLocationAsync());
        var withStaff = await _tasks.LocationWithStaffAsync();

        // 1. Create a task for a Location that has no responsible Staff.
        var orphan = await _tasks.PostCreateAsync(noStaff, TaskSetup.Work(PlanData.Unique("BF02-002 no staff")));

        // 2. Create a task with an invalid deadline (in the past; and without a time-zone offset).
        var pastDeadline = await _tasks.PostCreateAsync(withStaff, TaskSetup.Work(PlanData.Unique("BF02-002 past"), dueAt: DateTimeOffset.UtcNow.AddHours(-2)));
        var noOffset = await _tasks.PostCreateAsync(withStaff, new
        {
            title = PlanData.Unique("BF02-002 no offset"),
            requirements = "Kiểm tra khu vực chung.",
            priority = "Normal",
            dueAt = DateTime.UtcNow.AddDays(2).ToString("yyyy-MM-ddTHH:mm:ss"),
            evidenceRequired = true,
        });

        // Expected: The task is refused or not saved. No task, history or file is left behind.
        await PlanAssert.RefusedAsync(orphan, "step 1 Location without responsible Staff");
        await PlanAssert.RefusedAsync(pastDeadline, "step 2 deadline in the past");
        await PlanAssert.RefusedAsync(noOffset, "step 2 deadline without offset");
        Assert.Empty(await _tasks.TasksOfLocationAsync(noStaff));
        Assert.Empty(await _tasks.TasksOfLocationAsync(withStaff));

        // 3. Upload evidence and make the upload fail — needs a storage failure inside the server.
        Skip.If(true, PlanSkip.FailureInjection + " (ITC-BF02-002 step 3: evidence upload failure and file clean-up). Steps 1-2 passed.");
    }

    [SkippableFact(DisplayName = "ITC-BF02-003 Test creating or updating the same task twice at the same time.")]
    [Trait("TestCase", "ITC-BF02-003")]
    public async Task ITC_BF02_003()
    {
        // Pre-condition: Owner is signed in.
        var locationId = await _tasks.LocationWithStaffAsync();
        var owner = await sessions.TokenAsync("owner");

        // 1. Send the same create request twice (same Idempotency-Key and payload, at the same time).
        var key = Guid.NewGuid().ToString();
        var work = TaskSetup.Work(PlanData.Unique("BF02-003 task"));
        var creates = await Task.WhenAll(
            _tasks.PostCreateAsync(locationId, work, key, owner),
            _tasks.PostCreateAsync(locationId, work, key, owner));

        // Expected: Only one task is created.
        Assert.True(creates.Any(r => r.IsSuccessStatusCode), "Neither create request succeeded: " + string.Join(" | ", await Task.WhenAll(creates.Select(r => r.TextAsync()))));
        var ids = new List<string>();
        foreach (var response in creates)
        {
            if (response.IsSuccessStatusCode)
            {
                ids.Add(TaskSetup.Id(await response.JsonAsync()));
            }
            else
            {
                await PlanAssert.RefusedAsync(response, "duplicate create");
            }
        }

        Assert.Single(ids.Distinct());
        Assert.Single(await _tasks.TasksOfLocationAsync(locationId));

        // 2. Update the same task from two sessions.
        var taskId = ids[0];
        var current = await _tasks.GetAsync(taskId);
        var sessionB = (await sessions.NewSessionAsync("owner", "BF02-003 second session")).AccessToken;
        var updates = await Task.WhenAll(
            _api.PutAsync($"{TaskSetup.Base}/{taskId}", new { version = TaskSetup.Version(current), work = TaskSetup.Work("BF02-003 phiên 1"), reason = "Cập nhật từ phiên 1" }, owner, PlanData.IdempotencyKey()),
            _api.PutAsync($"{TaskSetup.Base}/{taskId}", new { version = TaskSetup.Version(current), work = TaskSetup.Work("BF02-003 phiên 2"), reason = "Cập nhật từ phiên 2" }, sessionB, PlanData.IdempotencyKey()));

        // Expected: The second update is refused with a version conflict.
        Assert.Equal(1, updates.Count(r => r.IsSuccessStatusCode));
        await PlanAssert.StatusAsync(updates.Single(r => !r.IsSuccessStatusCode), HttpStatusCode.Conflict, "step 2 second update");
    }

    [Fact(
        DisplayName = "ITC-BF02-004 Test that a recurring task is generated by the schedule (JOB-06).",
        Skip = PlanSkip.BackgroundJob + " JOB-06: recurring templates exist (/api/v1/operational-task-templates, BE-10 delivery doc) but no documented route runs the recurring-operational-tasks job for a given date; OPERATIONAL_TASKS.md says JOB-06 is not complete.")]
    [Trait("TestCase", "ITC-BF02-004")]
    public void ITC_BF02_004()
    {
        // ITC-BF02-004 Test that a recurring task is generated by the schedule (JOB-06).
        // 1. Set a recurring task template for a Location. 2. Run the recurring-task job for a date. 3. Run it again.
        // Expected: One task is created per schedule slot and no duplicate appears on the second run.
    }

    [SkippableFact(DisplayName = "ITC-BF02-005 Test executing a task and submitting it for verification.")]
    [Trait("TestCase", "ITC-BF02-005")]
    public async Task ITC_BF02_005()
    {
        // Pre-condition: Task assigned to the Staff.
        var locationId = await _tasks.LocationWithStaffAsync();
        var task = await _tasks.CreateAsync(locationId, evidenceRequired: true);
        var taskId = TaskSetup.Id(task);
        var ownerNoticesBefore = await _tasks.CountTaskNotificationsAsync("owner", taskId);
        var historyCreated = (await _tasks.HistoryAsync(taskId)).Count;

        // 1. Sign in as Staff and open the assigned task.
        var staff = await sessions.TokenAsync("staff");
        var opened = await _tasks.GetAsync(taskId, staff);
        Assert.Equal("Assigned", opened.Str("status"));

        // 2. Start the task.
        var started = await _tasks.DoAsync("staff", opened, "start");
        var historyStarted = (await _tasks.HistoryAsync(taskId)).Count;

        // 3. Add a progress note and the required evidence.
        var progressNote = PlanData.Unique("Tiến độ BF02-005");
        var progressed = await _tasks.DoAsync("staff", started, "progress", progressNote);
        var upload = await _tasks.UploadEvidenceAsync(staff, taskId);
        await PlanAssert.SuccessAsync(upload, "step 3 upload evidence");
        var evidenceId = TaskSetup.Id(await upload.JsonAsync());
        var afterUpload = await _tasks.GetAsync(taskId, staff);

        // 4. Submit the result.
        var resultNote = PlanData.Unique("Kết quả BF02-005");
        var submitted = await _tasks.DoAsync("staff", afterUpload, "submit", resultNote, [evidenceId]);

        // Expected: The task changes Assigned -> In Progress -> Pending Verification.
        Assert.Equal("InProgress", started.Str("status"));
        Assert.Equal("InProgress", progressed.Str("status"));
        Assert.Equal("PendingVerification", submitted.Str("status"));

        // Expected: The evidence is stored privately (metadata without object key; no anonymous download).
        var evidenceList = await _api.GetAsync($"{TaskSetup.Base}/{taskId}/evidence", await sessions.TokenAsync("owner"));
        var evidenceBody = await PlanAssert.SuccessAsync(evidenceList, "Owner reads evidence metadata");
        Assert.Contains((await evidenceList.JsonAsync()).Items(), e => e.Str("id") == evidenceId);
        Assert.DoesNotContain("objectKey", evidenceBody, StringComparison.OrdinalIgnoreCase);
        await PlanAssert.StatusAsync(await _api.GetAsync($"{TaskSetup.Base}/{taskId}/evidence/{evidenceId}"), HttpStatusCode.Unauthorized, "anonymous evidence download");

        // Expected: The Owner is notified.
        Assert.True(await _tasks.CountTaskNotificationsAsync("owner", taskId) > ownerNoticesBefore, "The Owner got no task notification after the submission.");

        // Expected: Every step is kept in the history.
        var history = await _tasks.HistoryAsync(taskId);
        Assert.True(historyStarted > historyCreated, "The start step is not in the history.");
        Assert.True(TaskSetup.Mentions(history, progressNote), "The progress note is not in the history.");
        Assert.True(TaskSetup.Mentions(history, resultNote), "The submitted result is not in the history.");
    }

    [SkippableFact(DisplayName = "ITC-BF02-006 Test Owner verification and rework.")]
    [Trait("TestCase", "ITC-BF02-006")]
    public async Task ITC_BF02_006()
    {
        // Pre-condition: Two tasks in Pending Verification.
        var locationId = await _tasks.LocationWithStaffAsync();
        var toVerify = await _tasks.PendingVerificationAsync(locationId);
        var toRework = await _tasks.PendingVerificationAsync(locationId);
        var reworkId = TaskSetup.Id(toRework);
        var staffNoticesBefore = await _tasks.CountTaskNotificationsAsync("staff", reworkId);
        var owner = await sessions.SessionAsync("owner");

        // 1. Sign in as Owner and open a task that is Pending Verification.
        var opened = await _tasks.GetAsync(TaskSetup.Id(toVerify), owner.AccessToken);
        Assert.Equal("PendingVerification", opened.Str("status"));

        // 2. Verify it.
        var verify = await _tasks.ActAsync(owner.AccessToken, TaskSetup.Id(opened), "verify", TaskSetup.Version(opened));

        // 3. On another task, send it back with a rework reason.
        var reason = PlanData.Unique("Lý do làm lại BF02-006");
        var rework = await _tasks.ActAsync(owner.AccessToken, reworkId, "rework", TaskSetup.Version(toRework), reason);

        // Expected: The verified task is closed with the verifier and time.
        await PlanAssert.SuccessAsync(verify, "step 2 verify");
        var verified = await _tasks.GetAsync(TaskSetup.Id(opened));
        Assert.Equal("Completed", verified.Str("status"));
        Assert.Equal(owner.UserId, verified.Str("verifiedByUserId"), StringComparer.OrdinalIgnoreCase);
        Assert.False(string.IsNullOrEmpty(verified.Str("verifiedAt")), "verifiedAt is missing.");

        // Expected: The reworked task goes back to In Progress with the reason and the Staff is notified.
        await PlanAssert.SuccessAsync(rework, "step 3 rework");
        Assert.Equal("InProgress", (await _tasks.GetAsync(reworkId)).Str("status"));
        Assert.True(TaskSetup.Mentions(await _tasks.HistoryAsync(reworkId), reason), "The rework reason is not kept in the history.");
        Assert.True(await _tasks.CountTaskNotificationsAsync("staff", reworkId) > staffNoticesBefore, "The Staff got no notification for the rework.");
    }

    [SkippableFact(DisplayName = "ITC-BF02-007 Test a blocker and the Owner coordination.")]
    [Trait("TestCase", "ITC-BF02-007")]
    public async Task ITC_BF02_007()
    {
        // Pre-condition: Task In Progress.
        var locationId = await _tasks.LocationWithStaffAsync();
        var task = await _tasks.DoAsync("staff", await _tasks.CreateAsync(locationId, evidenceRequired: false), "start");

        // 1. Staff records a blocker on a running task.
        var blocker = PlanData.Unique("Vướng mắc BF02-007");
        var blocked = await _tasks.DoAsync("staff", task, "blockers", blocker);

        // 2. Owner reads the blocker and writes an instruction.
        Assert.True(TaskSetup.Mentions(await _tasks.HistoryAsync(TaskSetup.Id(task)), blocker), "The Owner cannot read the blocker in the history.");
        var instruction = PlanData.Unique("Hướng dẫn BF02-007");
        var coordinated = await _tasks.DoAsync("owner", await _tasks.GetAsync(TaskSetup.Id(task)), "coordinate", instruction);

        // 3. Staff continues the task.
        var continued = await _tasks.DoAsync("staff", await _tasks.GetAsync(TaskSetup.Id(task), await sessions.TokenAsync("staff")), "progress", "Tiếp tục xử lý sau hướng dẫn.");

        // Expected: The task stays In Progress. The blocker and the instruction are in the history.
        Assert.Equal("InProgress", blocked.Str("status"));
        Assert.Equal("InProgress", coordinated.Str("status"));
        Assert.Equal("InProgress", continued.Str("status"));
        var history = await _tasks.HistoryAsync(TaskSetup.Id(task));
        Assert.True(TaskSetup.Mentions(history, blocker), "The blocker is not in the history.");
        Assert.True(TaskSetup.Mentions(history, instruction), "The Owner instruction is not in the history.");
    }

    [SkippableFact(DisplayName = "ITC-BF02-008 Test an overdue task that is waiting for review.")]
    [Trait("TestCase", "ITC-BF02-008")]
    public async Task ITC_BF02_008()
    {
        // Pre-condition: Task Pending Verification past its deadline. The API refuses past deadlines, so the task gets a
        // deadline 45 seconds ahead and the test waits for it to pass (real time, no server clock change).
        var locationId = await _tasks.LocationWithStaffAsync();
        var dueAt = DateTimeOffset.UtcNow.AddSeconds(45);
        var task = await _tasks.PendingVerificationAsync(locationId, dueAt);

        // 1. Let the deadline pass after the Staff submitted the task.
        var wait = dueAt - DateTimeOffset.UtcNow + TimeSpan.FromSeconds(5);
        if (wait > TimeSpan.Zero)
        {
            await Task.Delay(wait);
        }

        var overdue = await _tasks.GetAsync(TaskSetup.Id(task));

        // 2. Two Owner decisions (verify and rework) arrive at the same time.
        var owner = await sessions.TokenAsync("owner");
        var decisions = await Task.WhenAll(
            _tasks.ActAsync(owner, TaskSetup.Id(task), "verify", TaskSetup.Version(overdue)),
            _tasks.ActAsync(owner, TaskSetup.Id(task), "rework", TaskSetup.Version(overdue), "Làm lại BF02-008"));

        // Expected: The task is shown as overdue and its state is not changed by that.
        Assert.Equal("true", overdue.Str("isOverdue"));
        Assert.Equal("PendingVerification", overdue.Str("status"));

        // Expected: Only one Owner decision is accepted.
        Assert.Equal(1, decisions.Count(r => r.IsSuccessStatusCode));
        await PlanAssert.RefusedAsync(decisions.Single(r => !r.IsSuccessStatusCode), "second Owner decision");
        var final = await _tasks.GetAsync(TaskSetup.Id(task));
        Assert.Equal(decisions[0].IsSuccessStatusCode ? "Completed" : "InProgress", final.Str("status"));
    }

    [SkippableFact(DisplayName = "ITC-BF02-009 Test that the Staff scope is checked on every request.")]
    [Trait("TestCase", "ITC-BF02-009")]
    public async Task ITC_BF02_009()
    {
        // Pre-condition: Staff assigned to L1 (a second Staff account "staff2" takes over).
        var newStaffUserId = await _tasks.Property.UserIdAsync("staff2");
        var l1 = await _tasks.LocationWithStaffAsync("staff");
        var task = await _tasks.CreateAsync(l1, evidenceRequired: false);
        var taskId = TaskSetup.Id(task);

        // 1. Staff opens a task in the assigned Location.
        var oldToken = await sessions.TokenAsync("staff");
        await PlanAssert.SuccessAsync(await _api.GetAsync($"{TaskSetup.Base}/{taskId}", oldToken), "step 1 old Staff opens the task");

        // 2. Owner replaces the responsible Staff (PUT /staff-location-assignments/{locationId}, Postman 215).
        var location = await _tasks.Property.ReadAsync($"api/v1/locations/{l1}");
        var replace = await _api.PutAsync(
            $"api/v1/staff-location-assignments/{l1}",
            new { staffUserId = newStaffUserId, effectiveFrom = PropertySetup.Day(0), locationVersion = PropertySetup.Version(location), reason = "Thay người phụ trách BF02-009" },
            await sessions.TokenAsync("owner"));
        await PlanAssert.SuccessAsync(replace, "step 2 Owner replaces the responsible Staff");

        // 3. The old Staff uses the old token again.
        var oldRead = await _api.GetAsync($"{TaskSetup.Base}/{taskId}", oldToken);
        var oldStart = await _tasks.ActAsync(oldToken, taskId, "start", TaskSetup.Version(await _tasks.GetAsync(taskId)));

        // 4. The new Staff opens the same Location tasks.
        var newTasks = await _tasks.TasksOfLocationAsync(l1, "staff2");

        // Expected: The old Staff is refused.
        await PlanAssert.RefusedAsync(oldRead, "step 3 old Staff reads the task");
        await PlanAssert.RefusedAsync(oldStart, "step 3 old Staff starts the task");

        // Expected: The new Staff continues the work of the Location.
        Assert.Contains(newTasks, t => t.Str("id") == taskId);
        var current = await _tasks.GetAsync(taskId);
        Assert.Equal(newStaffUserId, current.Str("currentResponsibleStaffUserId"), StringComparer.OrdinalIgnoreCase);
        var started = await _tasks.DoAsync("staff2", current, "start");
        Assert.Equal("InProgress", started.Str("status"));
    }
}
