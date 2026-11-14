using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance;

public sealed record FastRepairPolicyView(int Version, IReadOnlyList<string> ActiveCategories, decimal MaximumCost = 0, bool MaterialsAllowed = false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FastRepairPolicyWrite(int Version, string[] ActiveCategories);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FastRepairStart(int Version, string Category, string InspectionResult, string Solution,
    int EstimatedMinutes, [property: JsonRequired] decimal EstimatedCost, [property: JsonRequired] bool UsesMaterials);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AssetLinkProposal(int Version, Guid? AssetId, string? Name, string? Category, string? Condition, string Reason);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AssetLinkDecision(int Version, [property: JsonRequired] bool Approve, string Reason);

public sealed partial class IncidentService
{
    public async Task<FastRepairPolicyView> GetFastRepairPolicyAsync(CancellationToken t)
    {
        await PermitAsync(Permissions.WorkOrders.View, t);
        var policy = await repository.FastRepairPolicyAsync(t);
        return new(policy?.Version ?? 0, policy is null ? [] : JsonSerializer.Deserialize<string[]>(policy.CategoriesJson)!);
    }

    public async Task<IncidentCommandResult> SaveFastRepairPolicyAsync(FastRepairPolicyWrite input, Guid key, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.Manage, t);
        if (input.ActiveCategories is null || input.ActiveCategories.Length > 50) throw IncidentException.Invalid("invalid_fast_repair_categories");
        var categories = input.ActiveCategories.Select(c => Text(c, 1, 100)).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToArray();
        return await CommandAsync(Guid.Empty, null, key, "fast-repair-policy", input,
            () => PermitAsync(Permissions.Incidents.Manage, t), async () =>
        {
            var policy = await repository.FastRepairPolicyAsync(t);
            Version(input.Version, policy?.Version ?? 0);
            if (policy is null) { policy = new FastRepairPolicy(); repository.Add(policy); }
            else policy.Version++;
            policy.CategoriesJson = JsonSerializer.Serialize(categories); policy.ApprovedById = Actor; policy.ApprovedAt = Now;
            repository.Audit(Actor, "FastRepairPolicyConfigured", policy.Id, Now);
            return new(null, ResourceId: policy.Id);
        }, t);
    }

    public Task<IncidentCommandResult> StartFastRepairAsync(Guid id, FastRepairStart input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "fast-repair-start", input, Permissions.WorkOrders.Execute, true, async (context, order) =>
        {
            var policy = await repository.FastRepairPolicyAsync(t);
            var category = Text(input.Category, 1, 100);
            if (policy is null || !JsonSerializer.Deserialize<string[]>(policy.CategoriesJson)!.Contains(category, StringComparer.OrdinalIgnoreCase))
                throw IncidentException.Conflict("fast_repair_category_inactive");
            if (input.EstimatedCost != 0 || input.UsesMaterials) throw IncidentException.Conflict("fast_repair_requires_normal_approval");
            if (input.EstimatedMinutes < 1) throw IncidentException.Invalid("invalid_estimated_time");
            order.InspectionResult = Text(input.InspectionResult); order.ProposedSolution = Text(input.Solution);
            order.EstimatedMinutes = input.EstimatedMinutes; order.EstimatedCost = 0; order.UsesMaterials = false;
            Transition(() => order.StartFastRepair(policy.Version, category, Now));
            if (order.AssetId is { } assetId)
            {
                var asset = await repository.AssetAsync(assetId, t) ?? throw IncidentException.Missing();
                if (asset.Status == AssetStatus.Retired) throw IncidentException.Conflict("asset_retired");
                asset.Status = AssetStatus.UnderRepair; asset.Version++;
            }
            var activity = Activity(context, order, "fast_repair_started", "", false,
                new { policy.Version, policy.ApprovedById, policy.ApprovedAt, category, input });
            await NotifyAsync(context, activity, await repository.RecipientsAsync(context.LocationId, Today, false, t), t);
            return new(context.IncidentId, id);
        }, t);

    public Task<IncidentCommandResult> FastRepairFallbackAsync(Guid id, WorkOrderAction input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "fast-repair-fallback", input, Permissions.WorkOrders.Execute, true, async (context, order) =>
        {
            var reason = Text(input.Note, 1, 2000);
            var basis = new { order.FastRepairPolicyVersion, order.FastRepairCategory, order.FastRepairAuthorizedAt };
            Transition(order.RequireNormalApproval);
            var activity = Activity(context, order, "fast_repair_blocked", reason, false, basis);
            await NotifyAsync(context, activity, await repository.RecipientsAsync(context.LocationId, Today, false, t), t);
            return new(context.IncidentId, id);
        }, t);

    public Task<IncidentCommandResult> ProposeAssetAsync(Guid id, AssetLinkProposal input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "asset-proposal", input, Permissions.WorkOrders.Execute, true, async (context, order) =>
        {
            if (!order.IsOpen || order.AssetId is not null || order.AssetProposalPending) throw IncidentException.Conflict("asset_link_unavailable");
            if (input.AssetId is { } assetId) await ValidateTargetAsync(order.LocationId, order.RoomId, context.CommonArea, assetId, t);
            else
            {
                order.ProposedAssetName = Text(input.Name, 1, 200);
                order.ProposedAssetCategory = Text(input.Category, 1, 100);
                order.ProposedAssetCondition = Text(input.Condition, 1, 1000);
            }
            order.ProposedAssetId = input.AssetId; order.AssetProposalPending = true;
            var activity = Activity(context, order, "asset_proposed", Text(input.Reason, 1, 2000), false, input);
            await NotifyAsync(context, activity, await repository.RecipientsAsync(context.LocationId, Today, false, t), t);
            return new(context.IncidentId, id);
        }, t);

    public Task<IncidentCommandResult> DecideAssetAsync(Guid id, AssetLinkDecision input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "asset-decision", input, Permissions.Incidents.Manage, false, async (context, order) =>
        {
            if (!order.IsOpen || !order.AssetProposalPending || order.AssetId is not null) throw IncidentException.Conflict("asset_link_unavailable");
            var reason = Text(input.Reason, 1, 2000);
            if (input.Approve)
            {
                Asset asset;
                if (order.ProposedAssetId is { } existing)
                {
                    await ValidateTargetAsync(order.LocationId, order.RoomId, context.CommonArea, existing, t);
                    asset = await repository.AssetAsync(existing, t) ?? throw IncidentException.Missing();
                    asset.Version++;
                }
                else
                {
                    asset = new Asset
                    {
                        LocationId = order.LocationId, RoomId = order.RoomId, CommonArea = context.CommonArea,
                        Name = order.ProposedAssetName!, Category = order.ProposedAssetCategory!, Condition = order.ProposedAssetCondition!
                    };
                    repository.Add(asset);
                }
                var executing = order.Status is WorkOrderStatus.InProgress or WorkOrderStatus.PendingVerification;
                if (executing || await repository.OtherAssetExecutionAsync(asset.Id, order.Id, t)) asset.Status = AssetStatus.UnderRepair;
                else asset.Status = AssetStatus.NeedsRepair;
                order.AssetId = asset.Id;
                // The original report remains historical evidence of what the reporter selected.
            }
            order.AssetProposalPending = false;
            var activity = Activity(context, order, input.Approve ? "asset_confirmed" : "asset_rejected", reason, false,
                new { input, order.AssetId, order.ProposedAssetId, order.ProposedAssetName });
            await NotifyAsync(context, activity, [order.AssignedStaffId], t);
            return new(context.IncidentId, id, order.AssetId);
        }, t);
}
