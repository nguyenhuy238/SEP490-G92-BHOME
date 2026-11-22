using System.Text.Json;
using System.Text;
using System.Globalization;
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
    private static string Name(string? text) => Text(string.Join(' ', (text ?? "").Normalize(NormalizationForm.FormC).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)), 150);
    // Persisted exact decimals may be JSON strings; the validator returns JSON numbers.
    private static bool SameData(JsonElement stored, JsonElement validated)
    {
        if (validated.ValueKind == JsonValueKind.Number)
            return decimal.TryParse(stored.ValueKind == JsonValueKind.String ? stored.GetString() : stored.GetRawText(),
                NumberStyles.Number, CultureInfo.InvariantCulture, out var number) && validated.TryGetDecimal(out var expected) && number == expected;
        if (stored.ValueKind != validated.ValueKind) return false;
        return validated.ValueKind switch
        {
            JsonValueKind.Object => stored.EnumerateObject().Count() == validated.EnumerateObject().Count() &&
                validated.EnumerateObject().All(p => stored.TryGetProperty(p.Name, out var value) && SameData(value, p.Value)),
            JsonValueKind.Array => stored.GetArrayLength() == validated.GetArrayLength() &&
                stored.EnumerateArray().Zip(validated.EnumerateArray()).All(p => SameData(p.First, p.Second)),
            JsonValueKind.String => stored.GetString() == validated.GetString(),
            _ => stored.GetRawText() == validated.GetRawText()
        };
    }
    private async Task EnsureNoOverlappingFeePeriodAsync(string resource, Guid? exceptFamilyId, JsonElement data, CancellationToken t)
    {
        if (resource != "fee-templates") return;
        var candidate = SharedDataValidator.Read<SharedFeeData>(data);
        var candidateEnd = candidate.EffectiveTo ?? DateOnly.MaxValue;
        for (var page = 1; ; page++)
        {
            var existingPage = await store.ListAsync(resource, "", "", page, 100, t);
            foreach (var document in existingPage.Items)
            {
                // Drafts are not selectable and must not reserve an effective period.
                // Older editions in the same family are revisions of this policy, not
                // competing policies; only another Published family can overlap it.
                if (document.Status != "Published" || document.FamilyId == exceptFamilyId) continue;
                var existing = SharedDataValidator.Read<SharedFeeData>(document.Data);
                var samePolicy = existing.Category == candidate.Category && existing.Method == candidate.Method &&
                    string.Equals(existing.ChargeCode, candidate.ChargeCode, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(existing.Scope, candidate.Scope, StringComparison.Ordinal);
                if (samePolicy && candidate.EffectiveFrom <= (existing.EffectiveTo ?? DateOnly.MaxValue) &&
                    existing.EffectiveFrom <= candidateEnd)
                    throw new PropertyException(409, "overlapping_shared_fee_period");
            }
            if ((long)page * existingPage.PageSize >= existingPage.Total) break;
        }
    }
    public async Task<SharedDocument> GetAsync(string resource, Guid id, CancellationToken t)
    { Resource(resource); return await store.GetAsync(id, resource, t) ?? throw new PropertyException(404, "shared_document_not_found"); }
    public Task<SharedPage> ListAsync(string resource, string search, string status, int page, int pageSize, CancellationToken t, bool latestOnly = false)
    {
        Resource(resource); if (page < 1 || page > 100000 || pageSize is < 1 or > 100 || status is not ("" or "Draft" or "Published" or "Archived")) throw new PropertyException(400, "invalid_shared_query");
        return store.ListAsync(resource, Text(search, 200, false), status, page, pageSize, t, latestOnly);
    }
    public async Task<IReadOnlyList<SharedDocument>> VersionsAsync(string resource, Guid id, CancellationToken t) => await store.FamilyAsync((await GetAsync(resource, id, t)).FamilyId, resource, t);
    public async Task<IReadOnlyList<SharedDocument>> HistoryAsync(string resource, Guid id, CancellationToken t)
    { _ = await GetAsync(resource, id, t); return await store.HistoryAsync(id, t); }
    public Task<SharedDocument> SaveAsync(string resource, Guid? id, SharedWrite input, CancellationToken t)
    {
        Resource(resource); var actor = Owner(); var name = Name(input.Name); var description = Text(input.Description, 2000, false);
        return store.TransactionAsync([], async () =>
        {
            var before = id.HasValue ? await GetAsync(resource, id.Value, t) : null;
            if (before is null ? input.ExpectedVersion != 0 : before.Version != input.ExpectedVersion || before.Status != "Draft" && (!input.PublishImmediately || before.Status != "Published")) throw new PropertyException(409, "stale_or_immutable_shared_version");
            var family = before?.FamilyId ?? Guid.NewGuid();
            // New names are reserved even when archived. Allow an unchanged legacy name
            // to be repaired without making an already archived duplicate active again.
            var newName = before is null || !string.Equals(Name(before.Name), name, StringComparison.OrdinalIgnoreCase);
            if (await store.NameExistsAsync(resource, name, family, t, includeArchived: newName)) throw new PropertyException(409, "duplicate_shared_name");
            var data = await validator.ValidateAsync(resource, input.Data, t);
            if (input.PublishImmediately)
                await EnsureNoOverlappingFeePeriodAsync(resource, family, data, t);
            var now = clock.GetUtcNow();
            if (input.PublishImmediately)
            {
                IReadOnlyList<SharedDocument> versions = before is null ? [] : await store.FamilyAsync(family, resource, t);
                // A stale editor must not overwrite a newer active edition or a legacy draft.
                if (before is not null && versions.Any(v => v.Id != before.Id && v.Status != "Archived" && v.Edition > before.Edition))
                    throw new PropertyException(409, "stale_or_immutable_shared_version");
                var unchanged = before is not null && before.Name == name && before.Description == description && SameData(before.Data, data);
                if (before?.Status == "Published" && unchanged) return before;
                var newEdition = before is not null && !unchanged && await store.IsUsedAsync(before.Id, resource, t);
                var expected = newEdition ? 0 : input.ExpectedVersion;
                var active = new SharedDocument(newEdition || before is null ? Guid.NewGuid() : before.Id, resource, family,
                    newEdition ? versions.Max(v => v.Edition) + 1 : before?.Edition ?? 1,
                    expected + 1, name, description, "Published", "BHOME",
                    newEdition || before is null ? actor : before.CreatedBy, newEdition || before is null ? now : before.CreatedAt,
                    actor, now, data);
                if (newEdition && before!.Status == "Draft")
                    await store.SaveAsync(before with { Status = "Archived", Version = before.Version + 1, UpdatedBy = actor, UpdatedAt = now }, before.Version, t);
                await store.SaveAsync(active, expected, t); return active;
            }
            if (before is not null && await store.IsUsedAsync(before.Id, resource, t))
                throw new PropertyException(409, "stale_or_immutable_shared_version");
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
            if (archive && input.WholeFamily)
            {
                var family = await store.FamilyAsync(before.FamilyId, resource, t);
                var latest = family.Last(v => v.Status != "Archived");
                if (latest.Id != before.Id) throw new PropertyException(409, "stale_or_immutable_shared_version");
                SharedDocument? result = null;
                foreach (var member in family.Where(v => v.Status != "Archived"))
                {
                    var archived = member with { Status = "Archived", Version = member.Version + 1, UpdatedBy = actor, UpdatedAt = clock.GetUtcNow() };
                    await store.SaveAsync(archived, member.Version, t);
                    if (member.Id == before.Id) result = archived;
                }
                return result!;
            }
            if (!archive)
            {
                if (await store.NameExistsAsync(resource, before.Name, before.FamilyId, t, includeArchived: false)) throw new PropertyException(409, "duplicate_shared_name");
                var validated = await validator.ValidateAsync(resource, before.Data, t);
                await EnsureNoOverlappingFeePeriodAsync(resource, before.FamilyId, validated, t);
            }
            var document = before with { Status = archive ? "Archived" : "Published", Version = before.Version + 1, UpdatedBy = actor, UpdatedAt = clock.GetUtcNow() };
            await store.SaveAsync(document, before.Version, t); return document;
        }, t);
    }
    public Task<SharedDocument> RestoreAsync(string resource, Guid id, SharedVersion input, CancellationToken t)
    {
        Resource(resource); var actor = Owner();
        return store.TransactionAsync([], async () =>
        {
            var before = await GetAsync(resource, id, t);
            if (before.Version != input.ExpectedVersion || before.Status != "Archived") throw new PropertyException(409, "stale_or_non_archived_shared_version");
            var family = await store.FamilyAsync(before.FamilyId, resource, t);
            if (input.WholeFamily)
            {
                if (family.Any(v => v.Status != "Archived") || family.Last().Id != before.Id)
                    throw new PropertyException(409, "stale_or_non_archived_shared_version");
                if (await store.NameExistsAsync(resource, before.Name, before.FamilyId, t, includeArchived: false))
                    throw new PropertyException(409, "duplicate_shared_name");
                var validated = await validator.ValidateAsync(resource, before.Data, t);
                await EnsureNoOverlappingFeePeriodAsync(resource, before.FamilyId, validated, t);
                var restored = before with { Status = "Published", Version = before.Version + 1, UpdatedBy = actor, UpdatedAt = clock.GetUtcNow() };
                await store.SaveAsync(restored, before.Version, t); return restored;
            }
            if (family.Any(document => document.Id != before.Id && document.Status == "Draft")) throw new PropertyException(409, "shared_draft_already_exists");
            if (await store.NameExistsAsync(resource, before.Name, before.FamilyId, t, includeArchived: false)) throw new PropertyException(409, "duplicate_shared_name");
            var document = before with { Status = "Draft", Version = before.Version + 1, UpdatedBy = actor, UpdatedAt = clock.GetUtcNow() };
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
            var family = edition ? before.FamilyId : Guid.NewGuid(); var name = edition ? before.Name : Name(input.Name);
            var versions = edition ? await store.FamilyAsync(family, resource, t) : [];
            if (versions.Any(d => d.Status == "Draft")) throw new PropertyException(409, "shared_draft_already_exists");
            if (await store.NameExistsAsync(resource, name, family, t, includeArchived: !edition)) throw new PropertyException(409, "duplicate_shared_name");
            var now = clock.GetUtcNow(); var document = before with
            {
                Id = Guid.NewGuid(),
                FamilyId = family,
                Edition = edition ? versions.Max(d => d.Edition) + 1 : 1,
                Version = 1,
                Name = name,
                Status = input.PublishImmediately && !edition ? "Published" : "Draft",
                Data = input.PublishImmediately && !edition ? await validator.ValidateAsync(resource, before.Data, t) : before.Data,
                CreatedBy = actor,
                CreatedAt = now,
                UpdatedBy = actor,
                UpdatedAt = now
            };
            if (document.Status == "Published")
                await EnsureNoOverlappingFeePeriodAsync(resource, document.FamilyId, document.Data, t);
            await store.SaveAsync(document, 0, t); return document;
        }, t);
    }
}
