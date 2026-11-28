using BHome.Application.Common;
using BHome.Application.Storage;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using Minio.Exceptions;

namespace BHome.Infrastructure.Storage;

internal sealed class MinioObjectStorage : IObjectStorage, IDisposable
{
    private readonly IOptions<ObjectStorageOptions> options;
    private readonly ILogger<MinioObjectStorage> logger;
    private readonly Lazy<IMinioClient> client;

    public MinioObjectStorage(IOptions<ObjectStorageOptions> options, ILogger<MinioObjectStorage> logger)
    {
        this.options = options;
        this.logger = logger;
        // The SDK owns an HTTP connection pool. Share it across requests and
        // concurrent photo reads instead of rebuilding and disposing it per file.
        client = new Lazy<IMinioClient>(CreateClient);
    }

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
        try
        {
            var response = await client.Value.PutObjectAsync(new PutObjectArgs().WithBucket(options.Value.Bucket).WithObject(key)
                .WithStreamData(content).WithObjectSize(length).WithContentType(contentType), cancellationToken);
            // SDK 6 can return without throwing after a transport failure. A completed
            // Task alone is not evidence that the private object was persisted.
            if (response is null || string.IsNullOrWhiteSpace(response.Etag) || response.Size != length)
            {
                logger.LogWarning("Object storage upload was not acknowledged");
                throw new IntegrationUnavailableException("object storage");
            }
        }
        catch (MinioException error)
        {
            // SDK messages/responses can contain private object paths and signed
            // requests. Retain only safe failure categories for CI/operations.
            logger.LogWarning("Object storage upload failed ({ErrorType}, HTTP {StatusCode})",
                error.GetType().Name, (int?)error.ServerResponse?.StatusCode);
            throw new IntegrationUnavailableException("object storage");
        }
    }

    public async Task CopyToAsync(string key, Stream destination, CancellationToken cancellationToken)
    {
        var copied = false;
        try
        {
            var response = await client.Value.GetObjectAsync(new GetObjectArgs().WithBucket(options.Value.Bucket).WithObject(key)
                .WithCallbackStream(async (stream, token) =>
                {
                    await stream.CopyToAsync(destination, token);
                    copied = true;
                }), cancellationToken);
            if (response is null || !copied) throw new IntegrationUnavailableException("object storage");
        }
        catch (ObjectNotFoundException) { throw new PrivateObjectNotFoundException(); }
        catch (MinioException) { throw new IntegrationUnavailableException("object storage"); }
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        await client.Value.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(options.Value.Bucket).WithObject(key), cancellationToken);
    }

    public void Dispose()
    {
        if (client.IsValueCreated) client.Value.Dispose();
    }
}
