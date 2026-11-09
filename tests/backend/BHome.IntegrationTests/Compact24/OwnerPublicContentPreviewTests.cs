using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.LocalDevelopment;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class OwnerPublicContentPreviewTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
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
