using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.PropertyManagement;

public sealed class SharedConfigurationApplicationService(ISharedConfigurationStore shared, ISetupWorkspaceStore local,
    SharedConfigurationService library, PropertyService properties, AssetInventoryService assets, OperatingPolicyService policies,
    ICurrentUser user, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = SharedDataValidator.Json;
    private Guid Owner()
    {
        var actor = user.UserId ?? throw new PropertyException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new PropertyException(403, "owner_required"); return actor;
    }
    internal static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, Json)));
    private static T Data<T>(SharedDocument document) => document.Data.Deserialize<T>(Json) ?? throw new PropertyException(409, "invalid_shared_document");
    private static string Kind(string resource) => resource switch { "room-type-templates" => "RoomDefaults", "asset-templates" => "AssetTemplate", "fee-templates" => "BillingPolicy", "policy-templates" => "OperatingPolicy", _ => throw new PropertyException(400, "shared_resource_not_applicable") };
    private async Task<object> State(Guid location, string resource, CancellationToken t)
    {
        var target = await properties.GetLocationAsync(location, t);
        return new { target, records = resource == "fee-templates" ? (object)await shared.PoliciesAsync(location, t) : await local.ListAsync(location, Kind(resource), t) };
    }
    private async Task<ConfigurationPlan> Plan(string resource, Guid id, SharedApply input, CancellationToken t)
    {
        _ = Owner(); var source = await library.GetAsync(resource, id, t); var kind = Kind(resource);
        if (source.Status != "Published" || source.Version != input.ExpectedVersion) throw new PropertyException(409, "shared_source_stale_or_unpublished");
        if (input.ConflictStrategy != "Reject" || input.LocationId == Guid.Empty) throw new PropertyException(400, "invalid_configuration_strategy");
        var state = await State(input.LocationId, resource, t); var conflicts = new List<string>();
        if (await shared.HasApplicationAsync(source.FamilyId, input.LocationId, t)) conflicts.Add("This template family was already applied to the target Location.");
        if (resource == "fee-templates")
        {
            var fee = Data<SharedFeeData>(source);
            if ((fee.Scope == "Room") != input.RoomId.HasValue) conflicts.Add("Select an explicit target Room for Room scope; Location scope must omit Room.");
            if (input.RoomId.HasValue && await local.RoomLocationAsync(input.RoomId.Value, t) != input.LocationId) conflicts.Add("Target Room does not belong to the target Location.");
            if (fee.EffectiveFrom < BHome.Application.Billing.BillingAutomationDates.BusinessDate(clock.GetUtcNow())) conflicts.Add("The fee edition starts in the past. Create a new edition with an approved effective date.");
            if ((await shared.PoliciesAsync(input.LocationId, t)).Any(p => p.RoomId == input.RoomId && p.ChargeCode == fee.ChargeCode && p.EffectiveFrom <= (fee.EffectiveTo ?? DateOnly.MaxValue) && (p.EffectiveTo ?? DateOnly.MaxValue) >= fee.EffectiveFrom)) conflicts.Add("An overlapping target charge already exists.");
        }
        else
        {
            if (input.RoomId.HasValue) conflicts.Add("This operation creates Location configuration; omit Room.");
            var records = await local.ListAsync(input.LocationId, kind, t);
            if (records.Any(d => d.Data.TryGetProperty("name", out var name) && string.Equals(name.GetString(), source.Name, StringComparison.OrdinalIgnoreCase) || d.Data.TryGetProperty("title", out var title) && string.Equals(title.GetString(), source.Name, StringComparison.OrdinalIgnoreCase))) conflicts.Add("A target configuration with this name already exists.");
            if (resource == "asset-templates" && !Data<SharedAssetData>(source).Items.Any(i => i.Required || input.IncludeOptionalItems)) conflicts.Add("The selected package contains no included items.");
        }
        return new(id, input.LocationId, Hash(state), conflicts.Count == 0, [$"Create independent {kind}: {source.Name} (edition {source.Edition})."], conflicts.ToArray(), []);
    }
    public Task<ConfigurationPlan> PreviewAsync(string resource, Guid id, SharedApply input, CancellationToken t)
    {
        _ = Owner(); return shared.TransactionAsync([input.LocationId], () => Plan(resource, id, input, t), t);
    }
    public Task<SharedOperation> ApplyAsync(string resource, Guid id, SharedApply input, Guid key, CancellationToken t)
    {
        var actor = Owner(); if (key == Guid.Empty || string.IsNullOrWhiteSpace(input.TargetState)) throw new PropertyException(400, "configuration_preview_and_key_required");
        var fingerprint = Hash(new { resource, id, input });
        return shared.TransactionAsync([input.LocationId], async () =>
        {
            var prior = await shared.OperationAsync(actor, "Apply", key, t);
            if (prior is not null) return prior.Fingerprint == fingerprint ? prior : throw new PropertyException(409, "idempotency_payload_mismatch");
            var plan = await Plan(resource, id, input, t);
            if (plan.TargetState != input.TargetState) throw new PropertyException(409, "configuration_target_changed");
            if (!plan.CanProceed) throw new PropertyException(409, "configuration_conflict");
            var source = await library.GetAsync(resource, id, t); Guid created;
            switch (resource)
            {
                case "room-type-templates":
                    created = Guid.NewGuid(); await local.SaveAsync(created, input.LocationId, "RoomDefaults", "Recorded", new { name = source.Name, defaults = source.Data, sourceId = source.Id, sourceVersion = source.Version, sourceEdition = source.Edition }, 0, actor, t); break;
                case "asset-templates":
                    var items = Data<SharedAssetData>(source).Items.Where(i => i.Required || input.IncludeOptionalItems).Select(i => new AssetTemplateItem(Guid.NewGuid(), i.Catalog!.Name, i.Catalog.Category, i.TrackingMode, i.Quantity)).ToArray();
                    created = (await assets.SaveTemplateAsync(null, new(input.LocationId, source.Name, items), t)).Id; break;
                case "fee-templates":
                    var fee = Data<SharedFeeData>(source);
                    created = (await properties.CreatePolicyAsync(new(input.LocationId, input.RoomId, fee.Category, fee.ChargeCode, source.Name, fee.Method, fee.ReferenceRate, fee.EffectiveFrom, fee.EffectiveTo, $"Applied shared edition {source.Id}"), t)).Id; break;
                case "policy-templates":
                    var policy = Data<SharedPolicyData>(source);
                    created = (await policies.SaveAsync(null, new(input.LocationId, source.Name, policy.Content, policy.EffectiveFrom), t)).Id; break;
                default: throw new PropertyException(400, "shared_resource_not_applicable");
            }
            var operation = new SharedOperation(Guid.NewGuid(), "Apply", key, fingerprint, actor, clock.GetUtcNow(), source.Id, null, source.FamilyId, source.Version, source.Edition, resource, input.LocationId, "Completed", [created]);
            await shared.SaveOperationAsync(operation, t); return operation;
        }, t);
    }
    public async Task<SharedUsage> ApplicationsAsync(string resource, Guid id, int page, int pageSize, CancellationToken t)
    {
        _ = Owner(); if (page < 1 || page > 100000 || pageSize is < 1 or > 100) throw new PropertyException(400, "invalid_shared_query");
        var doc = await library.GetAsync(resource, id, t); return await shared.ApplicationsAsync(doc.FamilyId, page, pageSize, t);
    }
    public async Task<IReadOnlyList<SetupDocument>> RoomDefaultsAsync(Guid location, CancellationToken t)
    { _ = Owner(); _ = await properties.GetLocationAsync(location, t); return await local.ListAsync(location, "RoomDefaults", t); }
}
