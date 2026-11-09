using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.PropertyManagement;

public interface ISharedDataValidator
{
    bool Supports(string resource);
    Task<JsonElement> ValidateAsync(string resource, JsonElement data, CancellationToken t);
}
public sealed class SharedConfigurationService(ISharedConfigurationStore store, ISharedDataValidator validator, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        var actor = user.UserId ?? throw new PropertyException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new PropertyException(403, "owner_required"); return actor;
    }
    private void Resource(string resource) { _ = Owner(); if (!validator.Supports(resource)) throw new PropertyException(404, "shared_resource_not_found"); }
    private static string Text(string? text, int max, bool required = true) => (!required || !string.IsNullOrWhiteSpace(text)) && (text?.Trim().Length ?? 0) <= max ? text?.Trim() ?? "" : throw new PropertyException(400, "invalid_shared_text");
    public async Task<SharedDocument> GetAsync(string resource, Guid id, CancellationToken t)
    { Resource(resource); return await store.GetAsync(id, resource, t) ?? throw new PropertyException(404, "shared_document_not_found"); }
    public Task<SharedPage> ListAsync(string resource, string search, string status, int page, int pageSize, CancellationToken t)
    {
        Resource(resource); if (page < 1 || page > 100000 || pageSize is < 1 or > 100 || status is not ("" or "Draft" or "Published" or "Archived")) throw new PropertyException(400, "invalid_shared_query");
        return store.ListAsync(resource, Text(search, 200, false), status, page, pageSize, t);
    }
    public async Task<IReadOnlyList<SharedDocument>> VersionsAsync(string resource, Guid id, CancellationToken t) => await store.FamilyAsync((await GetAsync(resource, id, t)).FamilyId, resource, t);
    public async Task<IReadOnlyList<SharedDocument>> HistoryAsync(string resource, Guid id, CancellationToken t)
    { _ = await GetAsync(resource, id, t); return await store.HistoryAsync(id, t); }
    public Task<SharedDocument> SaveAsync(string resource, Guid? id, SharedWrite input, CancellationToken t)
    {
        Resource(resource); var actor = Owner(); var name = Text(input.Name, 150); var description = Text(input.Description, 2000, false);
        return store.TransactionAsync([], async () =>
        {
            var before = id.HasValue ? await GetAsync(resource, id.Value, t) : null;
            if (before is null ? input.ExpectedVersion != 0 : before.Version != input.ExpectedVersion || before.Status != "Draft") throw new PropertyException(409, "stale_or_immutable_shared_version");
            var family = before?.FamilyId ?? Guid.NewGuid();
            if (await store.NameExistsAsync(resource, name, family, t)) throw new PropertyException(409, "duplicate_shared_name");
            var data = await validator.ValidateAsync(resource, input.Data, t); var now = clock.GetUtcNow();
            var document = new SharedDocument(before?.Id ?? Guid.NewGuid(), resource, family, before?.Edition ?? 1, input.ExpectedVersion + 1,
                name, description, "Draft", "BHOME", before?.CreatedBy ?? actor, before?.CreatedAt ?? now, actor, now, data);
            await store.SaveAsync(document, input.ExpectedVersion, t); return document;
        }, t);
    }
    public Task<SharedDocument> TransitionAsync(string resource, Guid id, SharedVersion input, bool archive, CancellationToken t)
    {
        Resource(resource); var actor = Owner();
        return store.TransactionAsync([], async () =>
        {
            var before = await GetAsync(resource, id, t);
            if (before.Version != input.ExpectedVersion || before.Status == "Archived" || !archive && before.Status != "Draft") throw new PropertyException(409, "stale_or_immutable_shared_version");
            if (!archive) _ = await validator.ValidateAsync(resource, before.Data, t);
            var document = before with { Status = archive ? "Archived" : "Published", Version = before.Version + 1, UpdatedBy = actor, UpdatedAt = clock.GetUtcNow() };
            await store.SaveAsync(document, before.Version, t); return document;
        }, t);
    }
    public Task<SharedDocument> DeriveAsync(string resource, Guid id, SharedDuplicate input, bool edition, CancellationToken t)
    {
        Resource(resource); var actor = Owner();
        return store.TransactionAsync([], async () =>
        {
            var before = await GetAsync(resource, id, t);
            if (before.Version != input.ExpectedVersion || before.Status == "Archived" || edition && before.Status != "Published") throw new PropertyException(409, "stale_or_immutable_shared_version");
            var family = edition ? before.FamilyId : Guid.NewGuid(); var name = edition ? before.Name : Text(input.Name, 150);
            var versions = edition ? await store.FamilyAsync(family, resource, t) : [];
            if (versions.Any(d => d.Status == "Draft")) throw new PropertyException(409, "shared_draft_already_exists");
            if (await store.NameExistsAsync(resource, name, family, t)) throw new PropertyException(409, "duplicate_shared_name");
            var now = clock.GetUtcNow(); var document = before with { Id = Guid.NewGuid(), FamilyId = family, Edition = edition ? versions.Max(d => d.Edition) + 1 : 1,
                Version = 1, Name = name, Status = "Draft", CreatedBy = actor, CreatedAt = now, UpdatedBy = actor, UpdatedAt = now };
            await store.SaveAsync(document, 0, t); return document;
        }, t);
    }
}
