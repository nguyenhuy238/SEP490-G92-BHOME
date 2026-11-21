namespace BHome.Application.Storage;

// Keys and access decisions belong to the application, never accept arbitrary caller-selected keys.
public interface IObjectStorage
{
    Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken cancellationToken);
    Task CopyToAsync(string key, Stream destination, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}
