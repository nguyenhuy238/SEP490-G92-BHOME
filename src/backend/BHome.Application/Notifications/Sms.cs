using System.Globalization;
using System.Text.RegularExpressions;

namespace BHome.Application.Notifications;

public sealed class SmsOptions
{
    public bool Enabled { get; set; }
    public string Mode { get; set; } = "Mock";
    public string Provider { get; set; } = "Esms";
    public bool ProductionEnabled { get; set; }
    public string BaseUrl { get; set; } = "https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/";
    public string ApiKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string Brandname { get; set; } = "";
    public string SmsType { get; set; } = "2";
    public int TimeoutSeconds { get; set; } = 10;
    public string CallbackUrl { get; set; } = "";
    public bool LiveTestEnabled { get; set; }
    public bool DemoIsolated { get; set; }
    public Dictionary<Guid, string> DemoAccounts { get; set; } = [];
    public string[] EnabledTemplates { get; set; } = [];
    public string[] ApprovedTemplates { get; set; } = [];

    public bool Valid() => Mode is "Mock" or "Sandbox" or "Production" && Provider == "Esms" &&
        TimeoutSeconds is >= 1 and <= 30 && SmsType == "2" &&
        (!Enabled || Mode == "Mock" || !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(SecretKey) &&
            Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.Host == "rest.esms.vn" &&
            uri.AbsolutePath == "/MainService.svc/json/SendMultipleMessage_V4_post_json/" && string.IsNullOrEmpty(uri.Query) &&
            string.IsNullOrEmpty(uri.UserInfo)) &&
        (string.IsNullOrEmpty(CallbackUrl) || Uri.TryCreate(CallbackUrl, UriKind.Absolute, out var callback) && callback.Scheme == "https" && string.IsNullOrEmpty(callback.UserInfo)) &&
        EnabledTemplates.All(SmsTemplates.Contains) && ApprovedTemplates.All(SmsTemplates.Contains);

    public bool MockAllowed(string environment) => Enabled && Mode == "Mock" && DemoIsolated &&
        environment is "Development" or "Demo" or "Testing";
}

public static partial class VietnameseSmsPhone
{
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input) || input.Length > 30) return null;
        var phone = new string(input.Trim().Where(c => c is not (' ' or '-' or '.' or '(' or ')')).ToArray());
        if (phone.StartsWith("+84", StringComparison.Ordinal)) phone = "0" + phone[3..];
        else if (phone.StartsWith("84", StringComparison.Ordinal)) phone = "0" + phone[2..];
        return Mobile().IsMatch(phone) ? "84" + phone[1..] : null;
    }
    public static string Mask(string phone) => phone.Length < 4 ? "***" : "***" + phone[^4..];
    [GeneratedRegex("^0[35789][0-9]{8}$", RegexOptions.CultureInvariant)]
    private static partial Regex Mobile();
}

public sealed record SmsMessage(Guid RecipientId, string Phone, string TemplateId,
    IReadOnlyDictionary<string, string> Variables, string IdempotencyKey, DateTimeOffset? ExpiresAt = null)
{
    public override string ToString() => $"SMS {TemplateId} ({VietnameseSmsPhone.Mask(Phone)})";
}
public sealed record SmsReceipt(string Status, string ProviderReference);
public interface ISmsSender
{
    bool IsConfigured { get; }
    Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken token);
}

// Proposed templates; production requires explicit provider approval for each identifier.
public static partial class SmsTemplates
{
    private static readonly IReadOnlyDictionary<string, string> Templates = new Dictionary<string, string>
    {
        ["SMS-01"] = "BHOME: Ma OTP dat lai mat khau la {OTP}. Ma co hieu luc trong {MINUTES} phut. Khong chia se ma nay.",
        ["SMS-02"] = "BHOME: Hop dong {CONTRACT_CODE} da san sang de ky. Vui long kiem tra loi moi ky trong email hoac ung dung BHOME.",
        ["SMS-03"] = "BHOME: Hoa don phong {ROOM} ky {PERIOD} da duoc phat hanh. Vui long dang nhap BHOME de xem chi tiet.",
        ["SMS-04"] = "BHOME: Hoa don phong {ROOM} ky {PERIOD} da qua han thanh toan. Vui long kiem tra cong no tren BHOME.",
        ["SMS-05"] = "BHOME: Hop dong {CONTRACT_CODE} se het han ngay {EXPIRY_DATE}. Vui long kiem tra tren BHOME.",
        ["SMS-06"] = "BHOME CANH BAO: Co su co khan cap tai {LOCATION}, phong {ROOM}. Vui long kiem tra va xu ly kip thoi."
    };
    public static bool Contains(string id) => Templates.ContainsKey(id);
    public static string Render(string id, IReadOnlyDictionary<string, string> variables)
    {
        if (!Templates.TryGetValue(id, out var template)) throw new ChannelDeliveryException("sms_template_unknown");
        var result = Placeholder().Replace(template, match =>
        {
            if (!variables.TryGetValue(match.Groups[1].Value, out var value) || string.IsNullOrWhiteSpace(value) || value.Length > 80)
                throw new ChannelDeliveryException("sms_template_variable_invalid");
            var text = value.Normalize(System.Text.NormalizationForm.FormD);
            return string.Concat(text.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark))
                .Replace('đ', 'd').Replace('Đ', 'D').Aggregate("", (s, c) => s + (c is >= ' ' and <= '~' && c is not ('{' or '}') ? c : ' ')).Trim();
        });
        // Application cap, not a claim about billable SMS segments. Only GSM-safe ASCII templates are used.
        if (result.Length > 459) throw new ChannelDeliveryException("sms_content_too_long");
        return result;
    }
    [GeneratedRegex("\\{([A-Z_]+)\\}", RegexOptions.CultureInvariant)]
    private static partial Regex Placeholder();
}
