using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;

namespace BHome.Application.PropertyManagement;

public sealed class SetupEvidenceService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access,
    IContractImageValidator images, IObjectStorage storage) : SetupWorkspaceService(store, user, access)
{
    public async Task<string> UploadAsync(Guid location, Stream content, CancellationToken t)
    {
        await Scope(location, false, t);
        using var buffer = new MemoryStream(); var chunk = new byte[81920];
        while (true)
        {
            var read = await content.ReadAsync(chunk, t); if (read == 0) break;
            if (buffer.Length + read > 5 * 1024 * 1024) throw new PropertyException(413, "setup_evidence_too_large");
            buffer.Write(chunk, 0, read);
        }
        var bytes = buffer.ToArray(); var type = images.Validate(bytes);
        return await Store.UploadEvidenceAsync(location, bytes, type, Actor, t);
    }
    public async Task<string> CopyAsync(Guid location, Guid id, Stream output, CancellationToken t)
    {
        await Scope(location, false, t); var doc = await Document(id, "Evidence", false, t);
        if (doc.LocationId != location) throw new PropertyException(404, "resource_not_found");
        await storage.CopyToAsync(doc.Data.GetProperty("objectKey").GetString()!, output, t);
        return doc.Data.GetProperty("contentType").GetString()!;
    }
}
