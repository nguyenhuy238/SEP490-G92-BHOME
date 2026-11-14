using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

// A Room/period has one cumulative tier/quota position, even when it is billed
// by both a periodic invoice and one or more approved move-out receivables.
public static class UtilityIncrementCalculation
{
    public static async Task<UtilityCalculation?> CalculateAsync(IUtilityBilling billing, Guid roomId, UtilityType type,
        DateOnly period, decimal alreadyBilled, decimal additional, string? previousSnapshot, CancellationToken token)
    {
        if (alreadyBilled < 0 || additional < 0) throw new ArgumentOutOfRangeException(nameof(additional));
        var total = checked(alreadyBilled + additional);
        var cumulative = await billing.CalculateAsync(roomId, type, period, total, token);
        if (cumulative is null)
            return string.IsNullOrWhiteSpace(previousSnapshot) || Policy(previousSnapshot)?["kind"]?.ToString() == "FlatMeteredIncrement/v1"
                ? null : Missing("utility_profile_changed_since_billing");
        if (cumulative.MissingInputs.Count > 0) return cumulative;
        var after = Policy(cumulative.Snapshot);
        if (after is null || !Quantity(after, out var afterQuantity) || afterQuantity != total ||
            !Money(after, "amount", out var afterAmount) || afterAmount != cumulative.Amount)
            return Missing("utility_calculation_snapshot_invalid");
        JsonObject? before = null; decimal previousAmount = 0;
        if (alreadyBilled > 0)
        {
            before = Policy(previousSnapshot);
            if (before is null || !Quantity(before, out var quantity) || quantity != alreadyBilled || !Money(before, "amount", out previousAmount))
                return Missing("utility_pricing_baseline_required");
            if (!Compatible(before, after)) return Missing("utility_increment_policy_changed");
        }
        if (afterAmount < previousAmount) return Missing("utility_increment_requires_adjustment");
        var delta = afterAmount - previousAmount;
        return new(delta, JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            kind = "CumulativeUtilityIncrement/v1",
            alreadyBilledQuantity = alreadyBilled,
            additionalQuantity = additional,
            previousCalculatedAmount = previousAmount,
            cumulativeCalculatedAmount = afterAmount,
            previousPolicySnapshot = before?.ToJsonString(),
            cumulativePolicySnapshot = after.ToJsonString(),
            amount = delta
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web)), []);
    }

    private static UtilityCalculation Missing(string code) => new(0, "", [code]);
    public static bool FlatPolicyMatches(string? snapshot, Guid policyId, int version, decimal rate, VndRounding rounding)
    {
        var root = Policy(snapshot);
        return root?["kind"]?.ToString() == "FlatMeteredIncrement/v1" && root["policyId"]?.ToString() == policyId.ToString() &&
            Number(root, "policyVersion", out var savedVersion) && savedVersion == version &&
            Number(root, "rate", out var savedRate) && savedRate == rate && Number(root, "rounding", out var savedRounding) && savedRounding == (int)rounding;
    }

    // Keep only the cumulative policy snapshot, rather than recursively embedding
    // the entire sequence of previous increments in every subsequent charge.
    internal static JsonObject? Policy(string? snapshot)
    {
        if (string.IsNullOrWhiteSpace(snapshot)) return null;
        try
        {
            for (var depth = 0; depth < 5; depth++)
            {
                if (JsonNode.Parse(snapshot) is not JsonObject root) return null;
                if (root["kind"]?.GetValue<string>() != "CumulativeUtilityIncrement/v1") return root;
                snapshot = root["cumulativePolicySnapshot"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(snapshot)) return null;
            }
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException) { }
        return null;
    }
    private static bool Number(JsonObject value, string key, out decimal result)
    {
        var text = value[key]?.ToString();
        return decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out result);
    }
    private static bool Money(JsonObject value, string key, out decimal result) => Number(value, key, out result) && AdjustmentRules.Money(result);
    private static bool Quantity(JsonObject value, out decimal quantity)
    {
        if (value["segments"] is not JsonArray segments) return Number(value, "quantity", out quantity) && quantity >= 0;
        quantity = 0;
        foreach (var segment in segments)
        {
            if (segment is not JsonObject row || !Number(row, "consumption", out var amount) || amount < 0) return false;
            try { quantity = checked(quantity + amount); }
            catch (OverflowException) { return false; }
        }
        return segments.Count > 0;
    }
    private static bool Compatible(JsonObject before, JsonObject after)
    {
        if (before["segments"] is JsonArray previousSegments)
        {
            if (after["segments"] is not JsonArray nextSegments || !Same(before, after, "quotaId", "quotaVersion")) return false;
            foreach (var segment in previousSegments)
            {
                if (segment is not JsonObject old || !Number(old, "consumption", out var consumed) || !Number(old, "freeQuantity", out var free) || free < 0 || free > consumed) return false;
                var matches = nextSegments.OfType<JsonObject>().Where(next => Same(old, next, "from", "tariffId", "tariffVersion", "tiers", "rounding") &&
                    Date(old, "to", out var oldTo) && Date(next, "to", out var nextTo) && nextTo >= oldTo).ToArray();
                // A new Owner-confirmed breakdown may extend a segment or add later
                // segments, but cannot rewrite already-priced usage or free quota.
                if (matches.Length != 1 || !Number(matches[0], "consumption", out var nextConsumed) || nextConsumed < consumed ||
                    !Number(matches[0], "freeQuantity", out var nextFree) || nextFree < free) return false;
            }
            return true;
        }
        if (after["segments"] is not null) return false;
        var left = (JsonObject)before.DeepClone(); var right = (JsonObject)after.DeepClone();
        foreach (var key in new[] { "quantity", "amount", "reconciliationId", "reconciliationVersion" }) { left.Remove(key); right.Remove(key); }
        return JsonNode.DeepEquals(left, right);
    }
    private static bool Same(JsonObject left, JsonObject right, params string[] keys) => keys.All(key => JsonNode.DeepEquals(left[key], right[key]));
    private static bool Date(JsonObject row, string key, out DateOnly value) => DateOnly.TryParseExact(row[key]?.ToString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
}
