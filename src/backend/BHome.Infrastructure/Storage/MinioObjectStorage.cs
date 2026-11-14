using BHome.Application.Common;
using BHome.Application.Storage;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using Minio.Exceptions;

namespace BHome.Infrastructure.Storage;

internal sealed class MinioObjectStorage(IOptions<ObjectStorageOptions> options, ILogger<MinioObjectStorage> logger)
    : IObjectStorage
{
    private IMinioClient CreateClient()
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.AccessKey) || string.IsNullOrWhiteSpace(settings.SecretKey))
        {
            logger.LogWarning("Object storage credentials are unconfigured");
            throw new IntegrationUnavailableException("object storage");
        }
        return new MinioClient().WithEndpoint(settings.Endpoint)
            .WithCredentials(settings.AccessKey, settings.SecretKey).WithSSL(settings.UseSsl).Build();
    }

    public async Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken cancellationToken)
    {
        using var client = CreateClient();
        try
        {
            var response = await client.PutObjectAsync(new PutObjectArgs().WithBucket(options.Value.Bucket).WithObject(key)
                .WithStreamData(content).WithObjectSize(length).WithContentType(contentType), cancellationToken);
            // SDK 6 can return without throwing after a transport failure. A completed
            // Task alone is not evidence that the private object was persisted.
            if (response is null || string.IsNullOrWhiteSpace(response.Etag) || response.Size != length)
                throw new IntegrationUnavailableException("object storage");
        }
        catch (MinioException) { throw new IntegrationUnavailableException("object storage"); }
    }

    public async Task CopyToAsync(string key, Stream destination, CancellationToken cancellationToken)
    {
        using var client = CreateClient();
        var copied = false;
        try
        {
            var response = await client.GetObjectAsync(new GetObjectArgs().WithBucket(options.Value.Bucket).WithObject(key)
                .WithCallbackStream(async (stream, token) =>
                {
                    await stream.CopyToAsync(destination, token);
                    copied = true;
                }), cancellationToken);
            if (response is null || !copied) throw new IntegrationUnavailableException("object storage");
        }
        catch (ObjectNotFoundException) { throw new FileNotFoundException("Private object is unavailable."); }
        catch (MinioException) { throw new IntegrationUnavailableException("object storage"); }
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        using var client = CreateClient();
        await client.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(options.Value.Bucket).WithObject(key), cancellationToken);
    }
}
