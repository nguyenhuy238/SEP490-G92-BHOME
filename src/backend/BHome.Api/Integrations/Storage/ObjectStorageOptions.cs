namespace BHome.Infrastructure.Storage;

public sealed class ObjectStorageOptions
{
    public const string Section = "ObjectStorage";
    public string Endpoint { get; set; } = "localhost:9000";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string Bucket { get; set; } = "bhome-private";
    public bool UseSsl { get; set; } = true;
}
