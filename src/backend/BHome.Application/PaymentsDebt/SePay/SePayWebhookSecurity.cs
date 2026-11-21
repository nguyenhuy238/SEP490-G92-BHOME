using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt.SePay;

public sealed class SePayWebhookSecurity(SePayOptions options, TimeProvider clock)
{
    public SePayTransaction Authenticate(ReadOnlySpan<byte> body, string timestamp, string signature)
    {
        if (!options.Enabled) throw new PaymentException(503, "sepay_disabled");
        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var unix) ||
            Math.Abs((decimal)clock.GetUtcNow().ToUnixTimeSeconds() - unix) > options.SignatureToleranceSeconds ||
            !Regex.IsMatch(signature, "^sha256=[a-fA-F0-9]{64}$")) throw new PaymentException(401, "sepay_authentication_failed");
        var prefix = Encoding.UTF8.GetBytes(timestamp + ".");
        var signed = new byte[prefix.Length + body.Length];
        prefix.CopyTo(signed, 0); body.CopyTo(signed.AsSpan(prefix.Length));
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.WebhookSecret!), signed);
        if (!CryptographicOperations.FixedTimeEquals(expected, Convert.FromHexString(signature[7..])))
            throw new PaymentException(401, "sepay_authentication_failed");
        return SePayTransaction.Parse(body, clock.GetUtcNow());
    }
}

public sealed record SePayTransaction(string Id, string Gateway, string TransactionDate, string AccountNumber,
    string? SubAccount, string? Code, string Content, string TransferType, decimal TransferAmount,
    string ReferenceCode, string? Description, decimal? Accumulated)
{
    public DateTimeOffset OccurredAt => ParseDate(TransactionDate);
    public static SePayTransaction Parse(ReadOnlySpan<byte> body, DateTimeOffset now)
    {
        try
        {
            // SePay webhook IDs may be numeric, while API v2 IDs are UUIDs.
            using var document = JsonDocument.Parse(body.ToArray());
            var root = document.RootElement;
            var id = root.GetProperty("id");
            var value = JsonSerializer.Deserialize<SePayPayload>(body, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
            var transaction = new SePayTransaction(id.ValueKind == JsonValueKind.String ? id.GetString()! : id.GetRawText(),
                value.Gateway, value.TransactionDate, value.AccountNumber, value.SubAccount, value.Code, value.Content,
                value.TransferType, value.TransferAmount, value.ReferenceCode, value.Description, value.Accumulated);
            transaction.Validate(now); return transaction;
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or ArgumentException)
        { throw new PaymentException(400, "invalid_sepay_transaction"); }
    }
    public void Validate(DateTimeOffset now)
    {
        var validId = long.TryParse(Id, NumberStyles.None, CultureInfo.InvariantCulture, out var numericId) && numericId > 0 || Guid.TryParse(Id, out var uuid) && uuid != Guid.Empty;
        if (!validId ||
            string.IsNullOrWhiteSpace(Gateway) || Gateway.Length > 80 || !Regex.IsMatch(AccountNumber ?? "", "^[0-9]{6,19}$") ||
            Content is null || Content.Length > 4000 || Description?.Length > 4000 || SubAccount?.Length > 100 || Code?.Length > 100 ||
            TransferType is not ("in" or "out") || !PaymentRules.ValidMoney(TransferAmount) ||
            Accumulated is { } balance && (decimal.Truncate(balance) != balance || Math.Abs(balance) >= 1_000_000_000_000_000_000m) ||
            !PaymentRules.ValidReference(ReferenceCode ?? "") || OccurredAt > now.AddMinutes(5))
            throw new PaymentException(400, "invalid_sepay_transaction");
    }
    private static DateTimeOffset ParseDate(string text)
    {
        if (DateTime.TryParseExact(text, "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
            return new DateTimeOffset(local, TimeSpan.FromHours(7)).ToUniversalTime();
        if (text is not null && Regex.IsMatch(text, "(Z|[+-][0-9]{2}:[0-9]{2})$") &&
            DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var offset)) return offset.ToUniversalTime();
        throw new FormatException("Invalid provider timestamp.");
    }
    private sealed record SePayPayload(string Gateway, string TransactionDate, string AccountNumber, string? SubAccount,
        string? Code, string Content, string TransferType, [property: JsonRequired] decimal TransferAmount,
        string ReferenceCode, string? Description, decimal? Accumulated);
}
