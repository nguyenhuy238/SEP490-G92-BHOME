using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.LocationAssignment;

/// <summary>
/// Precondition steps shared by the "Location &amp; Assignment" and "SecurityTest" sheets.
/// Routes and bodies come from docs/api/LOCATION_ROOM_API.md and docs/development/STAFF_LOCATION_ASSIGNMENTS.md.
/// </summary>
internal static class LocationSteps
{
    /// <summary>POST /api/v1/locations as Owner; returns the new Location id (the precondition must succeed).</summary>
    public static async Task<string> CreateLocationAsync(PlanApi api, string ownerToken, string? name = null)
    {
        name ??= PlanData.Unique("IT Location");
        using var response = await api.PostAsync("api/v1/locations", new { name, address = "Dia chi kiem thu tich hop", isActive = true }, ownerToken);
        await PlanAssert.SuccessAsync(response, $"precondition: create Location \"{name}\"");
        return (await response.JsonAsync()).Str("id") ?? throw new InvalidOperationException("Location answer has no id.");
    }

    /// <summary>POST /api/v1/rooms as Owner (docs/api/LOCATION_ROOM_API.md body); returns the new Room id.</summary>
    public static async Task<string> CreateRoomAsync(PlanApi api, string ownerToken, string locationId, string roomNumber)
    {
        using var response = await api.PostAsync("api/v1/rooms", new { locationId, roomNumber, floor = "2", capacity = 2, status = 0 }, ownerToken);
        await PlanAssert.SuccessAsync(response, $"precondition: create Room {roomNumber}");
        return (await response.JsonAsync()).Str("id") ?? throw new InvalidOperationException("Room answer has no id.");
    }

    public static Task<HttpResponseMessage> AssignAsync(PlanApi api, string ownerToken, string locationId, string staffUserId, DateOnly start, DateOnly end)
        => api.PostAsync(
            "api/v1/staff-location-assignments",
            new { locationId, staffUserId, startDate = PlanData.Iso(start), endDate = PlanData.Iso(end) },
            ownerToken);

    /// <summary>Assignment that must succeed because it is only a precondition.</summary>
    public static async Task AssignOkAsync(PlanApi api, string ownerToken, string locationId, string staffUserId, DateOnly start, DateOnly end)
    {
        using var response = await AssignAsync(api, ownerToken, locationId, staffUserId, start, end);
        await PlanAssert.SuccessAsync(response, $"precondition: assign Staff to Location {locationId} from {PlanData.Iso(start)} to {PlanData.Iso(end)}");
    }

    /// <summary>GET /api/v1/staff-location-assignments?locationId= as Owner; returns the assignment items.</summary>
    public static async Task<IReadOnlyList<JsonElement>> AssignmentsAsync(PlanApi api, string ownerToken, string locationId)
    {
        using var response = await api.GetAsync($"api/v1/staff-location-assignments?locationId={locationId}", ownerToken);
        await PlanAssert.StatusAsync(response, HttpStatusCode.OK, "read assignment history");
        return (await response.JsonAsync()).Items();
    }

    /// <summary>Owner search on the Location list (docs: search by name, paged envelope with totalCount).</summary>
    public static async Task<IReadOnlyList<JsonElement>> SearchLocationsAsync(PlanApi api, string ownerToken, string name)
    {
        using var response = await api.GetAsync($"api/v1/locations?search={Uri.EscapeDataString(name)}&pageSize=100", ownerToken);
        await PlanAssert.StatusAsync(response, HttpStatusCode.OK, "Owner reads the Location list");
        return (await response.JsonAsync()).Items();
    }

    public static async Task<string> StaffUserIdAsync(PlanSessions sessions, string account = "staff")
        => (await sessions.SessionAsync(account)).UserId ?? throw new InvalidOperationException($"Login answer of '{account}' has no userId.");

    /// <summary>True when any string value in the JSON equals the id (DTO field names are not assumed).</summary>
    public static bool Mentions(JsonElement json, string id)
        => json.AllStrings().Any(s => string.Equals(s, id, StringComparison.OrdinalIgnoreCase));

    /// <summary>True when a ValidationProblemDetails body has an error entry for the field (case-insensitive).</summary>
    public static bool HasFieldError(string body, string field)
    {
        JsonElement? errors;
        try
        {
            using var doc = JsonDocument.Parse(body);
            errors = doc.RootElement.Clone().Find("errors");
        }
        catch (JsonException)
        {
            return false;
        }

        return errors is { ValueKind: JsonValueKind.Object }
            && errors.Value.EnumerateObject().Any(p => p.Name.Replace("$.", string.Empty).Equals(field, StringComparison.OrdinalIgnoreCase));
    }
}
