using BHome.Application.Common;
using BHome.Application.Storage;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;

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
        await client.PutObjectAsync(new PutObjectArgs().WithBucket(options.Value.Bucket).WithObject(key)
            .WithStreamData(content).WithObjectSize(length).WithContentType(contentType), cancellationToken);
    }

    public async Task CopyToAsync(string key, Stream destination, CancellationToken cancellationToken)
    {
        using var client = CreateClient();
        await client.GetObjectAsync(new GetObjectArgs().WithBucket(options.Value.Bucket).WithObject(key)
            .WithCallbackStream((stream, token) => stream.CopyToAsync(destination, token)), cancellationToken);
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        using var client = CreateClient();
        await client.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(options.Value.Bucket).WithObject(key), cancellationToken);
    }
}
