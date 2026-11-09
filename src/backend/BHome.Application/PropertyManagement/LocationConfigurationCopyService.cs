using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.PropertyManagement;

public sealed record ConfigurationCopy(Guid SourceLocationId, Guid TargetLocationId, string[] Groups,
    DateOnly? EffectiveFrom = null, string ConflictStrategy = "Reject", string SourceState = "", string TargetState = "");
public sealed record ConfigurationCopyPlan(Guid SourceLocationId, Guid TargetLocationId, string[] Groups,
    string SourceState, string TargetState, bool CanProceed, string[] Changes, string[] Conflicts, string[] UnsupportedReferences);

public sealed class LocationConfigurationCopyService(ISharedConfigurationStore shared, ISetupWorkspaceStore local,
    PropertyService properties, AssetInventoryService assets, OperatingPolicyService policies, ICurrentUser user, TimeProvider clock)
{
    private static readonly string[] Supported = ["RoomDefaults", "AssetTemplates", "FeePolicies", "OperatingPolicies"];
    private Guid Owner()
    {
        var actor = user.UserId ?? throw new PropertyException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new PropertyException(403, "owner_required"); return actor;
    }
    private void Validate(ConfigurationCopy input)
    {
        _ = Owner();
        if (input.SourceLocationId == Guid.Empty || input.TargetLocationId == Guid.Empty || input.SourceLocationId == input.TargetLocationId ||
            input.ConflictStrategy != "Reject" || input.Groups is null || input.Groups.Length is < 1 or > 4 || input.Groups.Distinct().Count() != input.Groups.Length || input.Groups.Any(g => !Supported.Contains(g)))
            throw new PropertyException(400, "invalid_configuration_copy");
        if (input.Groups.Contains("FeePolicies") && (input.EffectiveFrom is null || input.EffectiveFrom < BHome.Application.Billing.BillingAutomationDates.BusinessDate(clock.GetUtcNow()))) throw new PropertyException(400, "copy_fee_effective_date_required");
    }
    private sealed record ConfigurationState(LocationDto Location, IReadOnlyList<SetupDocument> Defaults, IReadOnlyList<SetupDocument> Assets, IReadOnlyList<PolicyDto> Fees, IReadOnlyList<SetupDocument> Policies);
    private async Task<ConfigurationState> State(Guid location, ConfigurationCopy input, CancellationToken t) => new(
        await properties.GetLocationAsync(location, t),
        input.Groups.Contains("RoomDefaults") ? await local.ListAsync(location, "RoomDefaults", t) : [],
        input.Groups.Contains("AssetTemplates") ? await local.ListAsync(location, "AssetTemplate", t) : [],
        input.Groups.Contains("FeePolicies") ? await shared.PoliciesAsync(location, t) : [],
        input.Groups.Contains("OperatingPolicies") ? await local.ListAsync(location, "OperatingPolicy", t) : []);
    private static string Name(SetupDocument document) => document.Data.TryGetProperty("name", out var name) ? name.GetString() ?? "" : document.Data.GetProperty("title").GetString() ?? "";
    private static IReadOnlyList<PolicyDto> EffectiveFees(ConfigurationState state, ConfigurationCopy input) => state.Fees.Where(p => p.EffectiveFrom <= input.EffectiveFrom && (p.EffectiveTo is null || p.EffectiveTo >= input.EffectiveFrom)).ToArray();
    private static ConfigurationCopyPlan Plan(ConfigurationCopy input, ConfigurationState source, ConfigurationState target)
    {
        var conflicts = new List<string>(); var unsupported = new List<string>(); var changes = new List<string>();
        void Documents(string group, IReadOnlyList<SetupDocument> from, IReadOnlyList<SetupDocument> to)
        {
            if (!input.Groups.Contains(group)) return;
            if (from.Count == 0) conflicts.Add($"{group}: source contains no configuration.");
            if (from.GroupBy(Name, StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1)) unsupported.Add($"{group}: source contains repeated names; select a unique local configuration before copying.");
            foreach (var document in from)
            {
                changes.Add($"{group}: copy {Name(document)} (source {document.Id}, revision {document.Version}) as independent configuration.");
                if (to.Any(d => string.Equals(Name(d), Name(document), StringComparison.OrdinalIgnoreCase))) conflicts.Add($"{group}: target already contains {Name(document)}.");
            }
        }
        Documents("RoomDefaults", source.Defaults, target.Defaults); Documents("AssetTemplates", source.Assets, target.Assets); Documents("OperatingPolicies", source.Policies, target.Policies);
        if (input.Groups.Contains("FeePolicies"))
        {
            var selected = EffectiveFees(source, input);
            if (selected.Count == 0) conflicts.Add("FeePolicies: no source policies are effective on the selected date.");
            foreach (var fee in selected)
            {
                changes.Add($"FeePolicies: copy {fee.Name} from {input.EffectiveFrom:yyyy-MM-dd} through {fee.EffectiveTo:yyyy-MM-dd}.");
                if (fee.RoomId.HasValue) unsupported.Add($"FeePolicies: {fee.Id} references source Room {fee.RoomId}; Room mapping is required and is not supported by this copy operation.");
                if (target.Fees.Any(p => p.RoomId is null && p.ChargeCode == fee.ChargeCode && p.EffectiveFrom <= (fee.EffectiveTo ?? DateOnly.MaxValue) && (p.EffectiveTo ?? DateOnly.MaxValue) >= input.EffectiveFrom)) conflicts.Add($"FeePolicies: overlapping target charge {fee.ChargeCode}.");
            }
        }
        return new(input.SourceLocationId, input.TargetLocationId, input.Groups, SharedConfigurationApplicationService.Hash(source), SharedConfigurationApplicationService.Hash(target), conflicts.Count + unsupported.Count == 0, changes.ToArray(), conflicts.ToArray(), unsupported.ToArray());
    }
    public Task<ConfigurationCopyPlan> PreviewAsync(ConfigurationCopy input, CancellationToken t)
    {
        Validate(input); return shared.TransactionAsync([input.SourceLocationId, input.TargetLocationId], async () => Plan(input, await State(input.SourceLocationId, input, t), await State(input.TargetLocationId, input, t)), t);
    }
    public Task<SharedOperation> CopyAsync(ConfigurationCopy input, Guid key, CancellationToken t)
    {
        Validate(input); var actor = Owner();
        if (key == Guid.Empty || string.IsNullOrWhiteSpace(input.SourceState) || string.IsNullOrWhiteSpace(input.TargetState)) throw new PropertyException(400, "configuration_preview_and_key_required");
        var fingerprint = SharedConfigurationApplicationService.Hash(input);
        return shared.TransactionAsync([input.SourceLocationId, input.TargetLocationId], async () =>
        {
            var prior = await shared.OperationAsync(actor, "Copy", key, t);
            if (prior is not null) return prior.Fingerprint == fingerprint ? prior : throw new PropertyException(409, "idempotency_payload_mismatch");
            var source = await State(input.SourceLocationId, input, t); var target = await State(input.TargetLocationId, input, t); var plan = Plan(input, source, target);
            if (input.SourceState != plan.SourceState || input.TargetState != plan.TargetState) throw new PropertyException(409, "configuration_copy_state_changed");
            if (!plan.CanProceed) throw new PropertyException(409, "configuration_copy_conflict_or_unsupported");
            var created = new List<Guid>();
            foreach (var defaults in source.Defaults)
            {
                var id = Guid.NewGuid(); await local.SaveAsync(id, input.TargetLocationId, "RoomDefaults", "Recorded", new { name = Name(defaults), defaults = defaults.Data.GetProperty("defaults"), copiedFromId = defaults.Id, copiedFromVersion = defaults.Version, sourceLocationId = input.SourceLocationId }, 0, actor, t); created.Add(id);
            }
            foreach (var template in source.Assets)
            {
                var data = template.Data.Deserialize<AssetTemplateWrite>(SharedDataValidator.Json) ?? throw new PropertyException(409, "invalid_source_configuration");
                created.Add((await assets.SaveTemplateAsync(null, new(input.TargetLocationId, data.Name, data.Items.Select(i => i with { Id = Guid.NewGuid() }).ToArray()), t)).Id);
            }
            foreach (var fee in EffectiveFees(source, input))
                created.Add((await properties.CreatePolicyAsync(new(input.TargetLocationId, null, fee.Category, fee.ChargeCode, fee.Name, fee.Method, fee.Rate, input.EffectiveFrom!.Value, fee.EffectiveTo, $"Copied from Location {input.SourceLocationId}, policy {fee.Id}, version {fee.Version}"), t)).Id);
            foreach (var policy in source.Policies)
            {
                var data = policy.Data.Deserialize<OperatingPolicyWrite>(SharedDataValidator.Json) ?? throw new PropertyException(409, "invalid_source_configuration");
                created.Add((await policies.SaveAsync(null, new(input.TargetLocationId, data.Title, data.Content, data.EffectiveFrom), t)).Id);
            }
            var operation = new SharedOperation(Guid.NewGuid(), "Copy", key, fingerprint, actor, clock.GetUtcNow(), input.SourceLocationId, input.SourceLocationId, Guid.Empty, 0, 0, string.Join(",", input.Groups), input.TargetLocationId, "Completed", created.ToArray());
            await shared.SaveOperationAsync(operation, t); return operation;
        }, t);
    }
}
