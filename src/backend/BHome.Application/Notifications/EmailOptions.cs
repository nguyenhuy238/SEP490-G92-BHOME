using System.Net;
using System.Net.Mail;

namespace BHome.Application.Notifications;

public sealed class EmailOptions
{
    public bool Enabled { get; set; }
    // "Smtp" uses authenticated STARTTLS. "Capture" is restricted to loopback in Development/Testing.
    public string DeliveryMode { get; set; } = "Smtp";
    public string Host { get; set; } = "smtp.gmail.com";
    public int Port { get; set; } = 587;
    public string Username { get; set; } = "";
    public string AppPassword { get; set; } = "";
    public string FromEmail { get; set; } = "";
    public string FromName { get; set; } = "BHOME";
    public bool UseStartTls { get; set; } = true;
    public int TimeoutSeconds { get; set; } = 30;
    public bool TestEnabled { get; set; }
    public string TestRecipient { get; set; } = "";

    public bool IsCapture => DeliveryMode == "Capture";

    public bool Valid() => !Enabled || (Port is >= 1 and <= 65535 &&
        ValidAddress(FromEmail) && TimeoutSeconds is >= 1 and <= 45 &&
        !FromName.Contains('\r') && !FromName.Contains('\n') &&
        (!TestEnabled || ValidAddress(TestRecipient)) &&
        (DeliveryMode switch
        {
            "Smtp" => !string.IsNullOrWhiteSpace(Host) && ValidAddress(Username) &&
                !string.IsNullOrWhiteSpace(AppPassword) && UseStartTls,
            // Stale SMTP credentials from local user-secrets are intentionally ignored in Capture.
            "Capture" => IsLoopbackHost(Host) && !UseStartTls,
            _ => false
        }));

    private static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);

    public static bool ValidAddress(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 254 &&
        !value.Contains('\r') && !value.Contains('\n') && MailAddress.TryCreate(value, out var address) &&
        address.Address == value && address.Host.Contains('.');
}

// Only safe codes cross the infrastructure boundary. Provider responses can contain private data.
public sealed class ChannelDeliveryException(string code, bool retryable = false, bool outcomeUnknown = false)
    : Exception("Notification channel delivery failed.")
{
    public string Code { get; } = code;
    public bool Retryable { get; } = retryable;
    public bool OutcomeUnknown { get; } = outcomeUnknown;
}
