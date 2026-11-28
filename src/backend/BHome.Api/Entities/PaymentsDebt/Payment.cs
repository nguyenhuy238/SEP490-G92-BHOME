using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PaymentsDebt;

public sealed class Payment : AuditableEntity
{
    [NotMapped, JsonIgnore] public string ProviderCode { get; set; } = "";
    public string ProviderIdentity { get => ProviderCode; set => ProviderCode = value; }
    [NotMapped, JsonIgnore] public string TransactionReference { get; set; } = "";
    public string BankReference { get => TransactionReference; set => TransactionReference = value; }
    public string NormalizedReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "VND";
    [NotMapped, JsonIgnore] public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset OccurredAt { get => ReceivedAt; set => ReceivedAt = value; }
    public string TransferDescription { get => RemittanceInfo!; set => RemittanceInfo = value; }
    public string StatementReference { get; set; } = "";
    // Private, Owner-authenticated evidence for a manually registered bank receipt.
    // Historical receipts and authenticated SePay receipts intentionally leave these null.
    public string? StatementEvidenceObjectKey { get; set; }
    public string? StatementEvidenceSha256 { get; set; }
    public string? StatementEvidenceContentType { get; set; }
    public long? StatementEvidenceLength { get; set; }
    public string VerificationReason { get; set; } = "";
    public string VerificationSource { get; set; } = "OwnerBankStatement";
    [JsonPropertyName("verifiedByUserId")] public Guid ReceiptVerifiedByUserId { get => VerifiedByUserId ?? Guid.Empty; set => VerifiedByUserId = value; }
    [JsonPropertyName("verifiedAt")] public DateTimeOffset ReceiptVerifiedAt { get => VerifiedAt.GetValueOrDefault(); set => VerifiedAt = value; }
    public Guid? ProposedInvoiceId { get; set; }
    public Guid? ProposedDepositContractId { get; set; }
    public bool IsDevelopmentDemo { get; set; }

    // Physical metadata also represents non-receipt payments. Nullable columns
    // must remain nullable (in particular automated provider verification).
    // Exclude these members from both archive projections and v1 receipt JSON.
    [NotMapped, JsonIgnore] public string ReceivingAccountKey { get; set; } = "";
    [NotMapped, JsonIgnore] public string? EffectKey { get; set; }
    [NotMapped, JsonIgnore] public string? RemittanceInfo { get; set; } = "";
    [NotMapped, JsonIgnore] public Guid? BeneficiaryResidentId { get; set; }
    [NotMapped, JsonIgnore] public string Status { get; set; } = "";
    [NotMapped, JsonIgnore] public string? VerificationMethod { get; set; }
    [NotMapped, JsonIgnore] public Guid? VerifiedByUserId { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? VerifiedAt { get; set; }
    [NotMapped, JsonIgnore] public JsonElement VerificationData { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
