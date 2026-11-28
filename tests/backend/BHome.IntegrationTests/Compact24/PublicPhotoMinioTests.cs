using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.Infrastructure.Storage;
using BHome.LocalDevelopment;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

public sealed class PublicPhotoMinioFixture : IAsyncLifetime
{
    private string password = "";
    private string endpoint = "";
    public IContainer Minio { get; private set; } = null!;
    public Compact24WorkflowFixture Workflow { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        password = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        // Docker may reassign an ephemeral mapping on restart. Pin the chosen
        // available port so the configured API endpoint survives the outage.
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        Minio = new ContainerBuilder("bhome/minio-local:2025-10-15")
            .WithEnvironment("MINIO_ROOT_USER", "synthetic-photo-test").WithEnvironment("MINIO_ROOT_PASSWORD", password)
            .WithAutoRemove(false)
            .WithCommand("server", "/data").WithPortBinding(port, 9000)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(9000).ForPath("/minio/health/live"))).Build();
        await Minio.StartAsync();
        endpoint = $"{Minio.Hostname}:{Minio.GetMappedPublicPort(9000)}";
        using var client = new MinioClient().WithEndpoint(endpoint).WithCredentials("synthetic-photo-test", password).Build();
        await client.MakeBucketAsync(new MakeBucketArgs().WithBucket("synthetic-public-photos"));
        var storage = new MinioObjectStorage(Options.Create(new ObjectStorageOptions
        {
            Endpoint = endpoint,
            AccessKey = "synthetic-photo-test",
            SecretKey = password,
            Bucket = "synthetic-public-photos",
            UseSsl = false
        }), NullLogger<MinioObjectStorage>.Instance);
        Workflow = new Compact24WorkflowFixture(storage);
        await Workflow.InitializeAsync();
    }

    public async Task AssertReadyAsync()
    {
        Assert.Equal(endpoint, $"{Minio.Hostname}:{Minio.GetMappedPublicPort(9000)}");
        using var client = new MinioClient().WithEndpoint(endpoint).WithCredentials("synthetic-photo-test", password).Build();
        Assert.True(await client.BucketExistsAsync(new BucketExistsArgs().WithBucket("synthetic-public-photos")));
    }

    // Testcontainers StopAsync/StartAsync recreates the container and random port.
    // Stop/start the same Docker container to model a real local storage outage.
    public async Task SetStorageRunningAsync(bool running)
    {
        var start = new ProcessStartInfo("docker") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(running ? "start" : "stop"); start.ArgumentList.Add(Minio.Id);
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync(); await Task.WhenAll(stdout, stderr);
        Assert.Equal(0, process.ExitCode);
        if (!running) return;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (true)
        {
            try { using var response = await http.GetAsync($"http://{endpoint}/minio/health/live", deadline.Token); if (response.IsSuccessStatusCode) break; }
            catch (HttpRequestException) { }
            catch (OperationCanceledException) when (!deadline.IsCancellationRequested) { }
            await Task.Delay(100, deadline.Token);
        }
        await AssertReadyAsync();
    }

    public async Task DisposeAsync()
    {
        if (Workflow is not null) await Workflow.DisposeAsync();
        if (Minio is not null) await Minio.DisposeAsync();
    }
}

[Trait("Category", "CompactPostgres")]
public sealed class PublicPhotoMinioTests(PublicPhotoMinioFixture fixture) : IClassFixture<PublicPhotoMinioFixture>
{
    [CompactPostgresTheory]
    [InlineData("locations", 10)]
    [InlineData("rooms", 40)]
    public async Task OfflineUploadDoesNotSaveMetadataAndRecoversThroughRealMinio(string target, int id)
    {
        await Compact24SampleSeed.RunAsync(fixture.Workflow.Capture.Factory.Services, "Development", WorkflowTestUsers.Password);
        using var owner = fixture.Workflow.Capture.Factory.CreateClient();
        var login = await owner.PostAsJsonAsync("/api/v1/auth/login", new { email = "owner.sample@example.invalid", password = WorkflowTestUsers.Password });
        login.EnsureSuccessStatusCode();
        owner.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        using var guest = fixture.Workflow.Capture.Factory.CreateClient();
        var location = $"/api/v1/public-content/locations/{Compact24SampleSeed.Id(10)}";
        (await owner.PostAsync(location + "/unpublish", null)).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync(location, new LocationPublicContentWrite("Synthetic approved location", [], null, "public@example.invalid"))).EnsureSuccessStatusCode();
        (await owner.PostAsync(location + "/publish", null)).EnsureSuccessStatusCode();
        var root = $"/api/v1/public-content/{target}/{Compact24SampleSeed.Id(id)}";
        if (target == "rooms")
            (await owner.PutAsJsonAsync(root, new RoomPublicContentWrite("Synthetic approved room", [], null))).EnsureSuccessStatusCode();
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        var bytes = image.ImEncode(".png");
        async Task<HttpResponseMessage> Upload()
        {
            using var content = new ByteArrayContent(bytes); content.Headers.ContentType = new("image/png");
            return await owner.PutAsync(root + "/photos", content);
        }
        await fixture.SetStorageRunningAsync(false);
        try
        {
            using var failed = await Upload();
            Assert.Equal(HttpStatusCode.ServiceUnavailable, failed.StatusCode);
            using var before = System.Text.Json.JsonDocument.Parse(await owner.GetStringAsync(root));
            Assert.Empty(before.RootElement.GetProperty("photos").EnumerateArray());
        }
        finally { await fixture.SetStorageRunningAsync(true); }

        using var uploaded = await Upload(); uploaded.EnsureSuccessStatusCode();
        using var album = System.Text.Json.JsonDocument.Parse(await uploaded.Content.ReadAsStringAsync());
        var photo = album.RootElement.GetProperty("photos").EnumerateArray().Single();
        var index = photo.GetProperty("index").GetInt32();
        var publicUrl = photo.GetProperty("url").GetString()!;
        Assert.DoesNotContain("objectKey", await uploaded.Content.ReadAsStringAsync());
        Assert.Equal(bytes, await owner.GetByteArrayAsync(root + $"/photos/{index}"));
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(publicUrl)).StatusCode);
        (await owner.PostAsync(root + "/publish", null)).EnsureSuccessStatusCode();
        Assert.Equal(bytes, await guest.GetByteArrayAsync(publicUrl));
        (await owner.PostAsync(root + "/unpublish", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync(publicUrl)).StatusCode);
        Assert.Equal(bytes, await owner.GetByteArrayAsync(root + $"/photos/{index}"));
        (await owner.DeleteAsync(root + $"/photos/{index}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(root + $"/photos/{index}")).StatusCode);
    }
}
