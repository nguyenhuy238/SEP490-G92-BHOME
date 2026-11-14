using System.Globalization;
using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF01LocationSetup;

/// <summary>
/// Builds BF-01 preconditions through documented routes only:
/// docs/api/LOCATION_ROOM_API.md, PROPERTY_MANAGEMENT.md, development/STAFF_LOCATION_ASSIGNMENTS.md and the
/// Postman collection BHome.Simple (requests 26, 28, 42, 45, 52-63). Every test creates its own Location.
/// </summary>
internal sealed class PropertySetup(PlanSessions sessions)
{
    public PlanApi Api => sessions.Api;

    public Task<string> OwnerAsync() => sessions.TokenAsync("owner");

    public static string Day(int offsetFromTodayVietnam) => PlanData.Iso(PlanData.TodayVietnam.AddDays(offsetFromTodayVietnam));

    public static string Id(JsonElement json) => json.Str("id") ?? throw new InvalidOperationException("Answer has no id: " + json.GetRawText());

    public static int Version(JsonElement json) => int.Parse(json.Str("version") ?? throw new InvalidOperationException("Answer has no version: " + json.GetRawText()), CultureInfo.InvariantCulture);

    public static decimal Dec(string? value) => decimal.Parse(value ?? throw new InvalidOperationException("Missing decimal value."), NumberStyles.Number, CultureInfo.InvariantCulture);

    /// <summary>Room status per PROPERTY_MANAGEMENT.md: Available=0, OnHold=1, Occupied=2, Unavailable=3 (number or name).</summary>
    public static bool IsRoomStatus(JsonElement room, int number, string name)
        => room.Str("status") is { } s && (s == number.ToString(CultureInfo.InvariantCulture) || string.Equals(s, name, StringComparison.OrdinalIgnoreCase));

    public async Task<JsonElement> ReadAsync(string path, string? token = null)
    {
        var response = await Api.GetAsync(path, token ?? await OwnerAsync());
        await PlanAssert.SuccessAsync(response, "GET " + path);
        return await response.JsonAsync();
    }

    public async Task<JsonElement> CreateLocationAsync(string? name = null)
    {
        var response = await Api.PostAsync(
            "api/v1/locations",
            new { name = name ?? PlanData.Unique("BF Location"), address = "Địa chỉ giả lập kiểm thử tích hợp", isActive = true },
            await OwnerAsync());
        await PlanAssert.SuccessAsync(response, "Precondition: Owner creates a Location");
        return await response.JsonAsync();
    }

    public async Task<HttpResponseMessage> PostRoomAsync(string locationId, string roomNumber, int capacity = 2, int status = 0, string? token = null)
        => await Api.PostAsync("api/v1/rooms", new { locationId, roomNumber, floor = "1", capacity, status }, token ?? await OwnerAsync());

    public async Task<JsonElement> CreateRoomAsync(string locationId, string? roomNumber = null)
    {
        var response = await PostRoomAsync(locationId, roomNumber ?? NewRoomNumber());
        await PlanAssert.SuccessAsync(response, "Precondition: Owner creates a Room");
        return await response.JsonAsync();
    }

    /// <summary>PUT /rooms/{id} with the current fields of <paramref name="room"/> and a new status (Postman 45/69/77).</summary>
    public async Task<HttpResponseMessage> PutRoomStatusAsync(JsonElement room, int status, string? token = null)
        => await Api.PutAsync(
            $"api/v1/rooms/{Id(room)}",
            new
            {
                locationId = room.Str("locationId"),
                roomNumber = room.Str("roomNumber"),
                floor = room.Str("floor"),
                capacity = int.Parse(room.Str("capacity") ?? "1", CultureInfo.InvariantCulture),
                status,
                version = Version(room),
                reason = "Kiểm thử tích hợp BF-01",
            },
            token ?? await OwnerAsync());

    public async Task<HttpResponseMessage> PutLocationAsync(JsonElement location, bool isActive, string? token = null)
        => await Api.PutAsync(
            $"api/v1/locations/{Id(location)}",
            new { name = location.Str("name"), address = location.Str("address"), isActive, version = Version(location), reason = "Kiểm thử tích hợp BF-01" },
            token ?? await OwnerAsync());

    /// <summary>POST /staff-location-assignments (STAFF_LOCATION_ASSIGNMENTS.md; Postman 28). Dates are inclusive Vietnam dates.</summary>
    public async Task<string> AssignStaffAsync(string locationId, string staffAccount = "staff", int startOffset = 0, int endOffset = 60)
    {
        var staffUserId = await UserIdAsync(staffAccount);
        var response = await Api.PostAsync(
            "api/v1/staff-location-assignments",
            new { locationId, staffUserId, startDate = Day(startOffset), endDate = Day(endOffset) },
            await OwnerAsync());
        await PlanAssert.SuccessAsync(response, $"Precondition: assign '{staffAccount}' to the Location");
        return staffUserId;
    }

    public async Task<string> UserIdAsync(string account)
    {
        var session = await sessions.SessionAsync(account);
        return session.UserId ?? throw new InvalidOperationException($"Login answer of '{account}' has no userId.");
    }

    /// <summary>PolicyWrite (LOCATION_ROOM_API.md; PROPERTY_MANAGEMENT.md table Category/ChargeCode/Method).</summary>
    public static object Policy(string locationId, string? roomId, int category, string chargeCode, string name, int method, decimal rate, string effectiveFrom, string? effectiveTo = null)
        => new { locationId, roomId, category, chargeCode, name, method, rate, effectiveFrom, effectiveTo, reason = "Kiểm thử tích hợp BF-01" };

    public async Task<HttpResponseMessage> PostPolicyAsync(object policy)
        => await Api.PostAsync("api/v1/billing-policies", policy, await OwnerAsync());

    public async Task<JsonElement> CreatePolicyAsync(object policy, string step)
    {
        var response = await PostPolicyAsync(policy);
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created, step);
        return await response.JsonAsync();
    }

    public async Task<IReadOnlyList<JsonElement>> PoliciesOfAsync(string locationId)
        => (await ReadAsync($"api/v1/billing-policies?locationId={locationId}&page=1&pageSize=100")).Items();

    public async Task<IReadOnlyList<JsonElement>> RoomsOfAsync(string locationId, string? token = null)
        => (await ReadAsync($"api/v1/rooms?locationId={locationId}&page=1&pageSize=100", token)).Items();

    // ---- Room Types: PROPERTY_MANAGEMENT.md (payload) + API_RUNTIME_ROUTES.md (routes). LOCATION_ROOM_API.md says they were removed. ----

    public async Task<HttpResponseMessage> PostRoomTypeAsync(string locationId, string name)
        => await Api.PostAsync(
            "api/v1/room-types",
            new { locationId, name, description = "Loại phòng kiểm thử", defaultCapacity = 2, areaM2 = 20.5m, amenities = new[] { "Ban công" }, isActive = true },
            await OwnerAsync());

    /// <summary>
    /// Fails with a clear message when the Room Type routes are gone: docs/api/LOCATION_ROOM_API.md (04/11/2026) says
    /// "/room-types đã bỏ" while API_RUNTIME_ROUTES.md (06/11/2026) still lists them. The plan step cannot be run then.
    /// </summary>
    public static async Task RequireRoomTypeRouteAsync(HttpResponseMessage response, string step)
    {
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed)
        {
            var body = await response.TextAsync();
            Assert.Fail(
                $"{step}: the API answered {(int)response.StatusCode} for /api/v1/room-types. docs/api/LOCATION_ROOM_API.md (04/11/2026) " +
                "states Room Types were removed (Room belongs directly to Location, no roomTypeId), so this plan step cannot be executed. " +
                $"Update the plan (SRS UC-04 Room Type steps) to the current model. Body: {body}");
        }
    }

    public static string NewRoomNumber() => "IT-" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
}
