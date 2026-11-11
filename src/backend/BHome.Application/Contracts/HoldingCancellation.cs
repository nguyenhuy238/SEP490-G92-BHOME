using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public enum HoldingCancellationCause { TenantVoluntary, OwnerCannotProvideRoom }
public sealed record HoldingCancellationInput([Required, StringLength(2000, MinimumLength = 1)] string Reason,
    [property: JsonRequired] HoldingCancellationCause Cause, bool HumanConfirmed);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record HoldingCancellationDisposition(string Kind, HoldingCancellationCause Cause, decimal VerifiedDeposit,
    decimal ForfeitedAmount, decimal RefundRequired, Guid OwnerId, DateTimeOffset DecidedAt, string Reason);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record HoldingDispositionView(string Cause, string Status, decimal ForfeitedAmount, decimal RefundRequired,
    decimal Refunded, decimal Reserved, string FinancialReference);
public static class HoldingCancellationRules
{
    public const string Kind = "HoldingCancellation/v1";
    public static HoldingCancellationDisposition? Decode(ContractSettlementReview? review)
    {
        if (review is null) return null;
        try
        {
            var result = JsonSerializer.Deserialize<HoldingCancellationDisposition>(review.FinancialSnapshot);
            if (result?.Kind != Kind || !Enum.IsDefined(result.Cause) || result.OwnerId == Guid.Empty || string.IsNullOrWhiteSpace(result.Reason) ||
                result.VerifiedDeposit < 0 || result.VerifiedDeposit >= 1_000_000_000_000_000_000m || decimal.Truncate(result.VerifiedDeposit) != result.VerifiedDeposit)
                return null;
            return result.Cause == HoldingCancellationCause.TenantVoluntary
                ? result.ForfeitedAmount == result.VerifiedDeposit && result.RefundRequired == 0 ? result : null
                : result.ForfeitedAmount == 0 && result.RefundRequired == result.VerifiedDeposit ? result : null;
        }
        catch (JsonException) { return null; }
    }
    public static string Reference(Guid contractId, ContractSettlementReview review)
    {
        // FinancialSnapshot is jsonb: key order and whitespace can change at
        // persistence. Bind the typed v1 values, not the raw JSON spelling.
        var value = Decode(review);
        return "HOLDING-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            contractId, review.Id, review.Decision, value?.Kind, value?.Cause, value?.VerifiedDeposit,
            value?.ForfeitedAmount, value?.RefundRequired, value?.OwnerId, value?.DecidedAt, value?.Reason
        })));
    }
}
