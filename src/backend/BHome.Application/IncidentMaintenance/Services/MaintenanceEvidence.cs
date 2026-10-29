using BHome.Application.IncidentMaintenance.Contracts;
using BHome.Application.Storage;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Application.IncidentMaintenance.Services;

// NFR Report Upload: <= 5 images per submission, <= 5 MB each, JPEG/PNG/WebP checked by file signature.
// Files are uploaded before the database transaction; callers delete them again if saving fails,
// so no row points to a missing object. Keys are generated here, never taken from the client.
public sealed class MaintenanceEvidence(IObjectStorage storage)
{
    public const int MaxFiles = 5;
    public const int MaxBytes = 5 * 1024 * 1024;
    private const string Prefix = "incident-evidence/";

    public async Task<IReadOnlyList<EvidenceRef>> UploadAsync(IReadOnlyList<EvidenceUpload>? uploads, EvidenceKind kind,
        Guid actorUserId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        uploads ??= [];
        if (uploads.Count > MaxFiles) throw new MaintenanceValidationException("too_many_evidence_files");
        var stored = new List<EvidenceRef>();
        try
        {
            foreach (var upload in uploads)
                stored.Add(await UploadOneAsync(upload, kind, actorUserId, now, cancellationToken));
            return stored;
        }
        catch
        {
            await DeleteAsync(stored);
            throw;
        }
    }

    // Best effort: an object left behind here is private and not referenced by any row.
    public async Task DeleteAsync(IReadOnlyList<EvidenceRef> files)
    {
        foreach (var file in files)
        {
            try { await storage.DeleteAsync(file.Key, CancellationToken.None); }
            catch (Exception) { }
        }
    }

    public Task CopyToAsync(string key, Stream destination, CancellationToken cancellationToken) =>
        storage.CopyToAsync(key, destination, cancellationToken);

    // Clients only see the random file id, not the storage key.
    public static string FileId(string key) => key.StartsWith(Prefix, StringComparison.Ordinal) ? key[Prefix.Length..] : key;

    public static string? KeyFromFileId(string fileId) =>
        Guid.TryParseExact(fileId, "N", out var id) ? Prefix + id.ToString("N") : null;

    private async Task<EvidenceRef> UploadOneAsync(EvidenceUpload upload, EvidenceKind kind, Guid actorUserId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (upload.Length > MaxBytes) throw new MaintenanceValidationException("evidence_file_too_large");

        // Read at most MaxBytes + 1 so an untrusted length header cannot bypass the limit.
        var buffer = new byte[MaxBytes + 1];
        var length = 0;
        int read;
        while (length < buffer.Length && (read = await upload.Content.ReadAsync(buffer.AsMemory(length), cancellationToken)) > 0)
            length += read;

        if (length == 0) throw new MaintenanceValidationException("empty_evidence_file");
        if (length > MaxBytes) throw new MaintenanceValidationException("evidence_file_too_large");
        var contentType = DetectImageType(buffer.AsSpan(0, length))
            ?? throw new MaintenanceValidationException("unsupported_evidence_type");

        var key = Prefix + Guid.NewGuid().ToString("N");
        using var data = new MemoryStream(buffer, 0, length, false);
        await storage.PutAsync(key, data, length, contentType, cancellationToken);
        return new EvidenceRef(key, kind, actorUserId, now, length, contentType);
    }

    internal static string? DetectImageType(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF })) return "image/jpeg";
        if (data.StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return "image/png";
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }
}
