using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using BHome.Domain.Common;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.PaymentsDebt;

public sealed class PaymentTransfer : AuditableEntity
{
    public string ProviderIdentity { get; set; } = "";
    public string BankReference { get; set; } = "";
    public string NormalizedReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "VND";
    public DateTimeOffset OccurredAt { get; set; }
    public string TransferDescription { get => StoredRemittanceInfo!; set => StoredRemittanceInfo = value; }
    public string StatementReference { get; set; } = "";
    // Private, Owner-authenticated evidence for a manually registered bank receipt.
    // Historical receipts and authenticated SePay receipts intentionally leave these null.
    public string? StatementEvidenceObjectKey { get; set; }
    public string? StatementEvidenceSha256 { get; set; }
    public string? StatementEvidenceContentType { get; set; }
    public long? StatementEvidenceLength { get; set; }
    public string VerificationReason { get; set; } = "";
    public string VerificationSource { get; set; } = "OwnerBankStatement";
    public Guid VerifiedByUserId { get => StoredVerifiedByUserId ?? Guid.Empty; set => StoredVerifiedByUserId = value; }
    public DateTimeOffset VerifiedAt { get => StoredVerifiedAt.GetValueOrDefault(); set => StoredVerifiedAt = value; }
    public Guid? ProposedInvoiceId { get; set; }
    public Guid? ProposedDepositContractId { get; set; }
    public bool IsDevelopmentDemo { get; set; }

    // Physical metadata also represents non-receipt payments. Nullable columns
    // must remain nullable (in particular automated provider verification).
    // Exclude these members from both archive projections and v1 receipt JSON.
    [NotMapped, JsonIgnore] public string ReceivingAccountKey { get; set; } = "";
    [NotMapped, JsonIgnore] public string? EffectKey { get; set; }
    [NotMapped, JsonIgnore] public string? StoredRemittanceInfo { get; set; } = "";
    [NotMapped, JsonIgnore] public Guid? BeneficiaryResidentId { get; set; }
    [NotMapped, JsonIgnore] public string Status { get; set; } = "";
    [NotMapped, JsonIgnore] public string? VerificationMethod { get; set; }
    [NotMapped, JsonIgnore] public Guid? StoredVerifiedByUserId { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? StoredVerifiedAt { get; set; }
    [NotMapped, JsonIgnore] public JsonElement VerificationData { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
