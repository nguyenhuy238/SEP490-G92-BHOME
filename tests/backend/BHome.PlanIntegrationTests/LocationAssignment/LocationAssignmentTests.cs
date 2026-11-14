using System.Net;

namespace BHome.PlanIntegrationTests.LocationAssignment;

/// <summary>
/// Sheet "Location &amp; Assignment" (FE-01 / UC-04, UC-08, GBR-02). Expected results are copied from the plan;
/// routes/bodies the plan does not state come from docs/api and docs/development only.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "Location & Assignment")]
public sealed class LocationAssignmentTests(PlanSessions sessions)
{
    private const string OverlapMessage = "The Location already has a Staff assignment during this date range.";

    private readonly PlanApi _api = sessions.Api;

    // ---------------- Manage Locations (UC-04) ----------------

    [SkippableFact(DisplayName = "ITC-LOC-001 Test creating a Location as Owner.")]
    [Trait("TestCase", "ITC-LOC-001")]
    public async Task ITC_LOC_001()
    {
        // 1. Sign in as Owner.
        var owner = await sessions.TokenAsync("owner");

        // 2. Create a Location with the name "BHOME Tan Binh" (made unique so repeated runs can be told apart).
        var name = PlanData.Unique("BHOME Tan Binh");
        var response = await _api.PostAsync("api/v1/locations", new { name, address = "Tan Binh, TP.HCM", isActive = true }, owner);

        // The Location is created (201) and shows its id and name.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created);
        var json = await response.JsonAsync();
        Assert.False(string.IsNullOrEmpty(json.Str("id")), "The created Location has no id.");
        Assert.Equal(name, json.Str("name"));
    }

    [SkippableFact(DisplayName = "ITC-LOC-002 Test listing all Locations of the chain as Owner.")]
    [Trait("TestCase", "ITC-LOC-002")]
    public async Task ITC_LOC_002()
    {
        // Pre-condition: at least 1 Location exists.
        var owner = await sessions.TokenAsync("owner");
        var name = PlanData.Unique("IT LOC-002");
        var id = await LocationSteps.CreateLocationAsync(_api, owner, name);

        // 1. Sign in as Owner. 2. Open the Location list (filtered by the name so paging cannot hide it).
        var items = await LocationSteps.SearchLocationsAsync(_api, owner, name);

        // The list contains the Location that was created.
        Assert.Contains(items, i => LocationSteps.Mentions(i, id));
    }

    [SkippableFact(DisplayName = "ITC-LOC-003 Test a Location name that is too short.")]
    [Trait("TestCase", "ITC-LOC-003")]
    public async Task ITC_LOC_003()
    {
        var owner = await sessions.TokenAsync("owner");

        // 1. Create a Location with the name "A".
        var response = await _api.PostAsync("api/v1/locations", new { name = "A", address = "Dia chi kiem thu", isActive = true }, owner);

        // Rejected with a validation message (the name must have 2 to 200 characters).
        var body = await PlanAssert.RefusedAsync(response);
        Assert.True(LocationSteps.HasFieldError(body, "name"), $"Expected a validation message for the name. Body: {body}");
    }

    [SkippableFact(DisplayName = "ITC-LOC-004 Test managing Room Types, Rooms, Assets and pricing of a Location.")]
    [Trait("TestCase", "ITC-LOC-004")]
    public async Task ITC_LOC_004()
    {
        // Pre-condition: Location exists.
        var owner = await sessions.TokenAsync("owner");
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);

        // 1. Create a Room Type, a Room, an Asset and pricing for the Location.
        // The data is saved as described in UC-04 to UC-06.
        // Room Type: route/body from the Room Type section of docs/api/PROPERTY_MANAGEMENT.md (the plan names this step).
        var roomType = await _api.PostAsync(
            "api/v1/room-types",
            new { locationId, name = PlanData.Unique("Studio"), description = "Phong co ban cong", defaultCapacity = 2, areaM2 = 20.5m, amenities = new[] { "Ban cong" }, isActive = true },
            owner);
        await PlanAssert.SuccessAsync(roomType, "create Room Type");

        var room = await _api.PostAsync("api/v1/rooms", new { locationId, roomNumber = "P101", floor = "1", capacity = 2, status = 0 }, owner);
        await PlanAssert.SuccessAsync(room, "create Room");
        var roomId = (await room.JsonAsync()).Str("id");
        Assert.False(string.IsNullOrEmpty(roomId), "The created Room has no id.");

        var asset = await _api.PostAsync(
            "api/v1/assets",
            new { locationId, roomId, commonArea = (string?)null, code = "AC-01", name = "May lanh", category = "Dien lanh", condition = "Hoat dong binh thuong", status = 0 },
            owner);
        await PlanAssert.SuccessAsync(asset, "create Asset");

        var price = await _api.PostAsync(
            "api/v1/billing-policies",
            new
            {
                locationId,
                roomId = (string?)null,
                category = 0,
                chargeCode = "RENT",
                name = "Tien thue",
                method = 0,
                rate = 2500000,
                effectiveFrom = PlanData.Iso(PlanData.TodayVietnam.AddDays(1)),
                effectiveTo = (string?)null,
                reason = "Integration test pricing",
            },
            owner);
        await PlanAssert.SuccessAsync(price, "create pricing");

        // Saved data can be read back.
        var readRoom = await _api.GetAsync($"api/v1/rooms/{roomId}", owner);
        await PlanAssert.StatusAsync(readRoom, HttpStatusCode.OK, "read the saved Room");
    }

    // ---------------- Manage Staff Location Assignments (UC-08) ----------------

    [SkippableFact(DisplayName = "ITC-LOC-005 Test assigning a Staff member to a Location.")]
    [Trait("TestCase", "ITC-LOC-005")]
    public async Task ITC_LOC_005()
    {
        // Pre-condition: Location and Staff exist.
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);

        // 1. Sign in as Owner.
        var owner = await sessions.TokenAsync("owner");
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);

        // 2. Assign a Staff member to a Location with a start date and an end date.
        var start = PlanData.TodayVietnam.AddDays(60);
        var response = await LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, start, start.AddDays(10));

        // The assignment is created (201) and is shown.
        await PlanAssert.StatusAsync(response, HttpStatusCode.Created);
        var items = await LocationSteps.AssignmentsAsync(_api, owner, locationId);
        Assert.Contains(items, i => LocationSteps.Mentions(i, staffUserId));
    }

    [SkippableFact(DisplayName = "ITC-LOC-006 Test overlapping and adjacent assignments for the same Location.")]
    [Trait("TestCase", "ITC-LOC-006")]
    public async Task ITC_LOC_006()
    {
        // Pre-condition: Location exists. The plan's dates 01/11, 10/11, 11/11, 15/11 are kept as days of next month.
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);
        var today = PlanData.TodayVietnam;
        var month = new DateOnly(today.Year, today.Month, 1).AddMonths(1);

        // 1. Assign Staff A from 01/11 to 10/11.
        var first = await LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, month, month.AddDays(9));
        await PlanAssert.SuccessAsync(first, "step 1");

        // 2. Assign a second period from 10/11 to 15/11 (overlap).
        var overlap = await LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, month.AddDays(9), month.AddDays(14));

        // Step 2 is refused (409): "The Location already has a Staff assignment during this date range.".
        var body = await PlanAssert.StatusAsync(overlap, HttpStatusCode.Conflict, "step 2");
        PlanAssert.HasMessage(body, OverlapMessage, "step 2");

        // 3. Assign a third period from 11/11 to 15/11 (adjacent).
        var adjacent = await LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, month.AddDays(10), month.AddDays(14));

        // Step 3 works (201).
        await PlanAssert.StatusAsync(adjacent, HttpStatusCode.Created, "step 3");
    }

    [SkippableFact(DisplayName = "ITC-LOC-007 Test an end date that is before the start date.")]
    [Trait("TestCase", "ITC-LOC-007")]
    public async Task ITC_LOC_007()
    {
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);
        var start = PlanData.TodayVietnam.AddDays(60);

        // 1. Create an assignment where the end date is earlier than the start date.
        var response = await LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, start, start.AddDays(-30));

        // Rejected with a validation message on the end date.
        var body = await PlanAssert.RefusedAsync(response);
        Assert.True(LocationSteps.HasFieldError(body, "endDate"), $"Expected a validation message on the end date. Body: {body}");
    }

    [SkippableFact(DisplayName = "ITC-LOC-008 Test opening the assignments of a Location that does not exist.")]
    [Trait("TestCase", "ITC-LOC-008")]
    public async Task ITC_LOC_008()
    {
        var owner = await sessions.TokenAsync("owner");

        // 1. Open the assignments of a Location with a random id.
        var response = await _api.GetAsync($"api/v1/staff-location-assignments?locationId={Guid.NewGuid()}", owner);

        // Not found (404).
        await PlanAssert.StatusAsync(response, HttpStatusCode.NotFound);
    }

    [SkippableFact(DisplayName = "ITC-LOC-009 Test two identical assignment requests at the same time.")]
    [Trait("TestCase", "ITC-LOC-009")]
    public async Task ITC_LOC_009()
    {
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var locationId = await LocationSteps.CreateLocationAsync(_api, owner);
        var start = PlanData.TodayVietnam.AddDays(90);

        // 1. Send the same assignment request twice at the same time.
        var answers = await Task.WhenAll(
            LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, start, start.AddDays(5)),
            LocationSteps.AssignAsync(_api, owner, locationId, staffUserId, start, start.AddDays(5)));
        foreach (var answer in answers)
        {
            answer.Dispose();
        }

        // Only one assignment is saved.
        var items = await LocationSteps.AssignmentsAsync(_api, owner, locationId);
        Assert.Single(items);
    }

    [SkippableFact(DisplayName = "ITC-LOC-010 Test that a Staff member only sees the Locations currently assigned to them.")]
    [Trait("TestCase", "ITC-LOC-010")]
    public async Task ITC_LOC_010()
    {
        var owner = await sessions.TokenAsync("owner");
        var staffUserId = await LocationSteps.StaffUserIdAsync(sessions);
        var l1 = await LocationSteps.CreateLocationAsync(_api, owner);
        var l2 = await LocationSteps.CreateLocationAsync(_api, owner);
        var other = await LocationSteps.CreateLocationAsync(_api, owner);
        var today = PlanData.TodayVietnam;

        // 1. As Owner, assign the Staff to L1 (starting today) and to L2 (starting later).
        await LocationSteps.AssignOkAsync(_api, owner, l1, staffUserId, today, today.AddDays(30));
        await LocationSteps.AssignOkAsync(_api, owner, l2, staffUserId, today.AddDays(15), today.AddDays(45));

        // 2. Sign in as that Staff and open the assigned Locations.
        var response = await _api.GetAsync("api/v1/locations/assigned-to-me", await sessions.TokenAsync("staff"));

        // Only L1 is shown. L2 and other Locations are not shown.
        await PlanAssert.StatusAsync(response, HttpStatusCode.OK);
        var json = await response.JsonAsync();
        Assert.True(LocationSteps.Mentions(json, l1), "L1 (assigned from today) is not shown.");
        Assert.False(LocationSteps.Mentions(json, l2), "L2 (assigned from a later date) must not be shown.");
        Assert.False(LocationSteps.Mentions(json, other), "A Location that is not assigned must not be shown.");
    }
}
