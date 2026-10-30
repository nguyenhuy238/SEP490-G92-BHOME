using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.PropertyManagement;

[Trait("Category", "Docker")]
public sealed class PropertyApiTests(AuthenticationDatabaseFixture fixture) : IClassFixture<AuthenticationDatabaseFixture>
{
    private const string Password = "Synthetic-Property!493";
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    private async Task<(HttpClient Client, Guid UserId)> Client(string role)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var id = Guid.NewGuid();
        var user = new ApplicationUser { Id = id, UserName = id.ToString(), Email = $"{id:N}@example.invalid" };
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        var client = fixture.Factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { user.Email, password = Password });
        login.EnsureSuccessStatusCode();
        var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        return (client, id);
    }
    private static async Task<T> Created<T>(HttpClient client, string route, object input)
    {
        var response = await client.PostAsJsonAsync("/api/v1/" + route, input);
        Assert.True(response.StatusCode == HttpStatusCode.Created,
            $"{route}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        Assert.NotNull(response.Headers.Location);
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private async Task<(HttpClient Owner, Guid Actor, LocationDto Location, RoomTypeDto Type, RoomDto Room)> Workspace()
    {
        var owner = await Client(Roles.Owner);
        var location = await Created<LocationDto>(owner.Client, "locations", new LocationWrite("Synthetic Location", "Synthetic Address"));
        var type = await Created<RoomTypeDto>(owner.Client, "room-types", new RoomTypeWrite(location.Id, "Studio", null, 2, 20m, ["Balcony"]));
        var room = await Created<RoomDto>(owner.Client, "rooms", new RoomWrite(location.Id, type.Id, "A-01", "1", 2));
        return (owner.Client, owner.UserId, location, type, room);
    }
    private static PolicyWrite Rent(Guid location, decimal rate, DateOnly? from = null,
        DateOnly? to = null, Guid? type = null, Guid? room = null) =>
        new(location, type, room, ChargeCategory.Rent, "RENT", "Tiền thuê", ChargingMethod.FixedPerRoomPerMonth,
            rate, from ?? Today, to);

    [Fact]
    public async Task FullConfigurationUpdatesRequireVersionsAndRetainActorAndSnapshots()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var asset = await Created<AssetDto>(owner, "assets", new AssetWrite(w.Location.Id, w.Room.Id, null,
            "AC-01", "Air conditioner", "Cooling", "Good"));
        var update = new AssetWrite(w.Location.Id, w.Room.Id, null, "AC-01", "Air conditioner", "Cooling", "Needs inspection",
            AssetStatus.NeedsRepair, asset.Version, "Owner inspection");
        var result = await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}", update);
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        var changed = (await result.Content.ReadFromJsonAsync<AssetDto>())!;
        Assert.Equal(2, changed.Version);
        Assert.Equal(AssetStatus.NeedsRepair, changed.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}", update)).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var history = await db.Set<PropertyChange>().Where(x => x.TargetId == asset.Id).OrderBy(x => x.OccurredAt).ToArrayAsync();
        Assert.Equal(2, history.Length);
        Assert.All(history, x => Assert.Equal(w.Actor, x.ActorId));
        Assert.Contains("Good", history[1].Before!); Assert.Contains("Needs inspection", history[1].After);
        Assert.Equal("Owner inspection", history[1].Reason);
        var exception = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM \"PropertyChanges\" WHERE \"TargetId\" = {asset.Id}"));
        Assert.Equal("23514", exception.SqlState);
    }

    [Fact]
    public async Task StaffReadsOnlyCurrentAssignmentsBeforeCountingAndCannotMutate()
    {
        var visible = await Workspace(); using var owner = visible.Owner;
        var hidden = await Workspace(); using var hiddenOwner = hidden.Owner;
        var staff = await Client(Roles.Staff); using var client = staff.Client;
        var asset = await Created<AssetDto>(owner, "assets", new AssetWrite(visible.Location.Id, visible.Room.Id, null, "A", "Asset", "Equipment", "Good"));
        var policy = await Created<PolicyDto>(owner, "billing-policies", Rent(visible.Location.Id, 100));
        var assignment = await owner.PostAsJsonAsync("/api/v1/staff-location-assignments", new
        {
            locationId = visible.Location.Id,
            staffUserId = staff.UserId,
            startDate = Today,
            endDate = Today
        });
        Assert.Equal(HttpStatusCode.Created, assignment.StatusCode);
        foreach (var route in new[] { $"locations/{visible.Location.Id}", $"rooms/{visible.Room.Id}",
                     $"room-types/{visible.Type.Id}", $"assets/{asset.Id}", $"billing-policies/{policy.Id}",
                     $"rooms/{visible.Room.Id}/prices?effectiveOn={Today:yyyy-MM-dd}" })
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/" + route)).StatusCode);
        foreach (var route in new[] { $"locations/{hidden.Location.Id}", $"rooms/{hidden.Room.Id}", $"room-types/{hidden.Type.Id}" })
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/" + route)).StatusCode);
        var page = (await client.GetFromJsonAsync<PagedResult<RoomDto>>("/api/v1/rooms?pageSize=1"))!;
        Assert.Equal(1, page.TotalCount); Assert.Equal(visible.Room.Id, Assert.Single(page.Items).Id);
        Assert.Empty((await client.GetFromJsonAsync<PagedResult<RoomDto>>($"/api/v1/rooms?locationId={hidden.Location.Id}"))!.Items);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/rooms",
            new RoomWrite(visible.Location.Id, visible.Type.Id, "FORBIDDEN", null, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync($"/api/v1/assets/{asset.Id}",
            new AssetWrite(visible.Location.Id, visible.Room.Id, null, "A", "Asset", "Equipment", "Changed", Version: 1))).StatusCode);
        // Assignment changes apply to an already-issued JWT on the very next request.
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "StaffLocationAssignments" SET "StartDate" = {Today.AddDays(-2)}, "EndDate" = {Today.AddDays(-1)}
            WHERE "LocationId" = {visible.Location.Id}
            """);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/rooms/{visible.Room.Id}")).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<PagedResult<RoomDto>>("/api/v1/rooms"))!.TotalCount);
    }

    [Theory]
    [InlineData("locations")]
    [InlineData("room-types")]
    [InlineData("rooms")]
    [InlineData("assets")]
    [InlineData("billing-policies")]
    public async Task AnonymousAndTenantCannotBrowseManagementData(string route)
    {
        using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/" + route)).StatusCode);
        var tenant = await Client(Roles.Tenant); using var client = tenant.Client;
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/" + route)).StatusCode);
    }

    [Fact]
    public async Task InvalidScopesReservedStatesAndDeactivationAreRejected()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var other = await Workspace(); using var otherOwner = other.Owner;
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/rooms",
            new RoomWrite(w.Location.Id, other.Type.Id, "BAD", null, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/capture/rooms",
            new RoomInput(w.Location.Id, "NO-TYPE"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room.Id}",
            new RoomWrite(w.Location.Id, w.Type.Id, "A-01", "1", 2, RoomStatus.Occupied, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location.Id}",
            new LocationWrite(w.Location.Name, w.Location.Address, false, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/room-types/{w.Type.Id}",
            new RoomTypeWrite(w.Location.Id, w.Type.Name, null, 2, 20, [], false, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/assets",
            new AssetWrite(w.Location.Id, other.Room.Id, null, null, "Invalid", "Equipment", "Good"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/assets",
            new AssetWrite(w.Location.Id, null, null, null, "Missing scope", "Equipment", "Good"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room.Id}",
            new RoomWrite(w.Location.Id, w.Type.Id, "A-01", "1", 2, RoomStatus.Unavailable, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync($"/api/v1/room-types/{w.Type.Id}",
            new RoomTypeWrite(w.Location.Id, w.Type.Name, null, 2, 20, [], false, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location.Id}",
            new LocationWrite(w.Location.Name, w.Location.Address, false, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/rooms",
            new RoomWrite(w.Location.Id, w.Type.Id, "NEW", null, 1))).StatusCode);
    }

    [Fact]
    public async Task DuplicateRoomAndPolicyRacesHaveOneWinnerAndNoOrphanAudit()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var rooms = await Task.WhenAll(new[] { " race ", "RACE" }.Select(number => owner.PostAsJsonAsync("/api/v1/rooms",
            new RoomWrite(w.Location.Id, w.Type.Id, number, null, 1))));
        Assert.Single(rooms, x => x.StatusCode == HttpStatusCode.Created);
        Assert.Single(rooms, x => x.StatusCode == HttpStatusCode.Conflict);
        var writes = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => owner.PostAsJsonAsync("/api/v1/billing-policies", Rent(w.Location.Id, 100))));
        Assert.Single(writes, x => x.StatusCode == HttpStatusCode.Created);
        Assert.Single(writes, x => x.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<BillingPolicy>().CountAsync(x => x.LocationId == w.Location.Id));
        Assert.Equal(1, await db.Set<PropertyChange>().CountAsync(x => x.LocationId == w.Location.Id && x.TargetType == nameof(BillingPolicy)));
    }

    [Fact]
    public async Task PriceResolutionUsesPerChargeSpecificityAndPreservesMissingAndZero()
    {
        var w = await Workspace(); using var owner = w.Owner;
        await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 100));
        await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 200, type: w.Type.Id));
        var roomRent = await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 300, room: w.Room.Id));
        await Created<PolicyDto>(owner, "billing-policies", new PolicyWrite(w.Location.Id, null, null, ChargeCategory.Electricity,
            "ELECTRICITY", "Điện", ChargingMethod.Metered, 3500.125m, Today, null));
        await Created<PolicyDto>(owner, "billing-policies", new PolicyWrite(w.Location.Id, null, null, ChargeCategory.ServiceFee,
            "internet", "Internet", ChargingMethod.FixedPerRoomPerMonth, 0, Today, null));
        var prices = (await owner.GetFromJsonAsync<ResolvedPrices>($"/api/v1/rooms/{w.Room.Id}/prices?effectiveOn={Today:yyyy-MM-dd}"))!;
        Assert.Equal(roomRent.Id, prices.Charges.Single(x => x.ChargeCode == "RENT").Id);
        Assert.Equal(3500.125m, prices.Charges.Single(x => x.ChargeCode == "ELECTRICITY").Rate);
        Assert.Equal(0, prices.Charges.Single(x => x.ChargeCode == "INTERNET").Rate);
        Assert.Equal(["WATER"], prices.MissingRequiredCharges);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync($"/api/v1/rooms/{w.Room.Id}/prices")).StatusCode);
    }

    [Fact]
    public async Task ReplacementSplitsInclusiveDatesAndFailedReplacementRollsBackOldVersion()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var first = await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 100));
        var tomorrow = Today.AddDays(1);
        var second = await Created<PolicyDto>(owner, $"billing-policies/{first.Id}/replacement",
            new PolicyReplacement(Rent(w.Location.Id, 200, tomorrow), first.Version));
        var old = (await owner.GetFromJsonAsync<PolicyDto>($"/api/v1/billing-policies/{first.Id}"))!;
        Assert.Equal(Today, old.EffectiveTo); Assert.Equal(100, old.Rate); Assert.Equal(2, old.Version);
        var todayPrices = (await owner.GetFromJsonAsync<ResolvedPrices>($"/api/v1/rooms/{w.Room.Id}/prices?effectiveOn={Today:yyyy-MM-dd}"))!;
        var tomorrowPrices = (await owner.GetFromJsonAsync<ResolvedPrices>($"/api/v1/rooms/{w.Room.Id}/prices?effectiveOn={tomorrow:yyyy-MM-dd}"))!;
        Assert.Equal(100, todayPrices.Charges.Single().Rate); Assert.Equal(200, tomorrowPrices.Charges.Single().Rate);
        var future = Today.AddDays(5);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync($"/api/v1/billing-policies/{second.Id}/end",
            new PolicyEnd(future.AddDays(-1), second.Version, "End configured period"))).StatusCode);
        await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 900, future));
        // Starts inside second's range but would overlap the already scheduled third policy.
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync($"/api/v1/billing-policies/{second.Id}/replacement",
            new PolicyReplacement(Rent(w.Location.Id, 300, Today.AddDays(2)), 2))).StatusCode);
        var preserved = (await owner.GetFromJsonAsync<PolicyDto>($"/api/v1/billing-policies/{second.Id}"))!;
        Assert.Equal(future.AddDays(-1), preserved.EffectiveTo); Assert.Equal(2, preserved.Version);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var exception = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE \"BillingPolicies\" SET \"Rate\" = 1 WHERE \"Id\" = {first.Id}"));
        Assert.Equal("23514", exception.SqlState);
    }

    [Fact]
    public async Task NegativeAmountsUnsupportedMethodsRetroactiveDatesAndInvalidPagingAreRejected()
    {
        var w = await Workspace(); using var owner = w.Owner;
        foreach (var input in new[] { Rent(w.Location.Id, -1), Rent(w.Location.Id, 1, Today.AddDays(-1)),
                     Rent(w.Location.Id, 1, Today.AddDays(2), Today), Rent(w.Location.Id, 0.00001m),
                     Rent(w.Location.Id, 1) with { Method = ChargingMethod.Metered },
                     Rent(w.Location.Id, 1) with { RoomId = w.Room.Id, RoomTypeId = w.Type.Id } })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/billing-policies", input)).StatusCode);
        foreach (var query in new[] { "page=0", "pageSize=101", "page=2147483647&pageSize=100", "roomStatus=99" })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/v1/rooms?" + query)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/billing-policies", new
        {
            locationId = w.Location.Id,
            category = 0,
            chargeCode = "RENT",
            name = "Missing rate",
            method = 0,
            effectiveFrom = Today
        })).StatusCode);
    }

    [Fact]
    public async Task NormalizedTypeAndAssetCodesAreUniqueWithinLocationAndOwnerAccessIsGlobal()
    {
        var w = await Workspace(); using var owner = w.Owner;
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/room-types",
            new RoomTypeWrite(w.Location.Id, " studio ", null, 1, null, []))).StatusCode);
        await Created<AssetDto>(owner, "assets", new AssetWrite(w.Location.Id, null, "Lobby", "AC", "Asset", "Equipment", "Good"));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/assets",
            new AssetWrite(w.Location.Id, null, "Lobby", " ac ", "Other", "Equipment", "Good"))).StatusCode);
        // Optional asset codes are not fabricated and do not collide with each other.
        await Created<AssetDto>(owner, "assets", new AssetWrite(w.Location.Id, null, "Lobby", null, "First", "Equipment", "Good"));
        await Created<AssetDto>(owner, "assets", new AssetWrite(w.Location.Id, null, "Lobby", null, "Second", "Equipment", "Good"));
        var second = await Client(Roles.Owner); using var otherOwner = second.Client;
        Assert.Equal(HttpStatusCode.OK, (await otherOwner.GetAsync($"/api/v1/locations/{w.Location.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await otherOwner.PutAsJsonAsync($"/api/v1/rooms/{w.Room.Id}",
            new RoomWrite(w.Location.Id, w.Type.Id, "A-02", "1", 2, Version: w.Room.Version))).StatusCode);
    }

    [Fact]
    public async Task ExistingResidentsBlockClosureAndCaptureCannotBypassUnavailableRoom()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var created = await owner.PostAsJsonAsync("/api/v1/capture/residents", new ResidentInput(w.Room.Id, "Synthetic resident", ResidentType.CoOccupant));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room.Id}",
            new RoomWrite(w.Location.Id, w.Type.Id, "A-01", "1", 2, RoomStatus.Unavailable, 1))).StatusCode);
        var unavailable = await Created<RoomDto>(owner, "rooms", new RoomWrite(w.Location.Id, w.Type.Id, "CLOSED", null, 1, RoomStatus.Unavailable));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/capture/residents",
            new ResidentInput(unavailable.Id, "Blocked", ResidentType.CoOccupant))).StatusCode);
    }

    [Fact]
    public async Task ParallelEditsUseExpectedVersionAndDatabaseEnforcesCrossLocationReferences()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var updates = await Task.WhenAll(new[] { "A-02", "A-03" }.Select(number => owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room.Id}",
            new RoomWrite(w.Location.Id, w.Type.Id, number, "1", 2, Version: 1))));
        Assert.Single(updates, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(updates, x => x.StatusCode == HttpStatusCode.Conflict);
        var other = await Workspace(); using var otherOwner = other.Owner;
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/v1/billing-policies",
            Rent(w.Location.Id, 10, room: other.Room.Id))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        db.Set<Asset>().Add(new Asset { LocationId = w.Location.Id, RoomId = other.Room.Id, Name = "Invalid", Category = "Equipment", Condition = "Good" });
        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23503", Assert.IsType<PostgresException>(exception.InnerException).SqlState);
    }

    [Fact]
    public async Task OwnerEditsUnusedFuturePriceInPlaceWithVersionAndAudit()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var start = Today.AddDays(5);
        var policy = await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 100, start));
        var input = Rent(w.Location.Id, 250, start.AddDays(1), start.AddDays(10)) with
        { Name = " Revised future rent ", Reason = "Correct unused future configuration" };
        var response = await owner.PutAsJsonAsync($"/api/v1/billing-policies/{policy.Id}", new PolicyUpdate(input, policy.Version));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<PolicyDto>())!;
        Assert.Equal(policy.Id, updated.Id); Assert.Equal(2, updated.Version); Assert.Null(updated.FirstUsedAt);
        Assert.Equal(250, updated.Rate); Assert.Equal("Revised future rent", updated.Name);
        Assert.Equal(input.EffectiveFrom, updated.EffectiveFrom); Assert.Equal(input.EffectiveTo, updated.EffectiveTo);
        var price = (await owner.GetFromJsonAsync<ResolvedPrices>($"/api/v1/rooms/{w.Room.Id}/prices?effectiveOn={input.EffectiveFrom:yyyy-MM-dd}"))!;
        Assert.Equal(250, Assert.Single(price.Charges).Rate);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var audit = await db.Set<PropertyChange>().SingleAsync(x => x.TargetId == policy.Id && x.Action == "Updated");
        Assert.Equal(w.Actor, audit.ActorId); Assert.Contains("100", audit.Before!); Assert.Contains("250", audit.After);
        Assert.Equal(input.Reason, audit.Reason);
        Assert.Equal(1, await db.Set<BillingPolicy>().CountAsync(x => x.Id == policy.Id));
    }

    [Fact]
    public async Task EffectiveOrUsedFuturePoliciesStayLockedAndUsageCannotBeCleared()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var active = await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 100));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/billing-policies/{active.Id}",
            new PolicyUpdate(Rent(w.Location.Id, 200, Today.AddDays(5)), active.Version))).StatusCode);
        var usedInput = Rent(w.Location.Id, 200, Today.AddDays(10), type: w.Type.Id);
        var used = await Created<PolicyDto>(owner, "billing-policies", usedInput);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var entity = await db.Set<BillingPolicy>().SingleAsync(x => x.Id == used.Id);
        entity.RecordUsage(DateTimeOffset.UtcNow); await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/billing-policies/{used.Id}",
            new PolicyUpdate(usedInput with { Rate = 300 }, used.Version))).StatusCode);
        Assert.NotNull((await owner.GetFromJsonAsync<PolicyDto>($"/api/v1/billing-policies/{used.Id}"))!.FirstUsedAt);
        foreach (var field in new[] { "\"FirstUsedAt\" = NULL", "\"FirstUsedAt\" = now() + interval '1 day'", "\"Rate\" = 1" })
        {
            // Only test-owned identifiers and fixed SQL fragments are interpolated here.
            var error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(
                "UPDATE \"BillingPolicies\" SET " + field + " WHERE \"Id\" = {0}", used.Id));
            Assert.Equal("23514", error.SqlState);
        }
        var rollback = await Assert.ThrowsAsync<PostgresException>(() => db.GetService<IMigrator>()
            .MigrateAsync("20261030023603_SingleSystemChain"));
        Assert.Equal("P0001", rollback.SqlState);
        Assert.NotNull((await db.Set<BillingPolicy>().AsNoTracking().SingleAsync(x => x.Id == used.Id)).FirstUsedAt);
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task FutureEditsValidateDatesAmountAndImmutableScope()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var input = Rent(w.Location.Id, 100, Today.AddDays(5));
        var policy = await Created<PolicyDto>(owner, "billing-policies", input);
        foreach (var invalid in new[] { input with { Rate = -1 }, input with { EffectiveFrom = Today },
                     input with { EffectiveFrom = Today.AddDays(-1) }, input with { EffectiveTo = Today },
                     input with { ChargeCode = "OTHER" }, input with { RoomId = w.Room.Id },
                     input with { Rate = 0.00001m }, input with { LocationId = Guid.NewGuid() } })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"/api/v1/billing-policies/{policy.Id}",
                new PolicyUpdate(invalid, policy.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/billing-policies/{policy.Id}",
            new PolicyUpdate(input with { Rate = 200 }, policy.Version + 1))).StatusCode);
        Assert.Equal(policy, await owner.GetFromJsonAsync<PolicyDto>($"/api/v1/billing-policies/{policy.Id}"));
    }

    [Fact]
    public async Task ParallelFutureEditsHaveOneWinnerAndOverlappingEditRollsBackAudit()
    {
        var w = await Workspace(); using var owner = w.Owner;
        var start = Today.AddDays(5);
        var input = Rent(w.Location.Id, 100, start, start.AddDays(4));
        var policy = await Created<PolicyDto>(owner, "billing-policies", input);
        await Created<PolicyDto>(owner, "billing-policies", Rent(w.Location.Id, 900, start.AddDays(5)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/billing-policies/{policy.Id}",
            new PolicyUpdate(input with { EffectiveTo = null, Rate = 50 }, policy.Version))).StatusCode);
        Assert.Equal(policy, await owner.GetFromJsonAsync<PolicyDto>($"/api/v1/billing-policies/{policy.Id}"));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            Assert.False(await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Set<PropertyChange>()
                .AnyAsync(x => x.TargetId == policy.Id && x.Action == "Updated"));
        var writes = await Task.WhenAll(new[] { 200m, 300m }.Select(rate => owner.PutAsJsonAsync($"/api/v1/billing-policies/{policy.Id}",
            new PolicyUpdate(input with { Rate = rate }, policy.Version))));
        Assert.Single(writes, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(writes, x => x.StatusCode == HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task FuturePriceEditIsOwnerOnly(string role)
    {
        var account = await Client(role); using var client = account.Client;
        var id = Guid.NewGuid(); var body = new PolicyUpdate(Rent(Guid.NewGuid(), 100, Today.AddDays(5)), 1);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync($"/api/v1/billing-policies/{id}", body)).StatusCode);
        using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PutAsJsonAsync($"/api/v1/billing-policies/{id}", body)).StatusCode);
    }

    [Fact]
    public async Task MigrationPreservesLegacyRoomWithoutInventingOccupancyOrRoomType()
    {
        var admin = new NpgsqlConnectionStringBuilder(fixture.Factory.ConnectionString) { Database = "postgres" };
        var database = "bhome_property_migration_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(admin.ConnectionString); await connection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", connection)) await create.ExecuteNonQueryAsync();
        try
        {
            var settings = new NpgsqlConnectionStringBuilder(admin.ConnectionString) { Database = database };
            await using var db = new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(settings.ConnectionString).Options);
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("20261029032454_CaptureWorkflowsMerged");
            var location = Guid.NewGuid(); var room = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "Locations" ("Id","Name","Address","IsActive","CreatedAt","UpdatedAt")
                VALUES ({location}, 'Legacy location', '', true, now(), now());
                INSERT INTO "Rooms" ("Id","LocationId","RoomNumber","CreatedAt","UpdatedAt")
                VALUES ({room}, {location}, 'LEGACY-01', now(), now());
                """);
            await migrator.MigrateAsync();
            var preserved = await db.Set<Room>().AsNoTracking().SingleAsync(x => x.Id == room);
            Assert.Equal("LEGACY-01", preserved.RoomNumber); Assert.Null(preserved.RoomTypeId);
            Assert.Equal(RoomStatus.Unavailable, preserved.Status); Assert.Equal(1, preserved.Capacity); Assert.Equal(1, preserved.Version);
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            await migrator.MigrateAsync("20261029032454_CaptureWorkflowsMerged");
            Assert.Equal("LEGACY-01", await db.Database.SqlQuery<string>($"SELECT \"RoomNumber\" AS \"Value\" FROM \"Rooms\" WHERE \"Id\" = {room}").SingleAsync());
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{database}\" WITH (FORCE)", connection); await drop.ExecuteNonQueryAsync();
        }
    }
}
