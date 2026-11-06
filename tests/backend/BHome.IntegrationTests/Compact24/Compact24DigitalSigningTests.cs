using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.DigitalSigning.Application.Contracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Compact24;

// Signature picture and the Owner's Viettel MySign account through the real API on the 24-table database: no new
// table, the picture in object storage, the client secret encrypted in users.business_profile.
[Trait("Category", "CompactPostgres")]
public sealed class Compact24DigitalSigningTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Image = "/api/v1/digital-signing/signature-image";
    private const string Viettel = "/api/v1/digital-signing/settings/viettel";
    private readonly Compact24WorkflowFixture.TestObjectStorage storage = new();

    private WebApplicationFactory<Program> Host() => fixture.Factory!.WithWebHostBuilder(b =>
    {
        b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DigitalSigning:SecretKey"] = "synthetic-signing-secret-key-0123456789abcdef"
        }));
        b.ConfigureServices(s => { s.RemoveAll<IObjectStorage>(); s.AddSingleton<IObjectStorage>(storage); });
    });

    private static async Task<HttpClient> User(WebApplicationFactory<Program> host, string role)
    {
        const string password = "Synthetic-Signing!874";
        var id = Guid.NewGuid(); var email = $"{id:N}@example.invalid";
        await using (var scope = host.Services.CreateAsyncScope())
            email = (await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { Id = id, UserName = email, Email = email, IsActive = true }, role, password)).Email!;
        var client = host.CreateClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password }); login.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return client;
    }

    [CompactPostgresFact]
    public async Task SignerKeepsOnePictureGeneratedOrUploadedAndRefusedPicturesSayWhy()
    {
        await using var host = Host();
        var tenant = await User(host, "Tenant");
        Assert.False((await tenant.GetFromJsonAsync<SignatureImageView>(Image))!.Present);

        var generated = await tenant.PostAsJsonAsync(Image + "/generate", new { name = "Trần Thị Bích" });
        Assert.True(generated.IsSuccessStatusCode, await generated.Content.ReadAsStringAsync());
        var view = (await generated.Content.ReadFromJsonAsync<SignatureImageView>())!;
        Assert.True(view.Present);
        var png = await tenant.GetByteArrayAsync(Image + "/content");
        Assert.True(png.AsSpan(1, 3).SequenceEqual("PNG"u8));

        // An opaque picture (colour type 2, no tRNS) would hide the page text under it.
        var opaque = new byte[64]; new SignaturePictureGenerator().FromName("Tên Thử").AsSpan(0, 33).CopyTo(opaque); opaque[25] = 2;
        var refused = await tenant.PutAsync(Image, new ByteArrayContent(opaque) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("nền trong suốt", await refused.Content.ReadAsStringAsync());

        var upload = await tenant.PutAsync(Image, new ByteArrayContent(png) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } });
        Assert.True(upload.IsSuccessStatusCode, await upload.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await tenant.DeleteAsync(Image)).StatusCode);
        Assert.False((await tenant.GetFromJsonAsync<SignatureImageView>(Image))!.Present);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync(Image + "/content")).StatusCode);

        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.True(await db.IsSchemaReadyAsync());
    }

    [CompactPostgresFact]
    public async Task OwnerSavesViettelAccountEncryptedAndOnlyTheOwnerSeesIt()
    {
        await using var host = Host();
        var owner = await User(host, "Owner");
        var tenant = await User(host, "Tenant");
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(Viettel)).StatusCode);

        const string secret = "SYNTHETIC-client-secret-9f3a";
        var saved = await owner.PutAsJsonAsync(Viettel, new SaveViettelSettings("https://remotesigning.viettel.vn",
            "synthetic-client", null, secret, false));
        Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());
        var view = (await saved.Content.ReadFromJsonAsync<ViettelSettingsView>())!;
        Assert.Equal("synthetic-client", view.ClientId);
        Assert.Equal("DATABASE", view.SecretSource);
        Assert.Equal("9f3a", view.SecretHint);
        Assert.DoesNotContain(secret, await (await owner.GetAsync(Viettel)).Content.ReadAsStringAsync());

        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var stored = await db.Database.SqlQuery<string>(
                $"SELECT (business_profile->'digitalSigning'->'viettel')::text AS \"Value\" FROM users WHERE 'Owner' = ANY(roles)").SingleAsync();
            Assert.Contains("synthetic-client", stored);
            Assert.DoesNotContain(secret, stored);
        }

        // A blank secret keeps the stored one; reset goes back to the server configuration.
        var kept = (await (await owner.PutAsJsonAsync(Viettel, new SaveViettelSettings(null, "synthetic-client-2", null, null, false)))
            .Content.ReadFromJsonAsync<ViettelSettingsView>())!;
        Assert.Equal("9f3a", kept.SecretHint);
        var reset = (await (await owner.DeleteAsync(Viettel)).Content.ReadFromJsonAsync<ViettelSettingsView>())!;
        Assert.NotEqual("DATABASE", reset.SecretSource);
        Assert.NotEqual("DATABASE", reset.ClientIdSource);
    }
}
