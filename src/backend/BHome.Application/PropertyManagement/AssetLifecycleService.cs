using BHome.Application.IdentityAccess;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

public sealed class AssetLifecycleService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access)
    : SetupWorkspaceService(store, user, access)
{
    public async Task<SetupPage> PoliciesAsync(Guid location, int page, int size, CancellationToken t)
    {
        await Scope(location, true, t);
        return await Store.PageAsync(location, "AssetLifecyclePolicy", null, page, size, t);
    }

    public async Task<SetupDocument> SavePolicyAsync(Guid location, Guid id, AssetLifecyclePolicyWrite input, CancellationToken t)
    {
        await Scope(location, true, t); AssetLifecycleRules.Validate(input);
        return await Store.TransactionAsync(location, async () =>
        {
            var previous = await Store.GetAsync(id, "AssetLifecyclePolicy", t);
            if (previous is not null && (previous.LocationId != location || previous.Status != "Draft"))
                throw new PropertyException(409, "published_lifecycle_policy_immutable");
            if (input.ReplacesId is { } replaced)
            {
                var source = await Document(replaced, "AssetLifecyclePolicy", true, t);
                if (source.LocationId != location || source.Status != "Published") throw new PropertyException(400, "invalid_policy_replacement");
            }
            var saved = await Store.SaveAsync(id, location, "AssetLifecyclePolicy", "Draft", input, input.ExpectedVersion, Actor, t);
            await Store.AuditAsync(location, id, Actor, "AssetLifecyclePolicyDraftSaved", t);
            return saved;
        }, t);
    }

    public async Task<SetupDocument> PublishAsync(Guid id, int version, CancellationToken t)
    {
        var initial = await Document(id, "AssetLifecyclePolicy", true, t);
        return await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var current = await Document(id, initial.Kind, true, t);
            if (current.Status != "Draft") throw new PropertyException(409, "published_lifecycle_policy_immutable");
            var saved = await Store.SaveAsync(id, current.LocationId, current.Kind, "Published", Read<AssetLifecyclePolicyWrite>(current), version, Actor, t);
            await Store.AuditAsync(current.LocationId, id, Actor, "AssetLifecyclePolicyPublished", t);
            return saved;
        }, t);
    }

    public async Task<SetupPage> UnitsAsync(Guid assetId, int page, int size, CancellationToken t)
    {
        var asset = await AssetScope(assetId, false, t);
        return await Store.PageAsync(asset.LocationId, "AssetEquipmentUnit", assetId, page, size, t);
    }

    internal async Task<Asset> AssetScope(Guid id, bool write, CancellationToken t)
    {
        var asset = await Store.AssetAsync(id, t) ?? throw new PropertyException(404, "resource_not_found");
        await Scope(asset.LocationId, write, t);
        return asset;
    }

    public async Task<AssetLifecycleSummary> SummaryAsync(Guid assetId, CancellationToken t)
    {
        var asset = await AssetScope(assetId, false, t);
        var units = await AllUnits(asset, t);
        var quantity = (await Store.AssetMetadataAsync([asset.Id], t)).GetValueOrDefault(asset.Id)?.Quantity ?? 1;
        var active = units.Count(d => d.Status != "Retired");
        return new(quantity, units.Count, active, units.Count(d => d.Status == "Unsafe"), units.Count(d => d.Status == "Retired"),
            active == quantity ? "Recorded" : "NeedsConfiguration");
    }

    internal async Task<IReadOnlyList<SetupDocument>> AllUnits(Asset asset, CancellationToken t)
    {
        var items = new List<SetupDocument>();
        SetupPage result;
        var page = 1;
        do
        {
            result = await Store.PageAsync(asset.LocationId, "AssetEquipmentUnit", asset.Id, page++, 100, t);
            items.AddRange(result.Items);
        } while (items.Count < result.TotalCount);
        return items;
    }

    public async Task<SetupDocument> SaveUnitAsync(Guid assetId, Guid unitId, EquipmentUnitWrite input, CancellationToken t)
    {
        var asset = await AssetScope(assetId, true, t);
        Text(input.Label, 200); Text(input.Position, 300);
        if (unitId == Guid.Empty || input.Status is not ("InService" or "Unsafe" or "Retired") ||
            input.ManufacturedOn > input.CommissionedOn || input.RetiredOn < input.CommissionedOn ||
            input.Status == "Retired" && (input.RetiredOn is null || string.IsNullOrWhiteSpace(input.RetirementReason)) ||
            input.Status != "Retired" && (input.RetiredOn is not null || input.RetirementReason is not null) ||
            input.SerialNumber?.Length > 200 || input.Manufacturer?.Length > 200 || input.Model?.Length > 200 || input.RetirementReason?.Length > 2000)
            throw new PropertyException(400, "invalid_equipment_unit");
        return await Store.TransactionAsync(asset.LocationId, async () =>
        {
            asset = await AssetScope(assetId, true, t);
            if (asset.Status == AssetStatus.Retired) throw new PropertyException(409, "asset_retired");
            var units = await AllUnits(asset, t);
            var old = await Store.GetAsync(unitId, "AssetEquipmentUnit", t);
            if (old is not null && (old.LocationId != asset.LocationId || Read<EquipmentUnit>(old).AssetId != assetId || old.Status == "Retired"))
                throw new PropertyException(409, "equipment_unit_immutable_or_wrong_asset");
            var quantity = (await Store.AssetMetadataAsync([assetId], t)).GetValueOrDefault(assetId)?.Quantity ?? 1;
            if (input.Status != "Retired" && units.Count(d => d.Status != "Retired" && d.Id != unitId) >= quantity)
                throw new PropertyException(409, "equipment_quantity_exceeded");
            if (input.ReplacesUnitId is { } replaced)
            {
                var source = units.SingleOrDefault(d => d.Id == replaced && d.Status == "Retired");
                if (source is null || replaced == unitId || units.Any(d => d.Id != unitId && Read<EquipmentUnit>(d).Details.ReplacesUnitId == replaced))
                    throw new PropertyException(409, "invalid_equipment_replacement");
            }
            var saved = await Store.SaveAsync(unitId, asset.LocationId, "AssetEquipmentUnit", input.Status, new EquipmentUnit(assetId, input), input.ExpectedVersion, Actor, t);
            await Store.AuditAsync(asset.LocationId, unitId, Actor, "AssetEquipmentUnitSaved", t);
            return saved;
        }, t);
    }
}
