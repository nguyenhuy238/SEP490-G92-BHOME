using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF07Incident;

/// <summary>A Location built by the Owner for one test: Room + Asset, optionally a Staff assigned for today.</summary>
internal sealed record Site(string LocationId, string RoomId, string AssetId, string? StaffId);

/// <summary>Where a Tenant may report (read from GET /incidents/reporting-rooms and /reporting-assets).</summary>
internal sealed record TenantPlace(string LocationId, string RoomId, string? AssetId);

/// <summary>
/// Data builders and readers for sheet BF-07, using only the routes of docs/api/INCIDENT_MAINTENANCE.md,
/// LOCATION_ROOM_API.md, STAFF_LOCATION_ASSIGNMENTS.md and the Postman collection "BHome.Simple" (requests 26–49, 119–181).
/// </summary>
internal sealed class IncidentFlow(PlanSessions sessions)
{
    public PlanApi Api => sessions.Api;

    public Task<string> TokenAsync(string account) => sessions.TokenAsync(account);

    public async Task<string> UserIdAsync(string account)
    {
        var id = (await sessions.SessionAsync(account)).UserId;
        Assert.False(string.IsNullOrEmpty(id), $"The login answer of '{account}' has no userId.");
        return id!;
    }

    public static string Today => PlanData.Iso(PlanData.TodayVietnam);

    public static string FutureOffset(int days)
        => DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7)).AddDays(days).ToString("yyyy-MM-dd'T'HH:mm:sszzz");

    // ---------- preconditions ----------

    /// <summary>Owner creates Location → (Staff assignment for today) → Room → Asset in the Room.</summary>
    public async Task<Site> CreateSiteAsync(string? staffAccount = "staff")
    {
        var owner = await TokenAsync("owner");
        var location = await OkJsonAsync(
            await Api.PostAsync("api/v1/locations", new { name = PlanData.Unique("BF07 Location"), address = "Địa chỉ giả lập kiểm thử BF-07", isActive = true }, owner),
            "precondition: create Location");
        var locationId = Id(location, "id");

        string? staffId = null;
        if (staffAccount is not null)
        {
            staffId = await UserIdAsync(staffAccount);
            await OkJsonAsync(
                await Api.PostAsync(
                    "api/v1/staff-location-assignments",
                    new { locationId, staffUserId = staffId, startDate = Today, endDate = PlanData.Iso(PlanData.TodayVietnam.AddDays(30)) },
                    owner),
                "precondition: assign Staff to the Location");
        }

        var suffix = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
        var room = await OkJsonAsync(
            await Api.PostAsync("api/v1/rooms", new { locationId, roomNumber = "IT-" + suffix, floor = "1", capacity = 2, status = 0 }, owner),
            "precondition: create Room");
        var roomId = Id(room, "id");
        var asset = await OkJsonAsync(
            await Api.PostAsync(
                "api/v1/assets",
                new { locationId, roomId, commonArea = (string?)null, code = "AC-" + suffix, name = "Máy lạnh test BF-07", category = "Điện lạnh", condition = "Hoạt động bình thường", status = 0 },
                owner),
            "precondition: create Asset");
        return new Site(locationId, roomId, Id(asset, "id"), staffId);
    }

    /// <summary>The Room (and an Asset in it, when any) where this Tenant may report, i.e. the Room of the active contract.</summary>
    public async Task<TenantPlace> TenantPlaceAsync(string tenantAccount, bool needAsset)
    {
        var token = await TokenAsync(tenantAccount);
        var rooms = await OkJsonAsync(await Api.GetAsync("api/v1/incidents/reporting-rooms?page=1&pageSize=100", token), $"precondition: reporting rooms of '{tenantAccount}'");
        var room = rooms.Items().FirstOrDefault();
        Skip.If(
            room.ValueKind != JsonValueKind.Object,
            $"Precondition: account '{tenantAccount}' has no Room to report from. Give this Tenant an Active Contract in a Room (Contract.TenantUserId = this account), then run again.");
        var place = new TenantPlace(Id(room, "locationId"), Id(room, "roomId"), null);

        var assets = await OkJsonAsync(
            await Api.GetAsync($"api/v1/incidents/reporting-assets?locationId={place.LocationId}&roomId={place.RoomId}&page=1&pageSize=100", token),
            $"precondition: reporting assets of '{tenantAccount}'");
        var asset = assets.Items().FirstOrDefault(a => a.Str("roomId") == place.RoomId);
        Skip.If(
            needAsset && asset.ValueKind != JsonValueKind.Object,
            $"Precondition: the Room {place.RoomId} of '{tenantAccount}' has no Asset. Owner adds an Asset to that Room (POST /api/v1/assets), then run again.");
        return asset.ValueKind == JsonValueKind.Object ? place with { AssetId = asset.Str("assetId") } : place;
    }

    /// <summary>Makes sure the Staff account is assigned today to the Location (creates the assignment when the Location has none).</summary>
    public async Task<string> EnsureStaffAssignedAsync(string locationId, string staffAccount = "staff")
    {
        var staffId = await UserIdAsync(staffAccount);
        if (await IsAssignedAsync(locationId, staffAccount))
        {
            return staffId;
        }

        using var assign = await Api.PostAsync(
            "api/v1/staff-location-assignments",
            new { locationId, staffUserId = staffId, startDate = Today, endDate = PlanData.Iso(PlanData.TodayVietnam.AddDays(30)) },
            await TokenAsync("owner"));
        Skip.If(
            !assign.IsSuccessStatusCode || !await IsAssignedAsync(locationId, staffAccount),
            $"Precondition: Staff '{staffAccount}' must be assigned today to the Tenant's Location {locationId}, but another Staff covers it (HTTP {(int)assign.StatusCode}). Assign '{staffAccount}' to that Location, then run again.");
        return staffId;
    }

    private async Task<bool> IsAssignedAsync(string locationId, string staffAccount)
    {
        using var mine = await Api.GetAsync("api/v1/locations/assigned-to-me", await TokenAsync(staffAccount));
        var text = await mine.TextAsync();
        return mine.IsSuccessStatusCode && text.Contains(locationId, StringComparison.OrdinalIgnoreCase);
    }

    // ---------- incident commands ----------

    /// <summary>POST /incidents multipart: locationId, roomId, assetId?, severity, description, images (PNG).</summary>
    public Task<HttpResponseMessage> SubmitAsync(string token, IReadOnlyDictionary<string, string?> fields, params byte[][] images)
        => Api.SendAsync(HttpMethod.Post, "api/v1/incidents", null, token, PlanData.IdempotencyKey(), () =>
        {
            var form = new MultipartFormDataContent();
            foreach (var (name, value) in fields.Where(f => f.Value is not null))
            {
                form.Add(new StringContent(value!, Encoding.UTF8), name);
            }

            for (var i = 0; i < images.Length; i++)
            {
                var file = new ByteArrayContent(images[i]);
                file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                form.Add(file, "images", $"photo{i + 1}.png");
            }

            return form;
        });

    public static Dictionary<string, string?> Fields(string locationId, string roomId, string? assetId, string severity, string? description = null)
        => new()
        {
            ["locationId"] = locationId,
            ["roomId"] = roomId,
            ["assetId"] = assetId,
            ["severity"] = severity,
            ["description"] = description ?? "Sự cố giả lập để kiểm thử tích hợp BF-07",
        };

    public async Task<string> SubmitOkAsync(string account, string locationId, string roomId, string? assetId, string severity, params byte[][] images)
    {
        var response = await SubmitAsync(await TokenAsync(account), Fields(locationId, roomId, assetId, severity), images);
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created, $"submit {severity} report as {account}");
        return Id(await response.JsonAsync(), "incidentId");
    }

    public Task<string> StaffReportAsync(Site site, string severity = "Normal")
        => SubmitOkAsync("staff", site.LocationId, site.RoomId, site.AssetId, severity);

    /// <summary>POST with a new Idempotency-Key (docs: every business POST/PUT needs one).</summary>
    public async Task<HttpResponseMessage> CommandAsync(string path, object body, string account)
        => await Api.PostAsync(path, body, await TokenAsync(account), PlanData.IdempotencyKey());

    public async Task<JsonElement> CommandOkAsync(string path, object body, string account, string step)
        => await OkJsonAsync(await CommandAsync(path, body, account), step);

    public async Task<JsonElement> IncidentAsync(string incidentId, string account = "owner")
        => await OkJsonAsync(await Api.GetAsync($"api/v1/incidents/{incidentId}", await TokenAsync(account)), "read the report");

    public async Task<JsonElement> WorkOrderAsync(string workOrderId, string account = "owner")
        => await OkJsonAsync(await Api.GetAsync($"api/v1/work-orders/{workOrderId}", await TokenAsync(account)), "read the Work Order");

    public async Task<long> IncidentVersionAsync(string incidentId) => Version(await IncidentAsync(incidentId));

    public async Task<long> WorkOrderVersionAsync(string workOrderId) => Version(await WorkOrderAsync(workOrderId));

    /// <summary>PUT /incidents/{id}/evidence raw PNG; returns the evidence id (resourceId).</summary>
    public async Task<string> UploadAsync(string account, string incidentId, string kind, string? workOrderId = null)
    {
        var path = $"api/v1/incidents/{incidentId}/evidence?kind={kind}" + (workOrderId is null ? string.Empty : $"&workOrderId={workOrderId}");
        var response = await Api.SendBytesAsync(HttpMethod.Put, path, PlanData.TinyPng, "image/png", await TokenAsync(account), PlanData.IdempotencyKey());
        return Id(await OkJsonAsync(response, $"upload {kind} photo"), "resourceId");
    }

    public async Task ReviewAsync(string incidentId)
        => await CommandOkAsync(
            $"api/v1/incidents/{incidentId}/review",
            new { version = await IncidentVersionAsync(incidentId), type = "Technical", category = "Water" },
            "owner",
            "Owner confirms type and category");

    public async Task<string> AssignAsync(string incidentId, string staffId)
    {
        var response = await CommandAsync(
            $"api/v1/incidents/{incidentId}/work-orders",
            new { version = await IncidentVersionAsync(incidentId), staffId, expectedOutcome = "Khắc phục sự cố kiểm thử", targetCompletionAt = FutureOffset(7) },
            "owner");
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created, "Owner creates a Work Order");
        return Id(await response.JsonAsync(), "workOrderId");
    }

    /// <summary>Assigned → proposal → plan approved → start (the Work Order is In Progress).</summary>
    public async Task<string> ToInProgressAsync(string incidentId, string staffId, string staffAccount = "staff")
    {
        var wo = await AssignAsync(incidentId, staffId);
        var inspection = await UploadAsync(staffAccount, incidentId, "Inspection", wo);
        await CommandOkAsync(
            $"api/v1/work-orders/{wo}/proposal",
            new { version = await WorkOrderVersionAsync(wo), inspectionResult = "Kết quả kiểm tra giả lập", solution = "Phương án giả lập", estimatedMinutes = 60, estimatedCost = 200000, evidenceIds = new[] { inspection } },
            staffAccount,
            "Staff submits the proposal");
        await CommandOkAsync($"api/v1/work-orders/{wo}/plan-decision", new { version = await WorkOrderVersionAsync(wo), approve = true }, "owner", "Owner approves the plan");
        await CommandOkAsync($"api/v1/work-orders/{wo}/start", new { version = await WorkOrderVersionAsync(wo) }, staffAccount, "Staff starts the work");
        return wo;
    }

    /// <summary>Uploads a Completion photo and submits the result (the Work Order becomes Pending Verification).</summary>
    public async Task SubmitCompletionAsync(string incidentId, string wo, string staffAccount = "staff")
    {
        var photo = await UploadAsync(staffAccount, incidentId, "Completion", wo);
        await CommandOkAsync(
            $"api/v1/work-orders/{wo}/submit",
            new { version = await WorkOrderVersionAsync(wo), note = "Kết quả hoàn tất giả lập", evidenceIds = new[] { photo } },
            staffAccount,
            "Staff submits the completion");
    }

    /// <summary>Normal Staff report on a new Site, reviewed, with a Work Order in Pending Verification.</summary>
    public async Task<(Site Site, string IncidentId, string WorkOrderId)> PendingVerificationAsync()
    {
        var site = await CreateSiteAsync();
        var incident = await StaffReportAsync(site);
        await ReviewAsync(incident);
        var wo = await ToInProgressAsync(incident, site.StaffId!);
        await SubmitCompletionAsync(incident, wo);
        return (site, incident, wo);
    }

    // ---------- readers ----------

    /// <summary>Items of GET /incidents/notifications that are linked to the report.</summary>
    public async Task<int> NotificationCountAsync(string account, string incidentId)
    {
        var inbox = await OkJsonAsync(await Api.GetAsync("api/v1/incidents/notifications?page=1&pageSize=100", await TokenAsync(account)), $"read the incident notifications of {account}");
        return inbox.Items().Count(n => string.Equals(n.Str("incidentId"), incidentId, StringComparison.OrdinalIgnoreCase));
    }

    public async Task<IReadOnlyList<JsonElement>> HistoryAsync(string incidentId, string account = "owner")
        => (await OkJsonAsync(await Api.GetAsync($"api/v1/incidents/{incidentId}/history?page=1&pageSize=100", await TokenAsync(account)), "read the report history")).Items();

    public async Task<IReadOnlyList<JsonElement>> ExpensesAsync(string incidentId)
        => (await OkJsonAsync(await Api.GetAsync($"api/v1/incidents/{incidentId}/expenses", await TokenAsync("owner")), "read the expenses of the report")).Items();

    public async Task<int> IncidentTotalAsync(string account)
    {
        var page = await OkJsonAsync(await Api.GetAsync("api/v1/incidents?page=1&pageSize=1", await TokenAsync(account)), $"list the reports of {account}");
        return int.Parse(page.Str("totalCount") ?? "0");
    }

    /// <summary>Asset status as a name; docs: JSON AssetStatus 0 Active, 1 NeedsRepair, 2 UnderRepair, 3 Retired.</summary>
    public async Task<string?> AssetStatusAsync(string assetId)
    {
        var asset = await OkJsonAsync(await Api.GetAsync($"api/v1/assets/{assetId}", await TokenAsync("owner")), "read the Asset");
        var status = asset.Str("status");
        return status switch { "0" => "Active", "1" => "NeedsRepair", "2" => "UnderRepair", "3" => "Retired", _ => status };
    }

    // ---------- small helpers ----------

    /// <summary>Plan state names ("In Progress", "Pending Approval") against API values ("InProgress", "PENDING_APPROVAL").</summary>
    public static bool SameState(string? actual, string planState) => Normalize(actual) == Normalize(planState);

    public static void AssertState(JsonElement resource, string planState, string what)
    {
        var actual = resource.Str("status");
        Assert.True(SameState(actual, planState), $"{what}: expected status \"{planState}\" but the API answered \"{actual}\".");
    }

    public static long Version(JsonElement resource)
        => long.Parse(resource.Str("version") ?? throw new InvalidOperationException("The answer has no version: " + resource.GetRawText()));

    public static string Id(JsonElement json, string field)
    {
        var value = json.Str(field);
        Assert.False(string.IsNullOrEmpty(value), $"The answer has no \"{field}\": {json.GetRawText()}");
        return value!;
    }

    public static async Task<JsonElement> OkJsonAsync(HttpResponseMessage response, string step)
    {
        var body = await PlanAssert.SuccessAsync(response, step);
        if (string.IsNullOrWhiteSpace(body))
        {
            return JsonDocument.Parse("{}").RootElement.Clone();
        }

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static string Normalize(string? value)
        => (value ?? string.Empty).Replace(" ", string.Empty).Replace("_", string.Empty).Replace("-", string.Empty).ToUpperInvariant();
}
