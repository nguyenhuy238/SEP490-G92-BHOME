using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF01LocationSetup;

/// <summary>
/// Sheet "BF-01 Location Setup" (UC-04, UC-06, GBR-02, GBR-08). Steps and expected results come from the plan only;
/// routes and payloads from docs/api/LOCATION_ROOM_API.md, PROPERTY_MANAGEMENT.md, API_RUNTIME_ROUTES.md and Postman BHome.Simple.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-01 Location Setup")]
public sealed class LocationSetupTests(PlanSessions sessions)
{
    private const string OccupiedRoomVariable = "BHOME_IT_BF01_OCCUPIED_ROOM_ID";

    private readonly PlanApi _api = sessions.Api;
    private readonly PropertySetup _setup = new(sessions);

    [SkippableFact(DisplayName = "ITC-BF01-001 Test creating a Location, a Room Type and a Room as Owner.")]
    [Trait("TestCase", "ITC-BF01-001")]
    public async Task ITC_BF01_001()
    {
        // 1. Sign in as Owner.
        var owner = await sessions.SessionAsync("owner");

        // 2. Create a Location.
        var locationName = PlanData.Unique("BF01-001 Location");
        var locationResponse = await _api.PostAsync("api/v1/locations", new { name = locationName, address = "Địa chỉ giả lập BF01-001", isActive = true }, owner.AccessToken);
        await PlanAssert.SuccessAsync(locationResponse, "step 2 create Location");
        var locationId = PropertySetup.Id(await locationResponse.JsonAsync());

        // 3. Create a Room Type for the Location (route from API_RUNTIME_ROUTES.md; checked last, see below).
        var roomTypeResponse = await _setup.PostRoomTypeAsync(locationId, PlanData.Unique("Standard"));

        // 4. Create a Room with the Room Type and a capacity.
        //    LOCATION_ROOM_API.md: Room DTO has no roomTypeId any more, so the Room is created with the documented payload.
        var roomNumber = PropertySetup.NewRoomNumber();
        var roomResponse = await _setup.PostRoomAsync(locationId, roomNumber, capacity: 3);

        // Expected: Each record is saved and shown in its list. The new Room is Available.
        //           The actor and a snapshot of the change are kept.
        var locations = await _setup.ReadAsync($"api/v1/locations?search={Uri.EscapeDataString(locationName)}&page=1&pageSize=100");
        Assert.Contains(locations.Items(), l => l.Str("id") == locationId);

        await PlanAssert.SuccessAsync(roomResponse, "step 4 create Room");
        var room = await roomResponse.JsonAsync();
        var roomId = PropertySetup.Id(room);
        Assert.Contains(await _setup.RoomsOfAsync(locationId), r => r.Str("id") == roomId);
        var savedRoom = await _setup.ReadAsync($"api/v1/rooms/{roomId}");
        Assert.True(PropertySetup.IsRoomStatus(savedRoom, 0, "Available"), "The new Room must be Available. Room: " + savedRoom.GetRawText());
        Assert.Equal("3", savedRoom.Str("capacity"));

        // Actor + snapshot: GET /rooms/{id}/history (PROPERTY_MANAGEMENT.md Phase 1B) keeps the configuration audit.
        var history = (await _setup.ReadAsync($"api/v1/rooms/{roomId}/history?page=1&pageSize=100")).Items();
        Assert.NotEmpty(history);
        Assert.True(
            history.SelectMany(h => h.AllStrings()).Any(s => string.Equals(s, owner.UserId, StringComparison.OrdinalIgnoreCase)),
            "The Room history must keep the Owner as actor of the creation. History: " + string.Join(", ", history.Select(h => h.GetRawText())));

        // Room Type record (plan step 3): must be saved and shown in its list.
        await PropertySetup.RequireRoomTypeRouteAsync(roomTypeResponse, "step 3 create Room Type");
        await PlanAssert.SuccessAsync(roomTypeResponse, "step 3 create Room Type");
        var roomTypeId = PropertySetup.Id(await roomTypeResponse.JsonAsync());
        var roomTypes = await _setup.ReadAsync($"api/v1/room-types?locationId={locationId}&page=1&pageSize=100");
        Assert.Contains(roomTypes.Items(), t => t.Str("id") == roomTypeId);
    }

    [SkippableFact(DisplayName = "ITC-BF01-002 Test that a duplicate Room Type, Room or Asset code in the same Location is refused.")]
    [Trait("TestCase", "ITC-BF01-002")]
    public async Task ITC_BF01_002()
    {
        // Pre-condition: Location exists.
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());

        // 1. Create a Room Type named "Standard".
        var first = await _setup.PostRoomTypeAsync(locationId, "Standard");
        // 2. Create another Room Type with the same name in the same Location (different letter case).
        var second = await _setup.PostRoomTypeAsync(locationId, "sTANDARD");

        // 3. Create two Rooms with the same number at the same time.
        var roomNumber = PropertySetup.NewRoomNumber();
        var owner = await _setup.OwnerAsync();
        var rooms = await Task.WhenAll(
            _setup.PostRoomAsync(locationId, roomNumber, token: owner),
            _setup.PostRoomAsync(locationId, roomNumber, token: owner));

        // Expected: The second record is refused (conflict) and only one record is saved. No orphan audit record is left.
        Assert.Equal(1, rooms.Count(r => r.IsSuccessStatusCode));
        await PlanAssert.StatusAsync(rooms.Single(r => !r.IsSuccessStatusCode), HttpStatusCode.Conflict, "step 3 second Room with the same number");
        var saved = (await _setup.RoomsOfAsync(locationId)).Where(r => string.Equals(r.Str("roomNumber"), roomNumber, StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Single(saved);
        // The refused request has no record id, so its audit cannot be read; the saved Room keeps a readable history.
        var savedHistory = await _api.GetAsync($"api/v1/rooms/{PropertySetup.Id(saved[0])}/history?page=1&pageSize=100", owner);
        await PlanAssert.SuccessAsync(savedHistory, "history of the saved Room");

        // Room Type part (steps 1-2).
        await PropertySetup.RequireRoomTypeRouteAsync(first, "step 1 create Room Type \"Standard\"");
        await PlanAssert.SuccessAsync(first, "step 1 create Room Type \"Standard\"");
        await PlanAssert.StatusAsync(second, HttpStatusCode.Conflict, "step 2 same Room Type name, different case");
        var types = (await _setup.ReadAsync($"api/v1/room-types?locationId={locationId}&page=1&pageSize=100")).Items();
        Assert.Single(types, t => string.Equals(t.Str("name"), "Standard", StringComparison.OrdinalIgnoreCase));
    }

    [SkippableFact(DisplayName = "ITC-BF01-003 Test that a Room with an active tenancy cannot be set to a conflicting status.")]
    [Trait("TestCase", "ITC-BF01-003")]
    public async Task ITC_BF01_003()
    {
        // Expected (part that needs no tenancy): Reserved states (On Hold, Occupied) cannot be set by hand.
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var freshRoom = await _setup.CreateRoomAsync(locationId);
        await PlanAssert.RefusedAsync(await _setup.PutRoomStatusAsync(freshRoom, 1), "set On Hold by hand");
        await PlanAssert.RefusedAsync(await _setup.PutRoomStatusAsync(freshRoom, 2), "set Occupied by hand");
        var afterReserved = await _setup.ReadAsync($"api/v1/rooms/{PropertySetup.Id(freshRoom)}");
        Assert.True(PropertySetup.IsRoomStatus(afterReserved, 0, "Available"), "Refused reserved status must not change the Room: " + afterReserved.GetRawText());

        // Pre-condition: A Room with residents exists. Creating one needs an Active contract (digital signing provider,
        // CONTRACT_LIFECYCLE.md) or a resident capture whose request body is not documented, so it must be supplied.
        var occupiedRoomId = Environment.GetEnvironmentVariable(OccupiedRoomVariable);
        Skip.If(
            string.IsNullOrWhiteSpace(occupiedRoomId),
            $"Precondition 'A Room with residents exists' cannot be built black-box (needs a signed/active contract through the digital-signing provider). " +
            $"Set {OccupiedRoomVariable} to the id of a Room that has residents or an active contract. Reserved-state checks above passed.");

        // 1. Open a Room that has residents or an active contract.
        var room = await _setup.ReadAsync($"api/v1/rooms/{occupiedRoomId}");
        var location = await _setup.ReadAsync($"api/v1/locations/{room.Str("locationId")}");

        // 2. Change its status to Unavailable or Available by hand.
        var unavailable = await _setup.PutRoomStatusAsync(room, 3);
        var available = await _setup.PutRoomStatusAsync(room, 0);

        // 3. Try to deactivate the Room or the Location.
        var deactivateLocation = await _setup.PutLocationAsync(location, isActive: false);

        // Expected: The change is refused. Records that are still used are kept, not deleted.
        await PlanAssert.RefusedAsync(unavailable, "step 2 set Unavailable");
        await PlanAssert.RefusedAsync(available, "step 2 set Available");
        await PlanAssert.RefusedAsync(deactivateLocation, "step 3 deactivate the Location");
        var roomAfter = await _setup.ReadAsync($"api/v1/rooms/{occupiedRoomId}");
        Assert.Equal(room.Str("status"), roomAfter.Str("status"));
        var locationAfter = await _setup.ReadAsync($"api/v1/locations/{room.Str("locationId")}");
        Assert.Equal("true", locationAfter.Str("isActive"));
    }

    [SkippableFact(DisplayName = "ITC-BF01-004 Test that two people editing the same record do not overwrite each other.")]
    [Trait("TestCase", "ITC-BF01-004")]
    public async Task ITC_BF01_004()
    {
        // Pre-condition: Room Type exists.
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var created = await _setup.PostRoomTypeAsync(locationId, PlanData.Unique("Standard"));
        await PropertySetup.RequireRoomTypeRouteAsync(created, "precondition create Room Type");
        await PlanAssert.SuccessAsync(created, "precondition create Room Type");
        var roomTypeId = PropertySetup.Id(await created.JsonAsync());

        // 1. Open the same Room Type in two sessions.
        var sessionA = await sessions.TokenAsync("owner");
        var sessionB = (await sessions.NewSessionAsync("owner", "BF01-004 second session")).AccessToken;
        var viewA = await _setup.ReadAsync($"api/v1/room-types/{roomTypeId}", sessionA);
        var viewB = await _setup.ReadAsync($"api/v1/room-types/{roomTypeId}", sessionB);

        // 2. Save a change in the first session.
        var saveA = await _api.PutAsync($"api/v1/room-types/{roomTypeId}", RoomTypeUpdate(viewA, "Phiên 1"), sessionA);
        await PlanAssert.SuccessAsync(saveA, "step 2 first session save");

        // 3. Save a change in the second session with the old version.
        var saveB = await _api.PutAsync($"api/v1/room-types/{roomTypeId}", RoomTypeUpdate(viewB, "Phiên 2"), sessionB);

        // Expected: The second save is refused with a version conflict.
        await PlanAssert.StatusAsync(saveB, HttpStatusCode.Conflict, "step 3 second session with the old version");
        var final = await _setup.ReadAsync($"api/v1/room-types/{roomTypeId}");
        Assert.Equal("Phiên 1", final.Str("description"));

        // Expected: A reference to a record of another Location is refused.
        var otherLocationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var crossRoom = await _api.PostAsync(
            "api/v1/rooms",
            new { locationId = otherLocationId, roomTypeId, roomNumber = PropertySetup.NewRoomNumber(), floor = "1", capacity = 2, status = 0 },
            sessionA);
        await PlanAssert.RefusedAsync(crossRoom, "Room of another Location referencing this Room Type");
        var roomOfL1 = await _setup.CreateRoomAsync(locationId);
        var crossAsset = await _api.PostAsync(
            "api/v1/assets",
            new { locationId = otherLocationId, roomId = PropertySetup.Id(roomOfL1), commonArea = (string?)null, code = "IT-" + Guid.NewGuid().ToString("N")[..6], name = "Máy lạnh test", category = "Điện lạnh", condition = "Hoạt động bình thường", status = 0 },
            sessionA);
        await PlanAssert.RefusedAsync(crossAsset, "Asset of another Location referencing a Room of this Location");
    }

    [SkippableFact(DisplayName = "ITC-BF01-005 Test that a Staff member can only read, and only in the assigned Location.")]
    [Trait("TestCase", "ITC-BF01-005")]
    public async Task ITC_BF01_005()
    {
        // Pre-condition: Staff assigned to L1 only (L2 never assigned; L3 assigned only from a future date).
        var l1 = PropertySetup.Id(await _setup.CreateLocationAsync());
        var l2 = PropertySetup.Id(await _setup.CreateLocationAsync());
        var l3 = PropertySetup.Id(await _setup.CreateLocationAsync());
        var room1 = await _setup.CreateRoomAsync(l1);
        var room2 = await _setup.CreateRoomAsync(l2);
        var room3 = await _setup.CreateRoomAsync(l3);
        await _setup.AssignStaffAsync(l1, "staff", 0, 30);
        await _setup.AssignStaffAsync(l3, "staff", 5, 30);

        // 1. Sign in as Staff assigned to L1.
        var staff = await sessions.TokenAsync("staff");

        // 2. Open the Rooms of L1.
        var l1Rooms = await _api.GetAsync($"api/v1/rooms?locationId={l1}&page=1&pageSize=100", staff);
        var l1Room = await _api.GetAsync($"api/v1/rooms/{PropertySetup.Id(room1)}", staff);

        // 3. Try to create or update a Room.
        var create = await _setup.PostRoomAsync(l1, PropertySetup.NewRoomNumber(), token: staff);
        var update = await _setup.PutRoomStatusAsync(room1, 3, staff);

        // 4. Open the Rooms of L2.
        var l2Rooms = await _api.GetAsync($"api/v1/rooms?locationId={l2}&page=1&pageSize=100", staff);
        var l2Room = await _api.GetAsync($"api/v1/rooms/{PropertySetup.Id(room2)}", staff);

        // Expected: L1 can be read.
        await PlanAssert.SuccessAsync(l1Rooms, "step 2 list Rooms of L1");
        Assert.Contains((await l1Rooms.JsonAsync()).Items(), r => r.Str("id") == PropertySetup.Id(room1));
        await PlanAssert.SuccessAsync(l1Room, "step 2 open a Room of L1");

        // Expected: Create and update are refused (403).
        await PlanAssert.StatusAsync(create, HttpStatusCode.Forbidden, "step 3 Staff creates a Room");
        await PlanAssert.StatusAsync(update, HttpStatusCode.Forbidden, "step 3 Staff updates a Room");

        // Expected: L2 is not shown.
        await AssertNotShownAsync(l2Rooms, l2Room, "L2");

        // Expected: Only current assignments count (L3 assignment starts in the future).
        await AssertNotShownAsync(
            await _api.GetAsync($"api/v1/rooms?locationId={l3}&page=1&pageSize=100", staff),
            await _api.GetAsync($"api/v1/rooms/{PropertySetup.Id(room3)}", staff),
            "L3 (future assignment)");
    }

    [SkippableFact(DisplayName = "ITC-BF01-006 Test creating rent, electricity and water policies with an effective date.")]
    [Trait("TestCase", "ITC-BF01-006")]
    public async Task ITC_BF01_006()
    {
        // Pre-condition: Owner is signed in; Location exists (Room Types no longer exist, see LOCATION_ROOM_API.md; a Room is used for the price lookup).
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var roomId = PropertySetup.Id(await _setup.CreateRoomAsync(locationId));
        var today = PropertySetup.Day(0);
        var before = await _setup.ReadAsync($"api/v1/rooms/{roomId}/prices?effectiveOn={today}");

        // 1. Open Rental Rate / Billing Policy management for L1.
        Assert.Empty(await _setup.PoliciesOfAsync(locationId));

        // 2. Create a rent policy (fixed per room per month) with a start date (Location scope + a more specific Room scope).
        var rentLocation = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, 2500000m, today), "step 2 rent (Location)");
        var rentRoom = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, roomId, 0, "RENT", "Tiền thuê phòng", 0, 2700000m, today), "step 2 rent (Room)");

        // 3. Create electricity and water policies (metered). A zero service fee is added to compare zero vs missing.
        var electricity = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 1, "ELECTRICITY", "Điện", 1, 3500.125m, today), "step 3 electricity");
        var water = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 2, "WATER", "Nước", 1, 18000m, today), "step 3 water");
        var zeroFee = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 3, "INTERNET", "Internet", 0, 0m, today), "zero service fee");

        // 4. Check which price is used for a Room.
        var prices = await _setup.ReadAsync($"api/v1/rooms/{roomId}/prices?effectiveOn={today}");

        // Expected: Each policy is saved as an effective-dated version.
        foreach (var policy in new[] { rentLocation, rentRoom, electricity, water, zeroFee })
        {
            var saved = await _setup.ReadAsync($"api/v1/billing-policies/{PropertySetup.Id(policy)}");
            Assert.Equal(today, saved.Str("effectiveFrom"));
            Assert.Null(saved.Str("effectiveTo"));
            Assert.True(PropertySetup.Version(saved) >= 1);
        }

        Assert.Equal(5, (await _setup.PoliciesOfAsync(locationId)).Count);

        // Expected: The price that applies to a Room follows the most specific scope for each charge.
        Assert.Equal(2700000m, PropertySetup.Dec(Charge(prices, "RENT").Str("rate")));
        Assert.Contains(PropertySetup.Id(rentRoom), Charge(prices, "RENT").AllStrings());
        Assert.Equal(3500.125m, PropertySetup.Dec(Charge(prices, "ELECTRICITY").Str("rate")));
        Assert.Equal(18000m, PropertySetup.Dec(Charge(prices, "WATER").Str("rate")));

        // Expected: A missing price and a zero price are not mixed up.
        Assert.Equal(new[] { "ELECTRICITY", "RENT", "WATER" }, Missing(before).OrderBy(x => x));
        Assert.Empty(Missing(prices));
        Assert.Equal(0m, PropertySetup.Dec(Charge(prices, "INTERNET").Str("rate")));
    }

    [SkippableFact(DisplayName = "ITC-BF01-007 Test invalid prices and dates.")]
    [Trait("TestCase", "ITC-BF01-007")]
    public async Task ITC_BF01_007()
    {
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var today = PropertySetup.Day(0);
        var owner = await _setup.OwnerAsync();

        // 1. Create a policy with a negative amount.
        var negative = await _setup.PostPolicyAsync(PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, -1m, today));
        // 2. Create a policy with an unsupported charging method.
        var badMethod = await _setup.PostPolicyAsync(PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 99, 2500000m, today));
        // 3. Create a policy with a start date in the past.
        var past = await _setup.PostPolicyAsync(PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, 2500000m, PropertySetup.Day(-1)));
        // 4. Open the list with an invalid page number or size.
        var badPage = await _api.GetAsync($"api/v1/billing-policies?locationId={locationId}&page=0&pageSize=20", owner);
        var badSize = await _api.GetAsync($"api/v1/billing-policies?locationId={locationId}&page=1&pageSize=101", owner);

        // Expected: Every request is refused with a validation message and nothing is saved.
        foreach (var (response, step) in new[] { (negative, "step 1 negative amount"), (badMethod, "step 2 unsupported method"), (past, "step 3 past start date"), (badPage, "step 4 page=0"), (badSize, "step 4 pageSize=101") })
        {
            AssertHasMessage(await PlanAssert.RefusedAsync(response, step), step);
        }

        Assert.Empty(await _setup.PoliciesOfAsync(locationId));
    }

    [SkippableFact(DisplayName = "ITC-BF01-008 Test replacing a policy that is already in use.")]
    [Trait("TestCase", "ITC-BF01-008")]
    public async Task ITC_BF01_008()
    {
        // Pre-condition: A policy is in use (a rent policy that started today).
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var today = PropertySetup.Day(0);
        var tomorrow = PropertySetup.Day(1);
        var running = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, 2500000m, today), "precondition running policy");
        var runningId = PropertySetup.Id(running);

        // 1. Replace a running policy from a new start date.
        var replacement = await _api.PostAsync(
            $"api/v1/billing-policies/{runningId}/replacement",
            new { expectedVersion = PropertySetup.Version(running), policy = PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, 2800000m, tomorrow) },
            await _setup.OwnerAsync());
        await PlanAssert.SuccessAsync(replacement, "step 1 replacement");
        var newVersion = await replacement.JsonAsync();

        // Expected: The old version ends the day before and the new one starts on the new date (dates are inclusive).
        var oldAfterReplace = await _setup.ReadAsync($"api/v1/billing-policies/{runningId}");
        Assert.Equal(today, oldAfterReplace.Str("effectiveTo"));
        Assert.Equal(today, oldAfterReplace.Str("effectiveFrom"));
        Assert.Equal(2500000m, PropertySetup.Dec(oldAfterReplace.Str("rate")));
        var newSaved = await _setup.ReadAsync($"api/v1/billing-policies/{PropertySetup.Id(newVersion)}");
        Assert.Equal(tomorrow, newSaved.Str("effectiveFrom"));
        Assert.Equal(2800000m, PropertySetup.Dec(newSaved.Str("rate")));

        // 2. Repeat the replacement with data that makes it fail (negative amount).
        var failing = await _api.PostAsync(
            $"api/v1/billing-policies/{runningId}/replacement",
            new { expectedVersion = PropertySetup.Version(oldAfterReplace), policy = PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, -5m, PropertySetup.Day(2)) },
            await _setup.OwnerAsync());

        // Expected: If the replacement fails, the old version is not changed.
        await PlanAssert.RefusedAsync(failing, "step 2 failing replacement");
        var oldAfterFailure = await _setup.ReadAsync($"api/v1/billing-policies/{runningId}");
        Assert.Equal(oldAfterReplace.Str("effectiveTo"), oldAfterFailure.Str("effectiveTo"));
        Assert.Equal(oldAfterReplace.Str("version"), oldAfterFailure.Str("version"));
        Assert.Equal(oldAfterReplace.Str("rate"), oldAfterFailure.Str("rate"));
        Assert.Equal(2, (await _setup.PoliciesOfAsync(locationId)).Count);
    }

    [SkippableFact(DisplayName = "ITC-BF01-009 Test editing a price that is not used yet.")]
    [Trait("TestCase", "ITC-BF01-009")]
    public async Task ITC_BF01_009()
    {
        // Pre-condition: A future policy exists.
        var locationId = PropertySetup.Id(await _setup.CreateLocationAsync());
        var code = "FUT_" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var from = PropertySetup.Day(10);
        var to = PropertySetup.Day(20);
        var future = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 3, code, "Phí tương lai", 0, 100000m, from, to), "precondition future policy");
        var futureId = PropertySetup.Id(future);

        // 1. Edit the future, not-yet-used policy (plan procedure cell is garbled; description used).
        var edit = await _api.PutAsync(
            $"api/v1/billing-policies/{futureId}",
            new { policy = PropertySetup.Policy(locationId, null, 3, code, "Phí tương lai đã chỉnh", 0, 120000m, from, to), expectedVersion = PropertySetup.Version(future) },
            await _setup.OwnerAsync());

        // Expected: The future policy is changed in place with a new version and an audit record.
        await PlanAssert.SuccessAsync(edit, "step 1 edit future policy");
        var saved = await _setup.ReadAsync($"api/v1/billing-policies/{futureId}");
        Assert.Equal(futureId, saved.Str("id"));
        Assert.Equal(120000m, PropertySetup.Dec(saved.Str("rate")));
        Assert.True(PropertySetup.Version(saved) > PropertySetup.Version(future), "Editing must create a new version.");
        Assert.Single(await _setup.PoliciesOfAsync(locationId));
        // The audit record of a policy has no documented read endpoint (only /rooms/{id}/history exists); not checked.

        // Expected: A price already used for billing is not edited.
        // Billing usage (FirstUsedAt) needs an issued invoice; PROPERTY_MANAGEMENT.md gives the same 409 for a price that
        // has already started, which is what can be prepared black-box.
        var started = await _setup.CreatePolicyAsync(PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, 2500000m, PropertySetup.Day(0)), "started policy");
        var editStarted = await _api.PutAsync(
            $"api/v1/billing-policies/{PropertySetup.Id(started)}",
            new { policy = PropertySetup.Policy(locationId, null, 0, "RENT", "Tiền thuê", 0, 2600000m, PropertySetup.Day(0)), expectedVersion = PropertySetup.Version(started) },
            await _setup.OwnerAsync());
        await PlanAssert.RefusedAsync(editStarted, "edit a price already in effect");
        Assert.Equal(2500000m, PropertySetup.Dec((await _setup.ReadAsync($"api/v1/billing-policies/{PropertySetup.Id(started)}")).Str("rate")));
    }

    private static object RoomTypeUpdate(JsonElement view, string description) => new
    {
        locationId = view.Str("locationId"),
        name = view.Str("name"),
        description,
        defaultCapacity = 2,
        areaM2 = 20.5m,
        amenities = new[] { "Ban công" },
        isActive = true,
        version = PropertySetup.Version(view),
        reason = "Kiểm thử chỉnh sửa đồng thời",
    };

    private static async Task AssertNotShownAsync(HttpResponseMessage list, HttpResponseMessage detail, string what)
    {
        if (list.IsSuccessStatusCode)
        {
            Assert.Empty((await list.JsonAsync()).Items());
        }
        else
        {
            await PlanAssert.RefusedAsync(list, $"list Rooms of {what}");
        }

        await PlanAssert.RefusedAsync(detail, $"open a Room of {what}");
    }

    private static JsonElement Charge(JsonElement prices, string code)
    {
        var charges = prices.Find("charges")?.EnumerateArray().Where(c => string.Equals(c.Str("chargeCode"), code, StringComparison.OrdinalIgnoreCase)).ToList() ?? [];
        Assert.True(charges.Count == 1, $"Expected exactly one applied charge {code}. Prices: {prices.GetRawText()}");
        return charges[0];
    }

    private static IEnumerable<string> Missing(JsonElement prices)
        => prices.Find("missingRequiredCharges")?.EnumerateArray().Select(m => m.GetString() ?? string.Empty).ToList() ?? [];

    private static void AssertHasMessage(string body, string step)
    {
        Assert.False(string.IsNullOrWhiteSpace(body), $"{step}: expected a validation message but the answer body was empty.");
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.True(
            !string.IsNullOrWhiteSpace(root.Str("title")) || !string.IsNullOrWhiteSpace(root.Str("detail")) || root.Find("errors") is not null,
            $"{step}: expected a validation message in the answer. Body: {body}");
    }
}
