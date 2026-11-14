using System.Net;
using System.Text.Json;
using BHome.PlanIntegrationTests.BF01LocationSetup;

namespace BHome.PlanIntegrationTests.BF02StaffTasks;

/// <summary>
/// Operational Task helpers from docs/api/OPERATIONAL_TASKS.md and Postman BHome.Simple 81-118:
/// every POST/PUT sends an Idempotency-Key and the current task version.
/// </summary>
internal sealed class TaskSetup(PlanSessions sessions)
{
    public const string Base = "api/v1/operational-tasks";

    public PropertySetup Property { get; } = new(sessions);

    public PlanApi Api => sessions.Api;

    public Task<string> TokenAsync(string account) => sessions.TokenAsync(account);

    public static int Version(JsonElement task) => PropertySetup.Version(task);

    public static string Id(JsonElement task) => PropertySetup.Id(task);

    /// <summary>A new Location with <paramref name="staffAccount"/> assigned from today for 60 days.</summary>
    public async Task<string> LocationWithStaffAsync(string staffAccount = "staff")
    {
        var locationId = PropertySetup.Id(await Property.CreateLocationAsync());
        await Property.AssignStaffAsync(locationId, staffAccount);
        return locationId;
    }

    public static object Work(string title, bool evidenceRequired = true, DateTimeOffset? dueAt = null, string priority = "Normal") => new
    {
        title,
        requirements = "Kiểm tra khu vực chung và ghi nhận kết quả (kiểm thử tích hợp).",
        priority,
        dueAt = (dueAt ?? DateTimeOffset.UtcNow.AddDays(2)).ToString("yyyy-MM-ddTHH:mm:ssK"),
        evidenceRequired,
    };

    public async Task<HttpResponseMessage> PostCreateAsync(string locationId, object work, string? idempotencyKey = null, string? token = null)
        => await Api.PostAsync(Base, new { locationId, work }, token ?? await TokenAsync("owner"), PlanData.IdempotencyKey(idempotencyKey));

    public async Task<JsonElement> CreateAsync(string locationId, bool evidenceRequired = true, DateTimeOffset? dueAt = null, string? title = null)
    {
        var response = await PostCreateAsync(locationId, Work(title ?? PlanData.Unique("BF02 task"), evidenceRequired, dueAt));
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created, "Precondition: Owner creates a task");
        return await response.JsonAsync();
    }

    public async Task<JsonElement> GetAsync(string taskId, string? token = null)
    {
        var response = await Api.GetAsync($"{Base}/{taskId}", token ?? await TokenAsync("owner"));
        await PlanAssert.SuccessAsync(response, "GET task " + taskId);
        return await response.JsonAsync();
    }

    /// <summary>POST /{id}/{action} with TaskAction { version, note?, evidenceIds? }.</summary>
    public async Task<HttpResponseMessage> ActAsync(string token, string taskId, string action, int version, string? note = null, string[]? evidenceIds = null)
    {
        object body = (note, evidenceIds) switch
        {
            (null, null) => new { version },
            (_, null) => new { version, note },
            _ => new { version, note, evidenceIds },
        };
        return await Api.PostAsync($"{Base}/{taskId}/{action}", body, token, PlanData.IdempotencyKey());
    }

    /// <summary>Runs an action that must succeed and returns the new TaskView.</summary>
    public async Task<JsonElement> DoAsync(string account, JsonElement task, string action, string? note = null, string[]? evidenceIds = null)
    {
        var response = await ActAsync(await TokenAsync(account), Id(task), action, Version(task), note, evidenceIds);
        await PlanAssert.SuccessAsync(response, $"{account} {action}");
        return await response.JsonAsync();
    }

    public async Task<HttpResponseMessage> UploadEvidenceAsync(string token, string taskId)
        => await Api.SendBytesAsync(HttpMethod.Put, $"{Base}/{taskId}/evidence", PlanData.TinyPng, "image/png", token, PlanData.IdempotencyKey());

    /// <summary>Precondition helper: a task without required evidence brought to Pending Verification by the Staff.</summary>
    public async Task<JsonElement> PendingVerificationAsync(string locationId, DateTimeOffset? dueAt = null)
    {
        var task = await CreateAsync(locationId, evidenceRequired: false, dueAt: dueAt);
        task = await DoAsync("staff", task, "start");
        return await DoAsync("staff", task, "submit", "Kết quả kiểm thử: đã hoàn thành.", []);
    }

    public async Task<IReadOnlyList<JsonElement>> HistoryAsync(string taskId)
    {
        var response = await Api.GetAsync($"{Base}/{taskId}/history?page=1&pageSize=100", await TokenAsync("owner"));
        await PlanAssert.SuccessAsync(response, "GET task history");
        return (await response.JsonAsync()).Items();
    }

    public static bool Mentions(IEnumerable<JsonElement> items, string text)
        => items.SelectMany(i => i.AllStrings()).Any(s => s.Contains(text, StringComparison.Ordinal));

    /// <summary>Task notifications of the signed-in account for one task (GET /operational-tasks/notifications, items[].taskId).</summary>
    public async Task<int> CountTaskNotificationsAsync(string account, string taskId)
    {
        var token = await TokenAsync(account);
        var count = 0;
        for (var page = 1; page <= 20; page++)
        {
            var response = await Api.GetAsync($"{Base}/notifications?page={page}&pageSize=100", token);
            await PlanAssert.SuccessAsync(response, $"{account} reads task notifications");
            var items = (await response.JsonAsync()).Items();
            count += items.Count(n => string.Equals(n.Str("taskId"), taskId, StringComparison.OrdinalIgnoreCase));
            if (items.Count < 100)
            {
                break;
            }
        }

        return count;
    }

    public async Task<IReadOnlyList<JsonElement>> TasksOfLocationAsync(string locationId, string account = "owner")
    {
        var response = await Api.GetAsync($"{Base}?locationId={locationId}&page=1&pageSize=100", await TokenAsync(account));
        await PlanAssert.SuccessAsync(response, $"{account} lists tasks of the Location");
        return (await response.JsonAsync()).Items();
    }
}
