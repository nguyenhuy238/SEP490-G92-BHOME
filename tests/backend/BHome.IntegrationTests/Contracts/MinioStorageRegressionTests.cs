using BHome.Application.Common;
using BHome.Infrastructure.Storage;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Docker")]
public sealed class MinioStorageRegressionTests : IAsyncLifetime
{
    private readonly string password = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    private IContainer container = null!;
    private MinioObjectStorage storage = null!;
    public async Task InitializeAsync()
    {
        container = new ContainerBuilder("bhome/minio-local:2025-10-15")
            .WithEnvironment("MINIO_ROOT_USER", "synthetic-test").WithEnvironment("MINIO_ROOT_PASSWORD", password)
            .WithCommand("server", "/data").WithPortBinding(9000, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(9000).ForPath("/minio/health/live"))).Build();
        await container.StartAsync();
        var endpoint = $"{container.Hostname}:{container.GetMappedPublicPort(9000)}";
        using var client = new MinioClient().WithEndpoint(endpoint).WithCredentials("synthetic-test", password).Build();
        await client.MakeBucketAsync(new MakeBucketArgs().WithBucket("storage-regression"));
        storage = new(Options.Create(new ObjectStorageOptions
        { Endpoint = endpoint, AccessKey = "synthetic-test", SecretKey = password, Bucket = "storage-regression", UseSsl = false }), NullLogger<MinioObjectStorage>.Instance);
    }
    public Task DisposeAsync() => container.DisposeAsync().AsTask();

    [Fact]
    public async Task PrivateBytesRoundTripAndMissingObjectIsExplicit()
    {
        var bytes = "%PDF-synthetic-private-storage"u8.ToArray();
        using var input = new MemoryStream(bytes);
        await storage.PutAsync("synthetic.pdf", input, bytes.Length, "application/pdf", default);
        using var output = new MemoryStream();
        await storage.CopyToAsync("synthetic.pdf", output, default);
        Assert.Equal(bytes, output.ToArray());
        await Assert.ThrowsAsync<FileNotFoundException>(() => storage.CopyToAsync("missing.pdf", output, default));
    }

    [Fact]
    public async Task OfflineStorageCannotReportSuccessfulUploadOrEmptyDownload()
    {
        await container.StopAsync();
        using var input = new MemoryStream("synthetic"u8.ToArray());
        using var output = new MemoryStream();
        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => storage.PutAsync("offline.pdf", input, input.Length, "application/pdf", default));
        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => storage.CopyToAsync("offline.pdf", output, default));
        Assert.Equal(0, output.Length);
    }
}
