namespace BHome.Application.PaymentsDebt.SePay;

public sealed class SePayOptions
{
    public const string WebhookRoute = "/api/v1/integrations/sepay/webhook";
    public static string WebhookRouteFor(string mode) => "/api/v1/integrations/sepay/" + mode + "/webhook";
    public bool Enabled { get; set; }
    public string Mode { get; set; } = "Test";
    public string ApiBaseUrl { get; set; } = "https://userapi-sandbox.sepay.vn/v2";
    public string? ApiToken { get; set; }
    public string? WebhookSecret { get; set; }
    public string WebhookPath { get; set; } = WebhookRoute;
    public string PaymentCodePrefix { get; set; } = "BH";
    public int RequestTimeoutSeconds { get; set; } = 15;
    public int SignatureToleranceSeconds { get; set; } = 300;
    public int PollIntervalSeconds { get; set; } = 30;
    public List<SePayReceivingAccount> ReceivingAccounts { get; set; } = [];
    // Explicit routing ownership for pre-namespace codes, separately for each profile/deployment.
    public List<string> LegacyPaymentCodes { get; set; } = [];
    public bool Owns(PaymentCode code) => !DualMode || code.InstanceCode == InstanceCode ||
        code.InstanceCode is null && (LegacyServerMode == code.Mode || For(code.Mode).LegacyPaymentCodes.Contains(code.Code, StringComparer.Ordinal));
    // Legacy flat configuration remains supported. New deployments configure both profiles.
    public SePayOptions? Test { get; set; }
    public SePayOptions? Live { get; set; }
    public string InstanceCode { get; set; } = "";
    public Guid? OwnerUserId { get; set; }
    public string? LegacyServerMode { get; set; }
    public bool DualMode => Test is not null || Live is not null;
    public IEnumerable<SePayOptions> Profiles => DualMode
        ? new[] { For("Test"), For("Live") }.Where(p => p.Enabled) : new[] { this }.Where(p => p.Enabled);
    public SePayOptions Copy() => (SePayOptions)MemberwiseClone();
    public void Restore(SePayOptions source)
    {
        Enabled = source.Enabled; Mode = source.Mode; ApiBaseUrl = source.ApiBaseUrl;
        ApiToken = source.ApiToken; WebhookSecret = source.WebhookSecret; WebhookPath = source.WebhookPath;
        PaymentCodePrefix = source.PaymentCodePrefix; RequestTimeoutSeconds = source.RequestTimeoutSeconds;
        SignatureToleranceSeconds = source.SignatureToleranceSeconds; PollIntervalSeconds = source.PollIntervalSeconds;
        ReceivingAccounts = source.ReceivingAccounts; LegacyPaymentCodes = source.LegacyPaymentCodes;
        Test = source.Test; Live = source.Live; InstanceCode = source.InstanceCode;
        OwnerUserId = source.OwnerUserId; LegacyServerMode = source.LegacyServerMode;
    }
    public SePayOptions For(string mode)
    {
        if (mode is not ("Test" or "Live")) throw new PaymentException(400, "invalid_payment_mode");
        if (!DualMode) return Mode == mode ? this : new SePayOptions { Mode = mode };
        var profile = (mode == "Test" ? Test : Live)?.Copy() ?? new SePayOptions();
        profile.Mode = mode;
        if (profile.WebhookPath == WebhookRoute) profile.WebhookPath = WebhookRouteFor(mode);
        profile.Enabled = Enabled && profile.Enabled;
        profile.InstanceCode = InstanceCode;
        return profile;
    }
    // Only request/job scoped copies are selected; the immutable startup configuration is never changed.
    public void Select(string mode)
    {
        var selected = For(mode);
        Mode = selected.Mode; Enabled = selected.Enabled; ApiBaseUrl = selected.ApiBaseUrl;
        ApiToken = selected.ApiToken; WebhookSecret = selected.WebhookSecret; WebhookPath = selected.WebhookPath;
        ReceivingAccounts = selected.ReceivingAccounts; LegacyPaymentCodes = selected.LegacyPaymentCodes; RequestTimeoutSeconds = selected.RequestTimeoutSeconds;
        SignatureToleranceSeconds = selected.SignatureToleranceSeconds; PollIntervalSeconds = selected.PollIntervalSeconds;
    }

    public bool TestingAvailable(string environment) => For("Test").Enabled;

    public bool Valid(string environment)
    {
        if (!Enabled) return true;
        if (DualMode) return System.Text.RegularExpressions.Regex.IsMatch(InstanceCode, "^[A-Z0-9]{4}$") &&
            Mode is "Test" or "Live" && For(Mode).Enabled && Profiles.All(p => p.Valid(environment)) &&
            (Test?.Enabled != true || Live?.Enabled != true ||
                Test.WebhookSecret != Live.WebhookSecret &&
                (string.IsNullOrEmpty(Test.ApiToken) || string.IsNullOrEmpty(Live.ApiToken) || Test.ApiToken != Live.ApiToken));
        var expectedApi = Mode == "Test" ? "https://userapi-sandbox.sepay.vn/v2" : "https://userapi.sepay.vn/v2";
        return Mode is "Test" or "Live" &&
            ApiBaseUrl.TrimEnd('/') == expectedApi && (WebhookPath == WebhookRoute || WebhookPath == WebhookRouteFor(Mode)) && PaymentCodePrefix == "BH" &&
            WebhookSecret is { Length: >= 32 } && !WebhookSecret.Contains("replace", StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrEmpty(ApiToken) || !ApiToken.Contains("replace", StringComparison.OrdinalIgnoreCase) && !ApiToken.Contains('\r') && !ApiToken.Contains('\n')) &&
            RequestTimeoutSeconds is >= 1 and <= 30 && SignatureToleranceSeconds is >= 1 and <= 300 &&
            PollIntervalSeconds is >= 30 and <= 3600 &&
            LegacyPaymentCodes.All(code => System.Text.RegularExpressions.Regex.IsMatch(code, "^BH[0-9]{8}$")) &&
            LegacyPaymentCodes.Distinct(StringComparer.Ordinal).Count() == LegacyPaymentCodes.Count &&
            ReceivingAccounts.Count > 0 &&
            ReceivingAccounts.All(a => a.Valid()) && ReceivingAccounts.Select(a => a.OwnerUserId != Guid.Empty
                ? "owner:" + a.OwnerUserId + ":" + a.Gateway.ToUpperInvariant() + ":" + a.BankIdentifier + ":" + a.AccountNumber
                : "location:" + a.LocationId + ":" + a.Gateway.ToUpperInvariant() + ":" + a.BankIdentifier + ":" + a.AccountNumber).Distinct().Count() == ReceivingAccounts.Count;
    }

    public bool Bound(Guid locationId, Guid ownerId) => ReceivingAccounts.Any(a =>
        a.OwnerUserId != Guid.Empty ? a.OwnerUserId == ownerId : a.LocationId == locationId);

    public bool Matches(Guid locationId, BHome.Domain.PaymentsDebt.ReceivingBankAccount account, string? gateway = null) =>
        ReceivingAccounts.Any(a => (a.OwnerUserId != Guid.Empty
            ? a.OwnerUserId == account.OwnerUserId && account.OwnerUserId != Guid.Empty
            : a.LocationId == locationId) && a.BankIdentifier == account.BankIdentifier &&
            a.AccountNumber == account.AccountNumber && (gateway is null ||
                a.Gateway.Equals(gateway, StringComparison.OrdinalIgnoreCase)));
}

public sealed class SePayReceivingAccount
{
    public Guid LocationId { get; set; }
    public Guid OwnerUserId { get; set; }
    public string BankIdentifier { get; set; } = "";
    public string Gateway { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    internal bool Valid() => (LocationId != Guid.Empty) != (OwnerUserId != Guid.Empty) &&
        System.Text.RegularExpressions.Regex.IsMatch(BankIdentifier, "^[0-9]{6}$") &&
        System.Text.RegularExpressions.Regex.IsMatch(AccountNumber, "^[0-9]{6,19}$") &&
        System.Text.RegularExpressions.Regex.IsMatch(Gateway, "^[A-Za-z0-9 -]{2,80}$");
}
