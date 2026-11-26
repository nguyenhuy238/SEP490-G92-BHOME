using System.Net;
using BHome.IntegrationTests.Fixtures;
using Minio;

namespace BHome.IntegrationTests.Contracts;

public sealed class MinioTestBucketTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConfirmsBucketAndWrittenProbeBeforeReturning(bool failFirstCreation)
    {
        using var handler = new ProvisioningHandler(failFirstCreation);
        using var http = new HttpClient(handler);
        using var client = Client(http);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        await MinioTestBucket.CreateAsync(client, "synthetic-readiness", deadline.Token);

        Assert.Equal(failFirstCreation ? 2 : 1, handler.Creations);
        Assert.True(handler.ProbeConfirmed);
        Assert.True(handler.ProbeDeleted);
    }

    [Fact]
    public async Task UnavailableStorageFailsWithinDeadlineWithoutClaimingReadiness()
    {
        using var http = new HttpClient(new UnavailableHandler());
        using var client = Client(http);
        using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));

        var error = await Assert.ThrowsAsync<TimeoutException>(() => MinioTestBucket.CreateAsync(client, "synthetic-readiness", deadline.Token));

        Assert.Contains("did not become writable", error.Message);
        Assert.DoesNotContain("synthetic-secret", error.Message);
    }

    private static IMinioClient Client(HttpClient http) => new MinioClient().WithEndpoint("127.0.0.1:9000")
        .WithCredentials("synthetic-access", "synthetic-secret").WithRegion("us-east-1").WithHttpClient(http).Build();

    private sealed class UnavailableHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
            => throw new HttpRequestException("Synthetic transport failure");
    }

    private sealed class ProvisioningHandler(bool failFirstCreation) : HttpMessageHandler
    {
        private bool bucketExists;
        private byte[]? probe;
        public int Creations { get; private set; }
        public bool ProbeConfirmed { get; private set; }
        public bool ProbeDeleted { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            var isProbe = request.RequestUri!.AbsolutePath.Contains("/fixture-readiness/", StringComparison.Ordinal);
            var response = new HttpResponseMessage(HttpStatusCode.OK) { RequestMessage = request };
            if (!isProbe)
            {
                if (request.Method == HttpMethod.Put)
                {
                    Creations++;
                    // Reproduce the SDK's unacknowledged creation path, rather
                    // than assuming a completed Task means the bucket exists.
                    if (failFirstCreation && Creations == 1) throw new HttpRequestException("Synthetic startup failure");
                    bucketExists = true;
                }
                else if (!bucketExists) response.StatusCode = HttpStatusCode.NotFound;
            }
            else if (request.Method == HttpMethod.Put)
            {
                Assert.True(bucketExists);
                probe = await request.Content!.ReadAsByteArrayAsync(token);
                response.Headers.ETag = new("\"synthetic-etag\"");
            }
            else if (request.Method == HttpMethod.Head)
            {
                Assert.NotNull(probe);
                response.Content = new ByteArrayContent(probe);
                response.Content.Headers.ContentLength = probe.Length;
                response.Content.Headers.ContentType = new("text/plain");
                response.Content.Headers.LastModified = DateTimeOffset.UtcNow;
                response.Headers.ETag = new("\"synthetic-etag\"");
                ProbeConfirmed = true;
            }
            else if (request.Method == HttpMethod.Delete)
            {
                Assert.True(ProbeConfirmed);
                ProbeDeleted = true;
                response.StatusCode = HttpStatusCode.NoContent;
            }
            return response;
        }
    }
}
