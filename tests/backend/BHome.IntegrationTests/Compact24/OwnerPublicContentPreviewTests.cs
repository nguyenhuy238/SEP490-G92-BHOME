using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
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
