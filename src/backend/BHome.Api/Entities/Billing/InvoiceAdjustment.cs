using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.Billing;

public sealed class InvoiceAdjustment : AuditableEntity
{
    public Guid InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;
    [NotMapped, JsonIgnore] public Guid RequestedByUserId { get; set; }
    public Guid RequesterId { get => RequestedByUserId; set => RequestedByUserId = value; }
    public Guid? InvoiceLineId { get; set; }
    public string? ChargeCode { get; set; }
    public decimal CurrentAmount { get; set; }
    public decimal? ProposedAmount { get; set; }
    public string Reason { get; set; } = "";
    public string InvoiceSnapshot { get; set; } = "";
    public InvoiceStatus InvoiceStatus { get; set; }
    public int InvoiceVersion { get; set; }
    public int FinancialVersion { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset SubmittedAt { get => RequestedAt; set => RequestedAt = value; }
    [JsonPropertyName("evidence")] public List<InvoiceAdjustmentEvidence> EvidenceItems { get; set; } = [];
    public InvoiceAdjustmentDecision? Decision { get; set; }

    // Physical request metadata is excluded from the archive projection and
    // existing business snapshot shape. Decision identity remains independent.
    [NotMapped, JsonIgnore] public JsonElement RequestSnapshot { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement ProposedChanges { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement Evidence { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public string Status { get; set; } = "REQUESTED";
    [NotMapped, JsonIgnore] public decimal? ApprovedDeltaAmount { get; set; }
    [NotMapped, JsonIgnore] public Guid? DecidedByUserId { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? DecidedAt { get; set; }
    [NotMapped, JsonIgnore] public string? DecisionReason { get; set; }
    [NotMapped, JsonIgnore] public JsonElement? DecisionSnapshot { get; set; }
    [NotMapped, JsonIgnore] public int Version { get; set; } = 1;
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
