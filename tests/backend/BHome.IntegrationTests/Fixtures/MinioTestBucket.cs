using Minio;
using Minio.DataModel.Args;
using Minio.Exceptions;

namespace BHome.IntegrationTests.Fixtures;

internal static class MinioTestBucket
{
    // Liveness and a completed MakeBucketAsync are insufficient: SDK 6 can
    // return without an acknowledgement after a transport failure. Retry only
    // dependency provisioning, before any business command or assertion runs.
    public static async Task CreateAsync(IMinioClient client, string bucket, CancellationToken token)
    {
        var bytes = "BHOME synthetic storage readiness"u8.ToArray();
        var key = "fixture-readiness/" + Guid.NewGuid().ToString("N");
        string lastFailure = "bucket_not_confirmed";
        try
        {
            while (true)
            {
                token.ThrowIfCancellationRequested();
                try
                {
                    if (!await client.BucketExistsAsync(new BucketExistsArgs().WithBucket(bucket), token))
                        await client.MakeBucketAsync(new MakeBucketArgs().WithBucket(bucket), token);
                    if (await client.BucketExistsAsync(new BucketExistsArgs().WithBucket(bucket), token))
                    {
                        using var stream = new MemoryStream(bytes, false);
                        var response = await client.PutObjectAsync(new PutObjectArgs().WithBucket(bucket).WithObject(key)
                            .WithStreamData(stream).WithObjectSize(bytes.Length).WithContentType("text/plain"), token);
                        if (response is not null && !string.IsNullOrWhiteSpace(response.Etag) && response.Size == bytes.Length)
                        {
                            var stored = await client.StatObjectAsync(new StatObjectArgs().WithBucket(bucket).WithObject(key), token);
                            if (stored is not null && stored.Size == bytes.Length)
                            {
                                await client.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(bucket).WithObject(key), token);
                                return;
                            }
                        }
                        lastFailure = "probe_not_confirmed";
                    }
                }
                catch (MinioException error) { lastFailure = error.GetType().Name; }
                catch (HttpRequestException error) { lastFailure = error.GetType().Name; }
                await Task.Delay(TimeSpan.FromMilliseconds(200), token);
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // Do not include SDK messages: they may contain signed requests.
            throw new TimeoutException($"Disposable MinIO bucket did not become writable ({lastFailure}).");
        }
    }
}
