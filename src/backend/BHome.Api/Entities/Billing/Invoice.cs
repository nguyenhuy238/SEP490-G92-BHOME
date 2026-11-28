using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Common;

namespace BHome.Domain.Billing;

public sealed class Invoice : AuditableEntity
{
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string Type { get; set; } = "PERIODIC";
    public Guid? AutomationPlanId { get; set; }
    public Guid? AutomationFinalizationPlanId { get; set; }
    public Guid RoomId { get; set; }
    public Guid LocationId { get; set; }
    public string RoomNumber { get; set; } = "";
    public string LocationName { get; set; } = "";
    public DateOnly BillingPeriod { get; set; }
    public Guid RepresentativeContractId { get; set; }
    public Guid RepresentativeTenantUserId { get; set; }
    public InvoiceStatus Status { get; set; }
    public int Version { get; set; } = 1;
    public decimal Total { get; set; }
    public string[] MissingInputs { get; set; } = [];
    public string ScheduleSnapshot { get; set; } = "";
    public DateOnly ScheduledFinalDate { get; set; }
    public DateOnly DueDate { get; set; }
    public Guid CreatedByUserId { get; set; }
    public Guid? FinalizedByUserId { get; set; }
    public DateTimeOffset? FinalizedAt { get; set; }
    public List<InvoiceLine> Lines { get; set; } = [];
    public List<InvoiceRecipient> Recipients { get; set; } = [];

    [NotMapped, JsonIgnore] public Guid[] RecipientUserIds { get; set; } = [];
    [NotMapped, JsonIgnore] public JsonElement PaymentRequests { get; set; }
    [NotMapped, JsonIgnore] public JsonElement History { get; set; }
    private JsonElement billingSnapshot;
    [NotMapped, JsonIgnore]
    public JsonElement BillingSnapshot
    {
        get => billingSnapshot;
        set
        {
            billingSnapshot = value;
            var state = InvoiceSnapshot.Read<InvoiceMetadata>(value);
            CreatedAt = state is null || state.CreatedAt == default ? DateTimeOffset.UnixEpoch : state.CreatedAt.ToUniversalTime();
            UpdatedAt = state is null || state.UpdatedAt == default ? DateTimeOffset.UnixEpoch : state.UpdatedAt.ToUniversalTime();
            AutomationPlanId = state?.AutomationPlanId;
            AutomationFinalizationPlanId = state?.AutomationFinalizationPlanId;
            RoomNumber = state?.RoomNumber ?? "";
            LocationName = state?.LocationName ?? "";
            ScheduleSnapshot = state?.ScheduleSnapshot ?? "";
            CreatedByUserId = state?.CreatedByUserId ?? Guid.Empty;
        }
    }

    private sealed record InvoiceMetadata(DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? AutomationPlanId, Guid? AutomationFinalizationPlanId, string? RoomNumber,
        string? LocationName, string? ScheduleSnapshot, Guid CreatedByUserId);
}

internal static class InvoiceSnapshot
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static T? Read<T>(JsonElement snapshot) where T : class =>
        snapshot.ValueKind == JsonValueKind.Object && snapshot.TryGetProperty("compactState", out var state) &&
        state.ValueKind == JsonValueKind.Object ? state.Deserialize<T>(Json) : null;
}
