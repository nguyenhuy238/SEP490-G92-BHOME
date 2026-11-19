using System.Net.Mail;

namespace BHome.Application.Notifications;

public sealed class EmailOptions
{
    public bool Enabled { get; set; }
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
    // Capture is plaintext SMTP to a loopback Mailpit only, allowed by the host in Development/Testing.
    public string DeliveryMode { get; set; } = "Smtp";
    public string[] AllowedRecipients { get; set; } = [];

    public bool LocalCapture => DeliveryMode == "Capture" && Host is "localhost" or "127.0.0.1" or "::1";
    public bool ValidForEnvironment(string environment) => Valid() && (!Enabled ||
        (DeliveryMode == "Capture" ? LocalCapture && environment is "Development" or "Testing" :
            environment is not ("Development" or "Testing" or "Staging") || AllowedRecipients.Length > 0));

    public bool RecipientAllowed(string destination) => AllowedRecipients.Length == 0 ||
        AllowedRecipients.Contains(destination, StringComparer.OrdinalIgnoreCase);

    public bool Valid() => !Enabled || (!string.IsNullOrWhiteSpace(Host) && Port is >= 1 and <= 65535 &&
        ValidAddress(FromEmail) &&
        (LocalCapture || DeliveryMode == "Smtp" && ValidAddress(Username) && !string.IsNullOrWhiteSpace(AppPassword) && UseStartTls) &&
        AllowedRecipients.All(ValidAddress) && TimeoutSeconds is >= 1 and <= 45 && !FromName.Contains('\r') && !FromName.Contains('\n') &&
        (!TestEnabled || ValidAddress(TestRecipient)));

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
