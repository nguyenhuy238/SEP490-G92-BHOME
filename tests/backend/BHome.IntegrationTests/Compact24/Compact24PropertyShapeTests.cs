using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24PropertyShapeTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task FreshDatabaseSupportsLocationRoomAndPricesWithoutChainOrRoomType()
    {
        const string password = "Synthetic!Property-493";
        ApplicationUser owner;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
            owner = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { UserName = "synthetic-property", Email = "synthetic-property@example.invalid" }, "Owner", password);
        using var client = fixture.Factory!.CreateClient();
        var loginResponse = await client.PostAsJsonAsync("/api/v1/auth/login", new { owner.Email, password });
        loginResponse.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new("Bearer", (await loginResponse.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        foreach (var path in new[] { "chain", "room-types", "capture/chains" })
        {
            var retiredEndpoint = await client.GetAsync("/api/v1/" + path);
            Assert.True(retiredEndpoint.StatusCode == HttpStatusCode.NotFound, path + ": " + retiredEndpoint.StatusCode);
        }
        var locationResponse = await client.PostAsJsonAsync("/api/v1/locations", new { name = "Synthetic fresh location", address = "Synthetic address" });
        Assert.Equal(HttpStatusCode.Created, locationResponse.StatusCode);
        var location = await locationResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(location.TryGetProperty("chainId", out _));
        var locationId = location.GetProperty("id").GetGuid();
        var roomResponse = await client.PostAsJsonAsync("/api/v1/rooms", new { locationId, roomNumber = "FRESH-01", capacity = 2 });
        Assert.True(roomResponse.StatusCode == HttpStatusCode.Created,
            roomResponse.StatusCode + ": " + string.Join(" | ", ApiFactory.Diagnostics.TakeLast(3)));
        var room = await roomResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(room.TryGetProperty("roomTypeId", out _));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/rooms", new
        { locationId, roomTypeId = Guid.NewGuid(), roomNumber = "RETIRED", capacity = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/rooms", new
        { locationId, RoomTypeId = (Guid?)null, roomNumber = "RETIRED-NULL", capacity = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/rooms", new
        { locationId, roomNumber = "UNKNOWN-FIELD", capacity = 2, ownerApproved = true })).StatusCode);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var policyResponse = await client.PostAsJsonAsync("/api/v1/billing-policies", new
        { locationId, category = 0, chargeCode = "RENT", name = "Synthetic rent", method = 0, rate = 1000000, effectiveFrom = today });
        Assert.Equal(HttpStatusCode.Created, policyResponse.StatusCode);
        var policy = await policyResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(policy.TryGetProperty("roomTypeId", out _));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/billing-policies", new
        { locationId, category = 1, chargeCode = "ELECTRICITY", name = "Synthetic unknown field", method = 1, rate = "3000.1250", effectiveFrom = today, ownerApproved = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/billing-policies", new
        { locationId, roomTypeId = (Guid?)null, category = 1, chargeCode = "ELECTRICITY", name = "Synthetic obsolete payload", method = 1, rate = "3000.1250", effectiveFrom = today })).StatusCode);
        var roomPrice = await client.PostAsJsonAsync("/api/v1/billing-policies", new
        { locationId, roomId = room.GetProperty("id").GetGuid(), category = 1, chargeCode = "ELECTRICITY", name = "Synthetic precise rate", method = 1, rate = "3000.1250", effectiveFrom = today });
        Assert.Equal(HttpStatusCode.Created, roomPrice.StatusCode);
        Assert.Equal(3000.1250m, decimal.Parse((await roomPrice.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("rate").GetString()!, System.Globalization.CultureInfo.InvariantCulture));
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        await using var count = new NpgsqlCommand("SELECT count(*) FROM information_schema.columns WHERE table_schema='public'", connection);
        Assert.Equal((long)BHome.Infrastructure.Persistence.Compact24.Compact24Schema.CurrentColumnCount, await count.ExecuteScalarAsync());
        await using var retired = new NpgsqlCommand("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('room_types','room_type_id','chain_id')", connection);
        Assert.Equal(0L, await retired.ExecuteScalarAsync());
        await using var chain = new NpgsqlCommand("SELECT count(*) FROM users WHERE business_profile ? 'chain'", connection);
        Assert.Equal(0L, await chain.ExecuteScalarAsync());
    }
}
