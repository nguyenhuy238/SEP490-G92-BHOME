namespace BHome.Application.PaymentsDebt.SePay;

public sealed class SePayOptions
{
    public const string WebhookRoute = "/api/v1/integrations/sepay/webhook";
    public bool Enabled { get; set; }
    public string Mode { get; set; } = "Test";
    public string ApiBaseUrl { get; set; } = "https://userapi-sandbox.sepay.vn/v2";
    public string? ApiToken { get; set; }
    public string? WebhookSecret { get; set; }
    public string WebhookPath { get; set; } = WebhookRoute;
    public string PaymentCodePrefix { get; set; } = "BH";
    public int RequestTimeoutSeconds { get; set; } = 15;
    public int SignatureToleranceSeconds { get; set; } = 300;
    public int PollIntervalSeconds { get; set; } = 60;
    public List<SePayReceivingAccount> ReceivingAccounts { get; set; } = [];

    public bool Valid(string environment)
    {
        if (!Enabled) return true;
        var expectedApi = Mode == "Test" ? "https://userapi-sandbox.sepay.vn/v2" : "https://userapi.sepay.vn/v2";
        return Mode is "Test" or "Live" && (Mode == "Test") == (environment is "Development" or "Testing") &&
            ApiBaseUrl.TrimEnd('/') == expectedApi && WebhookPath == WebhookRoute && PaymentCodePrefix == "BH" &&
            WebhookSecret is { Length: >= 32 } && !WebhookSecret.Contains("replace", StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrEmpty(ApiToken) || !ApiToken.Contains("replace", StringComparison.OrdinalIgnoreCase) && !ApiToken.Contains('\r') && !ApiToken.Contains('\n')) &&
            RequestTimeoutSeconds is >= 1 and <= 30 && SignatureToleranceSeconds is >= 1 and <= 300 &&
            PollIntervalSeconds is >= 30 and <= 3600 && ReceivingAccounts.Count > 0 &&
            ReceivingAccounts.All(a => a.Valid()) && ReceivingAccounts.Select(a => a.LocationId).Distinct().Count() == ReceivingAccounts.Count;
    }
}

public sealed class SePayReceivingAccount
{
    public Guid LocationId { get; set; }
    public string BankIdentifier { get; set; } = "";
    public string Gateway { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    internal bool Valid() => LocationId != Guid.Empty &&
        System.Text.RegularExpressions.Regex.IsMatch(BankIdentifier, "^[0-9]{6}$") &&
        System.Text.RegularExpressions.Regex.IsMatch(AccountNumber, "^[0-9]{6,19}$") &&
        System.Text.RegularExpressions.Regex.IsMatch(Gateway, "^[A-Za-z0-9 -]{2,80}$");
}
