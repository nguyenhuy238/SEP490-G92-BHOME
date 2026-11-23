using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.LocalDevelopment;
using OpenCvSharp;
using Npgsql;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence.Compact24.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class OwnerPublicContentPreviewTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    private static readonly Guid LocationId = Compact24SampleSeed.Id(10);
    private static readonly Guid RoomId = Compact24SampleSeed.Id(40);
    private static string LocationRoot => $"/api/v1/public-content/locations/{LocationId}";
    private static string RoomRoot => $"/api/v1/public-content/rooms/{RoomId}";
    private static string GuestLocation => $"/api/v1/public/locations/{LocationId}";
    private static string GuestRoom => $"/api/v1/public/rooms/{RoomId}";

    private async Task<HttpClient> Setup()
    {
        await Compact24SampleSeed.RunAsync(fixture.Capture.Factory.Services, "Development", WorkflowTestUsers.Password);
        var owner = await Login("owner.sample@example.invalid");
        (await owner.PostAsync(LocationRoot + "/unpublish", null)).EnsureSuccessStatusCode();
        await Sql("UPDATE locations SET is_active=true WHERE id=@id", LocationId);
        await Sql("UPDATE rooms SET status=0 WHERE id=@id", RoomId);
        (await owner.PutAsJsonAsync(LocationRoot, new LocationPublicContentWrite("Approved location", ["Wifi"], null, "public@example.invalid"))).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync(RoomRoot, new RoomPublicContentWrite("Approved room", ["Wifi"], 2500000))).EnsureSuccessStatusCode();
        return owner;
    }
    private async Task Sql(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection); command.Parameters.AddWithValue("id", id); await command.ExecuteNonQueryAsync();
    }

    [CompactPostgresFact]
    public async Task RoomBulkPreservesExistingDraftAndReportsEachTargetWithoutPublishing()
    {
        using var owner = await Setup();
        using var staff = await Login("staff.sample@example.invalid");
        using var guest = fixture.Capture.Factory.CreateClient();
        var endpoint = LocationRoot + "/rooms/bulk";
        var original = (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!;
        var missing = Guid.NewGuid();
        var selected = new[]
        {
            new PublicRoomBulkTarget(RoomId, original.Version),
            new PublicRoomBulkTarget(missing, 1)
        };
        var fill = new PublicRoomBulkRequest(selected, "Manual", null, null,
            ["description", "amenities"], true, "Shared approved description", ["Parking"]);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await staff.PostAsJsonAsync(endpoint + "/preview", fill)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await guest.PostAsJsonAsync(endpoint + "/apply", fill)).StatusCode);
        var preserve = (await (await owner.PostAsJsonAsync(endpoint + "/preview", fill))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Skipped", preserve.Rooms[0].Status);
        Assert.Equal("Conflict", preserve.Rooms[1].Status);
        Assert.Equal("Approved room", (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!.Description);

        var overwrite = fill with { FillEmptyOnly = false };
        var preview = (await (await owner.PostAsJsonAsync(endpoint + "/preview", overwrite))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Ready", preview.Rooms[0].Status);
        Assert.Equal("Conflict", preview.Rooms[1].Status);
        Assert.Contains(preview.Rooms[0].Changes, x => x.Field == "description" &&
            x.OldValue == "Approved room" && x.NewValue == "Shared approved description" && x.Conflict);
        var result = (await (await owner.PostAsJsonAsync(endpoint + "/apply", overwrite with
        {
            PreviewHash = preview.PreviewHash
        })).Content.ReadFromJsonAsync<PublicRoomBulkResult>())!;
        Assert.Equal("Applied", result.Rooms[0].Status);
        Assert.Equal("Conflict", result.Rooms[1].Status);
        Assert.Equal("Shared approved description", (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!.Description);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestRoom)).StatusCode);
        var repeated = (await (await owner.PostAsJsonAsync(endpoint + "/apply", overwrite with
        {
            PreviewHash = preview.PreviewHash
        })).Content.ReadFromJsonAsync<PublicRoomBulkResult>())!;
        Assert.Equal("Conflict", repeated.Rooms[0].Status);
        Assert.Equal("stale_version", repeated.Rooms[0].Issue);
        Assert.Equal("Shared approved description", (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!.Description);
    }

    [CompactPostgresFact]
    public async Task RoomBulkSourceVersionPreventsCopyingStaleRoomData()
    {
        using var owner = await Setup();
        var rooms = (await owner.GetFromJsonAsync<RoomPublicContent[]>(LocationRoot + "/rooms"))!;
        var source = Assert.Single(rooms, x => x.RoomId == RoomId);
        var target = rooms.First(x => x.RoomId != RoomId);
        var input = new PublicRoomBulkRequest([new(target.RoomId, target.Version)], "Room",
            source.RoomId, source.Version, ["description", "amenities"], false);
        var endpoint = LocationRoot + "/rooms/bulk";
        var preview = (await (await owner.PostAsJsonAsync(endpoint + "/preview", input))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Ready", Assert.Single(preview.Rooms).Status);
        var applied = (await (await owner.PostAsJsonAsync(endpoint + "/apply",
            input with { PreviewHash = preview.PreviewHash })).Content.ReadFromJsonAsync<PublicRoomBulkResult>())!;
        Assert.Equal("Applied", Assert.Single(applied.Rooms).Status);
        Assert.Equal("Approved room", (await owner.GetFromJsonAsync<RoomPublicContent>(
            $"/api/v1/public-content/rooms/{target.RoomId}"))!.Description);

        (await owner.PutAsJsonAsync(RoomRoot, new RoomPublicContentWrite("New source", ["Parking"], 2000000)))
            .EnsureSuccessStatusCode();
        var currentTarget = (await owner.GetFromJsonAsync<RoomPublicContent>(
            $"/api/v1/public-content/rooms/{target.RoomId}"))!;
        var staleRequest = input with { Targets = [new(target.RoomId, currentTarget.Version)] };
        var stale = (await (await owner.PostAsJsonAsync(endpoint + "/preview", staleRequest))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Conflict", Assert.Single(stale.Rooms).Status);
        Assert.Equal("stale_source_version", Assert.Single(stale.Rooms).Issue);
        Assert.Equal("Approved room", (await owner.GetFromJsonAsync<RoomPublicContent>(
            $"/api/v1/public-content/rooms/{target.RoomId}"))!.Description);
    }

    [CompactPostgresFact]
    public async Task BulkPublicationRequiresParentAndExplicitApprovalAndCanHideRoom()
    {
        using var owner = await Setup();
        using var guest = fixture.Capture.Factory.CreateClient();
        var endpoint = LocationRoot + "/rooms/bulk";
        var room = (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!;
        var publish = new PublicRoomBulkRequest([new(RoomId, room.Version)], "Publish",
            null, null, [], true);
        var blocked = (await (await owner.PostAsJsonAsync(endpoint + "/preview", publish))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("public_location_not_published", Assert.Single(blocked.Rooms).Issue);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestRoom)).StatusCode);

        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        var approval = (await (await owner.PostAsJsonAsync(endpoint + "/preview", publish))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Ready", Assert.Single(approval.Rooms).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestRoom)).StatusCode);
        var publishing = await owner.PostAsJsonAsync(endpoint + "/apply",
            publish with { PreviewHash = approval.PreviewHash });
        var published = (await publishing.Content.ReadFromJsonAsync<PublicRoomBulkResult>())!;
        Assert.Equal("Applied", Assert.Single(published.Rooms).Status);
        Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync(GuestRoom)).StatusCode);

        (await owner.PutAsJsonAsync(RoomRoot, new RoomPublicContentWrite(
            "Nội dung mới sau khi đã đăng", ["Wifi"], 2200000))).EnsureSuccessStatusCode();
        var oldPublic = (await guest.GetFromJsonAsync<RoomPublicContent>(GuestRoom))!;
        Assert.Equal("Approved room", oldPublic.Description);
        room = (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!;
        var republish = publish with { Targets = [new(RoomId, room.Version)] };
        var updatePreview = (await (await owner.PostAsJsonAsync(endpoint + "/preview", republish))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Ready", Assert.Single(updatePreview.Rooms).Status);
        var refresh = await owner.PostAsJsonAsync(endpoint + "/apply",
            republish with { PreviewHash = updatePreview.PreviewHash });
        refresh.EnsureSuccessStatusCode();
        Assert.Equal("Nội dung mới sau khi đã đăng",
            (await guest.GetFromJsonAsync<RoomPublicContent>(GuestRoom))!.Description);

        room = (await owner.GetFromJsonAsync<RoomPublicContent>(RoomRoot))!;
        var unpublish = new PublicRoomBulkRequest([new(RoomId, room.Version)], "Unpublish",
            null, null, [], true);
        var removal = (await (await owner.PostAsJsonAsync(endpoint + "/preview", unpublish))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Ready", Assert.Single(removal.Rooms).Status);
        var hiding = await owner.PostAsJsonAsync(endpoint + "/apply",
            unpublish with { PreviewHash = removal.PreviewHash });
        var hidden = (await hiding.Content.ReadFromJsonAsync<PublicRoomBulkResult>())!;
        Assert.Equal("Applied", Assert.Single(hidden.Rooms).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestRoom)).StatusCode);
    }

    [CompactPostgresFact]
    public async Task RoomDefaultsBulkAppliesOnlyToMatchingRoomsAndIsIdempotent()
    {
        using var owner = await Setup();
        var defaultsResponse = await owner.PostAsJsonAsync(
            $"/api/v1/locations/{LocationId}/room-defaults",
            new LocalRoomDefaultsWrite("FE09 Studio", "Gợi ý studio", new SharedRoomDefaults(
                2, 20m, ["Wifi", "Máy lạnh"], 2300000m), null));
        defaultsResponse.EnsureSuccessStatusCode();
        var defaults = (await defaultsResponse.Content.ReadFromJsonAsync<SetupDocument>())!;

        var roomResponse = await owner.PostAsJsonAsync("/api/v1/rooms", new RoomWrite(
            LocationId, "FE09-ROOM", null, 2, RoomStatus.Available, Reason: "FE09 test"));
        roomResponse.EnsureSuccessStatusCode();
        var physical = (await roomResponse.Content.ReadFromJsonAsync<RoomDto>())!;

        var configure = await owner.PutAsJsonAsync(
            $"/api/v1/locations/{LocationId}/rooms/{physical.Id}/configuration",
            new RoomConfigurationEdit(physical.RoomNumber, physical.Floor, physical.Capacity,
                RoomStatus.Available, physical.Version, 0, "Associate FE09 studio",
                defaults.Id, defaults.Version));
        configure.EnsureSuccessStatusCode();

        var page = $"/api/v1/public-content/rooms/{physical.Id}";
        var room = (await owner.GetFromJsonAsync<RoomPublicContent>(page))!;
        var request = new PublicRoomBulkRequest([new(physical.Id, room.Version)], "RoomDefaults",
            defaults.Id, defaults.Version, ["description", "amenities", "indicativePrice"], true);
        var endpoint = LocationRoot + "/rooms/bulk";
        var previewResponse = await owner.PostAsJsonAsync(endpoint + "/preview", request);
        Assert.True(previewResponse.IsSuccessStatusCode,
            $"Preview returned {previewResponse.StatusCode}: {await previewResponse.Content.ReadAsStringAsync()}");
        var preview = (await previewResponse.Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Ready", Assert.Single(preview.Rooms).Status);
        Assert.Equal(3, Assert.Single(preview.Rooms).Changes.Count);

        var result = (await (await owner.PostAsJsonAsync(endpoint + "/apply", request with
        {
            PreviewHash = preview.PreviewHash
        })).Content.ReadFromJsonAsync<PublicRoomBulkResult>())!;
        Assert.Equal("Applied", Assert.Single(result.Rooms).Status);
        var updated = (await owner.GetFromJsonAsync<RoomPublicContent>(page))!;
        Assert.Equal("Gợi ý studio", updated.Description);
        Assert.Equal(["Wifi", "Máy lạnh"], updated.Amenities);
        Assert.Equal(2300000m, updated.IndicativePrice);
        Assert.False(updated.Published);

        var repeat = request with { Targets = [new(physical.Id, updated.Version)] };
        var secondPreview = (await (await owner.PostAsJsonAsync(endpoint + "/preview", repeat))
            .Content.ReadFromJsonAsync<PublicRoomBulkPreview>())!;
        Assert.Equal("Skipped", Assert.Single(secondPreview.Rooms).Status);
        Assert.Equal(updated.Version, (await owner.GetFromJsonAsync<RoomPublicContent>(page))!.Version);
    }

    [CompactPostgresFact]
    public async Task SnapshotBackfillPreservesExistingPublicationAndIsRepeatable()
    {
        using var owner = await Setup(); using var guest = fixture.Capture.Factory.CreateClient();
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        await Sql("UPDATE locations SET public_profile=public_profile-'published' WHERE id=@id", LocationId);
        var before = await guest.GetStringAsync(GuestLocation);
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(fixture.Connection).Options);
        var commands = db.GetService<IMigrationsSqlGenerator>().Generate(new PublicContentSnapshots().UpOperations, db.Model);
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        for (var run = 0; run < 2; run++)
            foreach (var command in commands)
            {
                await using var sql = new NpgsqlCommand(command.CommandText, connection); await sql.ExecuteNonQueryAsync();
            }
        Assert.Equal(before, await guest.GetStringAsync(GuestLocation));
        (await owner.PutAsJsonAsync(LocationRoot, new LocationPublicContentWrite("After upgrade draft", [], null, "public@example.invalid"))).EnsureSuccessStatusCode();
        Assert.Equal(before, await guest.GetStringAsync(GuestLocation));
    }

    [CompactPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DraftAndHiddenArePrivateAndPublishedSnapshotsChangeOnlyOnPublish(bool room)
    {
        using var owner = await Setup(); using var guest = fixture.Capture.Factory.CreateClient();
        var root = room ? RoomRoot : LocationRoot; var url = room ? GuestRoom : GuestLocation;
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(url)).StatusCode);
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        (await owner.PostAsync(root + "/publish", null)).EnsureSuccessStatusCode();
        var before = await guest.GetStringAsync(url);
        var update = room
            ? await owner.PutAsJsonAsync(root, new RoomPublicContentWrite("New draft room", ["Parking"], 3000000))
            : await owner.PutAsJsonAsync(root, new LocationPublicContentWrite("New draft location", ["Parking"], null, "next@example.invalid"));
        update.EnsureSuccessStatusCode();
        Assert.Equal(before, await guest.GetStringAsync(url));
        Assert.Contains("New draft", await owner.GetStringAsync(root));
        (await owner.PostAsync(root + "/publish", null)).EnsureSuccessStatusCode();
        Assert.Contains("New draft", await guest.GetStringAsync(url));
        (await owner.PostAsync(root + "/unpublish", null)).EnsureSuccessStatusCode();
        (await owner.PostAsync(root + "/unpublish", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(url)).StatusCode);
        Assert.Contains("New draft", await owner.GetStringAsync(root));
        if (room) (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        (await owner.PostAsync(root + "/publish", null)).EnsureSuccessStatusCode();
        (await owner.PostAsync(root + "/publish", null)).EnsureSuccessStatusCode();
        Assert.Contains("New draft", await guest.GetStringAsync(url));
    }

    [CompactPostgresFact]
    public async Task ParentPublicationAndOperationGateEveryRoomRoute()
    {
        using var owner = await Setup(); using var guest = fixture.Capture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync(RoomRoot + "/publish", null)).StatusCode);
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        (await owner.PostAsync(RoomRoot + "/publish", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync(GuestRoom)).StatusCode);
        await Sql("UPDATE locations SET is_active=false WHERE id=@id", LocationId);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestRoom)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestLocation)).StatusCode);
        Assert.Empty((await guest.GetFromJsonAsync<RoomPublicContent[]>(GuestLocation + "/rooms"))!);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync(LocationRoot + "/publish", null)).StatusCode);
        await Sql("UPDATE locations SET is_active=true WHERE id=@id", LocationId);
        (await owner.PostAsync(LocationRoot + "/unpublish", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(GuestRoom)).StatusCode);
        Assert.Empty((await guest.GetFromJsonAsync<RoomPublicContent[]>(GuestLocation + "/rooms"))!);
    }

    [CompactPostgresTheory]
    [InlineData(0, "Available")]
    [InlineData(1, "OnHold")]
    [InlineData(2, "Occupied")]
    [InlineData(3, "Unavailable")]
    public async Task VacancyUsesLiveBackendRoomStatus(int status, string expected)
    {
        using var owner = await Setup(); using var guest = fixture.Capture.Factory.CreateClient();
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        (await owner.PostAsync(RoomRoot + "/publish", null)).EnsureSuccessStatusCode();
        await Sql($"UPDATE rooms SET status={status} WHERE id=@id", RoomId);
        Assert.Equal(expected, (await guest.GetFromJsonAsync<RoomPublicContent>(GuestRoom))!.Vacancy);
        await Sql("UPDATE rooms SET status=0 WHERE id=@id", RoomId);
    }

    [CompactPostgresFact]
    public async Task WhitelistAuthorizationAndNoStoreAreEnforced()
    {
        using var owner = await Setup(); using var guest = fixture.Capture.Factory.CreateClient(); using var staff = await Login("staff.sample@example.invalid");
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync(LocationRoot)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(LocationRoot)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsync(RoomRoot + "/publish", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(LocationRoot, new { summary = "x", amenities = new[] { "Wifi" }, tenantId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(RoomRoot, new RoomPublicContentWrite("x", [], -1))).StatusCode);
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        var response = await guest.GetAsync(GuestLocation);
        Assert.True(response.Headers.CacheControl!.NoStore);
        var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(new[] { "address", "amenities", "contactEmail", "contactPhone", "locationId", "name", "photos", "publicationStatus", "published", "publishedAt", "summary" }, json.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray());
    }

    [CompactPostgresFact]
    public async Task AlbumOrderIsDraftOnlyAndDeletionRevokesStablePhotoUrl()
    {
        using var owner = await Setup(); using var guest = fixture.Capture.Factory.CreateClient();
        // Remove leftovers so this test owns its complete synthetic album.
        var initial = (await owner.GetFromJsonAsync<LocationPublicContent>(LocationRoot))!;
        foreach (var photo in initial.Photos) (await owner.DeleteAsync(LocationRoot + $"/photos/{photo.Index}")).EnsureSuccessStatusCode();
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        async Task<LocationPublicContent> Upload()
        {
            using var content = new ByteArrayContent(image.ImEncode(".png")); content.Headers.ContentType = new("image/png");
            var response = await owner.PutAsync(LocationRoot + "/photos", content); response.EnsureSuccessStatusCode();
            return (await response.Content.ReadFromJsonAsync<LocationPublicContent>())!;
        }
        await Upload(); var album = await Upload(); var indices = album.Photos.Select(p => p.Index).ToArray();
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        var next = await Upload(); var added = next.Photos.Last();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(added.Url)).StatusCode);
        var order = next.Photos.Select(p => p.Index).Reverse().ToArray();
        (await owner.PutAsJsonAsync(LocationRoot, new LocationPublicContentWrite("Approved location", [], null, "public@example.invalid", order))).EnsureSuccessStatusCode();
        Assert.Equal(indices, (await guest.GetFromJsonAsync<LocationPublicContent>(GuestLocation))!.Photos.Select(p => p.Index));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(LocationRoot, new LocationPublicContentWrite("Approved", [], null, "public@example.invalid", [99999]))).StatusCode);
        (await owner.PostAsync(LocationRoot + "/publish", null)).EnsureSuccessStatusCode();
        Assert.Equal(order, (await guest.GetFromJsonAsync<LocationPublicContent>(GuestLocation))!.Photos.Select(p => p.Index));
        var removed = next.Photos[0];
        (await owner.DeleteAsync(LocationRoot + $"/photos/{removed.Index}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(removed.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync(added.Url)).StatusCode);
        var after = await Upload(); Assert.True(after.Photos.Last().Index > added.Index);
        (await owner.PostAsync(LocationRoot + "/unpublish", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(added.Url)).StatusCode);
    }

    [CompactPostgresFact]
    public async Task UnpublishedPhotoPreviewIsOwnerOnlyAndPublicPublicationRemainsIndependent()
    {
        await Compact24SampleSeed.RunAsync(fixture.Capture.Factory.Services, "Development", WorkflowTestUsers.Password);
        using var owner = await Login("owner.sample@example.invalid");
        using var staff = await Login("staff.sample@example.invalid");
        using var guest = fixture.Capture.Factory.CreateClient();
        var id = Compact24SampleSeed.Id(10);
        var root = $"/api/v1/public-content/locations/{id}";
        (await owner.PostAsync(root + "/unpublish", null)).EnsureSuccessStatusCode();
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        var bytes = image.ImEncode(".png");
        using var content = new ByteArrayContent(bytes); content.Headers.ContentType = new("image/png");
        var upload = await owner.PutAsync(root + "/photos", content); upload.EnsureSuccessStatusCode();
        var view = (await upload.Content.ReadFromJsonAsync<LocationPublicContent>())!;
        var index = view.Photos.Last().Index;
        var preview = root + $"/photos/{index}";
        var publicPath = $"/api/v1/public/locations/{id}/photos/{index}";
        Assert.Equal(bytes, await owner.GetByteArrayAsync(preview));
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync(preview)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(preview)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(publicPath)).StatusCode);
        Assert.DoesNotContain("objectKey", await upload.Content.ReadAsStringAsync());
        (await owner.PutAsJsonAsync(root, new LocationPublicContentWrite("Synthetic approved public description", ["Wifi"], null, "public@example.invalid"))).EnsureSuccessStatusCode();
        (await owner.PostAsync(root + "/publish", null)).EnsureSuccessStatusCode();
        Assert.Equal(bytes, await guest.GetByteArrayAsync(publicPath));
        (await owner.PostAsync(root + "/unpublish", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(publicPath)).StatusCode);
        Assert.Equal(bytes, await owner.GetByteArrayAsync(preview));
    }
    private async Task<HttpClient> Login(string email)
    {
        var client = fixture.Capture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password });
        response.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return client;
    }
}
