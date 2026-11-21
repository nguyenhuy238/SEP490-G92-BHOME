using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;

namespace BHome.Application.PropertyManagement;

public sealed class LocationLegalRecordService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access,
    IObjectStorage storage, IContractImageValidator images) : SetupWorkspaceService(store, user, access)
{
    public async Task<SetupPage> RecordsAsync(Guid location, int page, int size, CancellationToken t)
    {
        await Scope(location, true, t);
        return await Store.PageAsync(location, "LocationLegalRecord", null, page, size, t);
    }

    public async Task<IReadOnlyList<SetupDocument>> VersionsAsync(Guid id, CancellationToken t)
    {
        await Document(id, "LocationLegalRecord", true, t);
        return await Store.HistoryAsync(id, "LocationLegalRecord", t);
    }

    public async Task<SetupDocument> SaveAsync(Guid location, Guid id, LocationLegalRecordWrite input,
        Stream? file, CancellationToken t)
    {
        await Scope(location, true, t);
        if (id == Guid.Empty || input.IssuedOn == default || input.ExpiresOn < input.IssuedOn ||
            input.Status is not ("Active" or "Archived")) throw new PropertyException(400, "invalid_legal_record");
        Text(input.DocumentType, 100); Text(input.Name, 200);
        if (input.Note?.Length > 4000 || input.Number?.Length > 200 || input.Issuer?.Length > 300)
            throw new PropertyException(400, "invalid_legal_record");
        string? uploadedKey = null;
        string? type = null;
        long length = 0;
        if (file is not null)
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int count;
            while ((count = await file.ReadAsync(chunk, t)) > 0)
            {
                if (buffer.Length + count > 5 * 1024 * 1024) throw new PropertyException(413, "legal_file_too_large");
                await buffer.WriteAsync(chunk.AsMemory(0, count), t);
            }
            var bytes = buffer.ToArray();
            type = bytes.AsSpan().StartsWith("%PDF-"u8) ? "application/pdf" : images.Validate(bytes);
            length = bytes.LongLength;
            uploadedKey = $"location-legal/{location:N}/{id:N}/{Guid.NewGuid():N}";
            await storage.PutAsync(uploadedKey, new MemoryStream(bytes, false), length, type, t);
        }
        try
        {
            return await Store.TransactionAsync(location, async () =>
            {
                var previous = await Store.GetAsync(id, "LocationLegalRecord", t);
                if (previous is not null && previous.LocationId != location) throw new PropertyException(404, "resource_not_found");
                var old = previous is null ? null : Read<LocationLegalRecord>(previous);
                if (uploadedKey is null && old is null) throw new PropertyException(400, "legal_file_required");
                var record = new LocationLegalRecord(input, uploadedKey ?? old!.ObjectKey, type ?? old!.ContentType, uploadedKey is null ? old!.Length : length);
                var saved = await Store.SaveAsync(id, location, "LocationLegalRecord", input.Status, record, input.ExpectedVersion, Actor, t);
                await Store.AuditAsync(location, id, Actor, "LocationLegalRecordVersionSaved", t);
                return saved;
            }, t);
        }
        catch
        {
            if (uploadedKey is not null) await storage.DeleteAsync(uploadedKey, CancellationToken.None);
            throw;
        }
    }

    public async Task<string> CopyAsync(Guid id, int version, Stream output, CancellationToken t)
    {
        await Document(id, "LocationLegalRecord", true, t);
        var revision = (await Store.HistoryAsync(id, "LocationLegalRecord", t)).SingleOrDefault(d => d.Version == version)
            ?? throw new PropertyException(404, "resource_not_found");
        var record = Read<LocationLegalRecord>(revision);
        await storage.CopyToAsync(record.ObjectKey, output, t);
        return record.ContentType;
    }
}
