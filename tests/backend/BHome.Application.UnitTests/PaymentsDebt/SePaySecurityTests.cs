using System.Security.Cryptography;
using System.Text;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;

namespace BHome.Application.UnitTests.PaymentsDebt;

public sealed class SePaySecurityTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 5, 0, 0, TimeSpan.Zero);
    private const string Secret = "synthetic-sepay-test-secret-at-least-32-characters";
    private const string Body = """{"id":123,"gateway":"ACB","transactionDate":"2026-11-12 12:00:00","accountNumber":"0000001234","subAccount":null,"code":"BH12345678","content":"BH12345678","transferType":"in","transferAmount":100000,"referenceCode":"SYN-123","description":"Synthetic","accumulated":100000}""";
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private static string Signature(string body, string timestamp) => "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes(timestamp + "." + body)));
    private static SePayWebhookSecurity Security() => new(new SePayOptions { Enabled = true, WebhookSecret = Secret }, new Clock());

    [Fact]
    public void ValidSignaturePreservesUnknownPayerAndConvertsVietnamTime()
    {
        var time = Now.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var transaction = Security().Authenticate(Encoding.UTF8.GetBytes(Body), time, Signature(Body, time));
        Assert.Equal("123", transaction.Id); Assert.Equal(Now, transaction.OccurredAt); Assert.Equal(100000, transaction.TransferAmount);
    }
    [Theory]
    [InlineData("", "")]
    [InlineData("0", "sha256=bad")]
    [InlineData("1794459600", "sha256=0000000000000000000000000000000000000000000000000000000000000000")]
    public void RejectsMalformedOrInvalidAuthentication(string timestamp, string signature) =>
        Assert.Equal(401, Assert.Throws<PaymentException>(() => Security().Authenticate(Encoding.UTF8.GetBytes(Body), timestamp, signature)).Status);

    [Fact]
    public void RejectsExpiredSignatureAndTamperedRawBody()
    {
        var old = Now.AddMinutes(-6).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(401, Assert.Throws<PaymentException>(() => Security().Authenticate(Encoding.UTF8.GetBytes(Body), old, Signature(Body, old))).Status);
        var time = Now.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(401, Assert.Throws<PaymentException>(() => Security().Authenticate(Encoding.UTF8.GetBytes(Body + " "), time, Signature(Body, time))).Status);
    }
    [Theory]
    [InlineData("{")]
    [InlineData("{}")]
    public void ParsesOnlyAfterSuccessfulAuthentication(string body)
    {
        var time = Now.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(400, Assert.Throws<PaymentException>(() => Security().Authenticate(Encoding.UTF8.GetBytes(body), time, Signature(body, time))).Status);
    }
    [Fact]
    public void ConfigurationSeparatesEnvironmentAndCredentials()
    {
        var options = new SePayOptions { Enabled = true, WebhookSecret = Secret, ReceivingAccounts = [new() { LocationId = Guid.NewGuid(), BankIdentifier = "970416", Gateway = "ACB", AccountNumber = "0000001234" }] };
        Assert.True(options.Valid("Testing")); Assert.False(options.Valid("Production"));
        options.ApiBaseUrl = "https://userapi.sepay.vn/v2"; Assert.False(options.Valid("Testing"));
        options.Enabled = false; Assert.True(options.Valid("Production"));
    }
}
