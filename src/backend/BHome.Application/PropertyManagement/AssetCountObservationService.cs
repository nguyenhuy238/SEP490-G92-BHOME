using BHome.Application.IdentityAccess;

namespace BHome.Application.PropertyManagement;

public sealed record AssetCountObservationWrite(Guid DesiredId, int DesiredVersion, int Quantity,
    string EvidenceObjectKey, string Note, int ExpectedVersion);
public sealed record AssetCountObservation(Guid RoomId, Guid DesiredId, Guid ItemId, int Quantity,
    string EvidenceObjectKey, string Note);

// An observation is evidence of what was counted, not permission to create or
// retire a physical asset. Keep it separate from the verified asset ledger.
public sealed class AssetCountObservationService(ISetupWorkspaceStore store, ICurrentUser user,
    ResourceAccess access, AssetInventoryService inventory) : SetupWorkspaceService(store, user, access)
{
    private const string Kind = "AssetCountObservation";
    private static Guid ObservationKey(Guid room, Guid desired, Guid item) => Key($"asset-count:{room:N}:{desired:N}:{item:N}");

    public async Task<IReadOnlyList<SetupDocument>> CurrentAsync(Guid room, CancellationToken t)
    {
        var location = await RoomScope(room, false, t);
        var state = await inventory.InventoryAsync(room, t);
        if (state.CurrentDesiredId is not { } desired) return [];
        var result = new List<SetupDocument>();
        var current = state.Desired.Single(x => x.Id == desired);
        foreach (var item in Read<DesiredAssets>(current).Items)
        {
            var document = await Store.GetAsync(ObservationKey(room, desired, item.Id), Kind, t);
            if (document is not null && document.LocationId == location) result.Add(document);
        }
        return result;
    }

    public async Task<SetupDocument> SaveAsync(Guid room, Guid item, AssetCountObservationWrite input, CancellationToken t)
    {
        var location = await RoomScope(room, false, t);
        if (input.Quantity is < 0 or > 10000 || input.DesiredVersion < 1 || input.ExpectedVersion < 0 ||
            input.Note is null || input.Note.Length > 1000 || item == Guid.Empty || input.DesiredId == Guid.Empty)
            throw new PropertyException(400, "invalid_asset_observation");
        await Evidence(location, input.EvidenceObjectKey, t);
        return await Store.TransactionAsync(location, async () =>
        {
            var state = await inventory.InventoryAsync(room, t);
            if (state.CurrentDesiredId != input.DesiredId) throw new PropertyException(409, "desired_template_changed");
            var desired = state.Desired.Single(x => x.Id == input.DesiredId);
            if (desired.Version != input.DesiredVersion) throw new PropertyException(409, "stale_version");
            if (!Read<DesiredAssets>(desired).Items.Any(x => x.Id == item)) throw new PropertyException(400, "template_item_not_found");
            var id = ObservationKey(room, desired.Id, item);
            var record = new AssetCountObservation(room, desired.Id, item, input.Quantity, input.EvidenceObjectKey, input.Note.Trim());
            var prior = await Store.GetAsync(id, Kind, t);
            if (prior is not null && prior.LocationId == location && prior.Version == input.ExpectedVersion + 1 &&
                Read<AssetCountObservation>(prior) == record) return prior;
            return await Store.SaveAsync(id, location, Kind, "Recorded", record, input.ExpectedVersion, Actor, t);
        }, t);
    }
}
