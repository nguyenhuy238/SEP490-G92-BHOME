using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Common;

namespace BHome.Domain.Billing;

// The confirmed reading and its persisted evidence reference are the same entity.
public sealed class MeterReading : AuditableEntity
{
    public Guid TaskId { get; set; }
    public Guid MeterId { get; set; }
    public Guid EvidenceId { get; set; }
    public decimal? PreviousValue { get; set; }
    public decimal? OcrProposedValue { get; set; }
    public decimal ConfirmedValue { get; set; }
    public decimal? Consumption { get; set; }
    public MeterReadingStatus Status { get; set; }
    public Guid ConfirmedByUserId { get; set; }
    public DateTimeOffset ConfirmedAt { get; set; }

    [NotMapped, JsonIgnore] public ReadingPurpose ReadingPurpose { get; set; }
    [NotMapped, JsonIgnore] public DateOnly? BillingPeriod { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset ReadingAt { get; set; }
    [NotMapped, JsonIgnore] public JsonElement Evidence { get; set; }
    private JsonElement history = MeterHistory.Empty;
    [NotMapped, JsonIgnore]
    public JsonElement History
    {
        get => history;
        set
        {
            history = value;
            var state = MeterHistory.Latest(value, "MeterReading");
            EvidenceId = state?.EvidenceId ?? Guid.Empty;
            CreatedAt = state?.CreatedAt ?? DateTimeOffset.UnixEpoch;
            UpdatedAt = state?.UpdatedAt ?? DateTimeOffset.UnixEpoch;
        }
    }
}

internal static class MeterHistory
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static readonly JsonElement Empty = JsonSerializer.SerializeToElement(Array.Empty<object>(), Json);
    internal sealed record State(DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, Guid EvidenceId);

    internal static State? Latest(JsonElement history, string kind)
    {
        if (history.ValueKind != JsonValueKind.Array) return null;
        foreach (var entry in history.EnumerateArray().Reverse())
            if (entry.ValueKind == JsonValueKind.Object &&
                entry.TryGetProperty("recordType", out var type) && type.GetString() == kind &&
                entry.TryGetProperty("state", out var state) && state.ValueKind == JsonValueKind.Object)
                return state.Deserialize<State>(Json);
        return null;
    }
}
