using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.PropertyManagement;

public abstract class SetupWorkspaceService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access)
{
    protected ISetupWorkspaceStore Store => store;
    protected ICurrentUser User => user;
    protected ResourceAccess Access => access;
    protected Guid Actor => user.UserId ?? throw new PropertyException(401, "authentication_required");
    protected void Owner() { _ = Actor; if (!user.IsInRole(Roles.Owner)) throw new PropertyException(403, "owner_required"); }
    protected async Task Scope(Guid location, bool write, CancellationToken t)
    {
        if (write) Owner();
        if (!await access.CanAccessAsync(new(location, null), [Roles.Owner, Roles.Staff], t)) throw new PropertyException(404, "resource_not_found");
    }
    protected async Task<Guid> RoomScope(Guid room, bool write, CancellationToken t)
    {
        var location = await store.RoomLocationAsync(room, t) ?? throw new PropertyException(404, "resource_not_found");
        await Scope(location, write, t); return location;
    }
    protected async Task<SetupDocument> Document(Guid id, string kind, bool write, CancellationToken t)
    {
        var doc = await store.GetAsync(id, kind, t) ?? throw new PropertyException(404, "resource_not_found");
        await Scope(doc.LocationId, write, t); return doc;
    }
    public async Task<SetupDocument> GetAsync(Guid id, string kind, CancellationToken t) => await Document(id, kind, false, t);
    public async Task<IReadOnlyList<SetupDocument>> ListAsync(Guid location, string kind, CancellationToken t)
    { await Scope(location, false, t); return await store.ListAsync(location, kind, t); }
    protected static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    protected static T Read<T>(SetupDocument doc) => doc.Data.Deserialize<T>(Json) ?? throw new PropertyException(409, "invalid_setup_document");
    protected static Guid Key(string value) => LocationSetupKeys.Key(value);
    protected static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, Json)));
    protected static bool EqualText(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
    protected static bool IsValidEvidence(SetupDocument document, Guid location)
    {
        if (document.Kind != "Evidence" || document.LocationId != location ||
            !document.Data.TryGetProperty("objectKey", out var key) || key.ValueKind != JsonValueKind.String ||
            !document.Data.TryGetProperty("contentType", out var type) || type.ValueKind != JsonValueKind.String ||
            !document.Data.TryGetProperty("length", out var length) || !length.TryGetInt32(out var bytes) ||
            !document.Data.TryGetProperty("hash", out var hash) || hash.ValueKind != JsonValueKind.String)
            return false;
        return BHome.Application.Storage.PrivateImageKeys.IsSetup(location, key.GetString()) &&
            type.GetString() is "image/png" or "image/jpeg" && bytes is > 0 and <= 5 * 1024 * 1024 &&
            hash.GetString() is { Length: 64 } digest && digest.All(Uri.IsHexDigit);
    }
    protected static RoomInventoryReviewEvidence EvidenceView(SetupDocument document) => new(
        document.Id, document.Data.GetProperty("contentType").GetString() ?? "image/jpeg",
        document.RecordedAt, document.RecordedBy);
    protected static string Text(string value, int max = 4000) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max ? value.Trim() : throw new PropertyException(400, "invalid_setup_text");
    protected async Task Evidence(Guid location, string key, CancellationToken t)
    {
        if (key is null || !BHome.Application.Storage.PrivateImageKeys.IsSetup(location, key) || await store.EvidenceHashAsync(key, t) is null)
            throw new PropertyException(400, "verified_private_evidence_required");
    }
}
