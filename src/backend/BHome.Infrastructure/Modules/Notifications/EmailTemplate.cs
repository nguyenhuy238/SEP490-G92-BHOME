using System.Net;
using BHome.Application.Notifications;

namespace BHome.Infrastructure.Modules.Notifications;

// Version 2: table layout and inline styles remain usable without remote assets or scripting.
internal static class EmailTemplate
{
    internal const string BrandContentId = "bhome-brand-mark@bhome.notification";
    private const string Footer = "BHome — Hệ thống quản lý và vận hành nhà trọ.";
    private const string CredentialGuidance = "Bạn có thể đổi mật khẩu trong mục Hồ sơ cá nhân sau khi đăng nhập. Không chia sẻ mật khẩu này. Nếu không nhận ra thao tác cấp mật khẩu, vui lòng liên hệ người quản lý.";

    internal static string Subject(string title, string? eventType = null)
    {
        if (eventType == "STAFF_PASSWORD_ISSUED") return "BHOME | Thông tin tài khoản nhân viên";
        var safe = title.Replace('\r', ' ').Replace('\n', ' ');
        return (eventType == "HOLDING_CONFIRMED" || safe.StartsWith("BHOME", StringComparison.OrdinalIgnoreCase) ? "" : "[BHOME] ") + safe;
    }

    internal static string ActionLabel(string eventType) => eventType switch
    {
        "EMAIL_CONFIRMATION_REQUESTED" => "Xác nhận email",
        "PASSWORD_RESET_REQUESTED" => "Đặt lại mật khẩu",
        "ACCOUNT_INVITATION" or "TENANT_SETUP_AFTER_ACTIVATION" => "Thiết lập tài khoản",
        "STAFF_PASSWORD_ISSUED" => "Mở ứng dụng BHOME",
        "CONTRACT_SIGNING_INVITATION" => "Xem và ký hợp đồng",
        _ => "Mở BHOME"
    };

    internal static string Text(ChannelMessage message)
    {
        Validate(message.Title, message.Body, message.ActionUrl, message.MobileActionUrl, message.Credentials);
        var body = message.Title + "\n\n" + message.Body;
        if (message.Credentials is { } credentials)
            body += $"\n\nThông tin tài khoản\nTài khoản: {credentials.Account}\nMật khẩu được cấp: {credentials.Password}\nVai trò: Nhân viên vận hành\n\n{CredentialGuidance}";
        if (message.MobileActionUrl is { } mobile) body += "\n\nMở trong ứng dụng BHOME đã cài:\n" + mobile;
        body += "\n\n" + Footer;
        // Keep the primary action last for plain-text clients and existing controlled smoke probes.
        if (message.ActionUrl is { } url) body += "\n\n" + ActionLabel(message.EventType) + ":\n" + url;
        return body;
    }

    internal static string Html(string title, string body, string? actionUrl = null, string actionLabel = "Mở BHOME",
        string? mobileActionUrl = null, EmailCredentials? credentials = null, bool includeBrandMark = false)
    {
        Validate(title, body, actionUrl, mobileActionUrl, credentials);
        if (actionUrl is not null && string.IsNullOrWhiteSpace(actionLabel)) throw new ChannelDeliveryException("email_template_variables_missing");
        var paragraphs = string.Join("", body.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(text => $"<p style=\"margin:0 0 18px;font-size:15px;line-height:1.7;overflow-wrap:anywhere\">{Encode(text).Replace("\n", "<br>")}</p>"));
        var details = credentials is null ? "" : $$"""
            <h2 style="margin:24px 0 12px;font-size:17px;line-height:1.4;color:#15243e">Thông tin tài khoản</h2>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f6fc;border:1px solid #dbe4f2;border-radius:8px"><tr><td style="padding:18px">
            <p style="margin:0 0 4px;font-size:13px;color:#53657f">Tài khoản</p>
            <p style="margin:0 0 16px;font-size:15px;font-weight:bold;overflow-wrap:anywhere;word-break:break-word">{{Encode(credentials.Account)}}</p>
            <p style="margin:0 0 4px;font-size:13px;color:#53657f">Mật khẩu được cấp</p>
            <p dir="ltr" style="margin:0 0 16px;font-size:20px;font-weight:bold;overflow-wrap:anywhere;word-break:break-word">{{Encode(credentials.Password)}}</p>
            <p style="margin:0;font-size:14px;line-height:1.6">Vai trò: Nhân viên vận hành</p>
            </td></tr></table>
            <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#53657f">{{CredentialGuidance}}</p>
            """;
        var action = actionUrl is null ? "" : $$"""
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 18px"><tr><td align="center" bgcolor="#194cbb" style="border-radius:6px;mso-padding-alt:14px 24px">
            <a rel="noreferrer" href="{{Encode(actionUrl)}}" style="display:inline-block;border:1px solid #194cbb;border-radius:6px;background-color:#194cbb;color:#ffffff;font-size:15px;line-height:20px;font-weight:bold;padding:14px 24px;text-decoration:none">{{Encode(actionLabel)}}</a>
            </td></tr></table>
            <p style="margin:0;font-size:13px;line-height:1.7;color:#53657f">Nếu nút không mở được, hãy dùng <a rel="noreferrer" href="{{Encode(actionUrl)}}" style="color:#194cbb;text-decoration:underline">liên kết dự phòng</a>. Bạn có thể sao chép địa chỉ từ liên kết này. Không chia sẻ liên kết bảo mật.</p>
            """;
        var mobile = mobileActionUrl is null ? "" : $$"""
            <p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#53657f">Đã cài BHOME? <a rel="noreferrer" href="{{Encode(mobileActionUrl)}}" style="color:#194cbb;text-decoration:underline">Mở trong ứng dụng</a>. Nếu chưa cài, hãy dùng nút phía trên để tiếp tục trên trình duyệt.</p>
            """;
        var brand = includeBrandMark
            ? $"<img src=\"cid:{BrandContentId}\" alt=\"\" width=\"36\" height=\"36\" style=\"width:36px;height:36px;vertical-align:middle;margin-right:10px;border:0\" />"
            : "";
        return $$"""
            <!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{Encode(title)}}</title></head>
            <body style="margin:0;padding:0;background-color:#f4f7fc;color:#15243e;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fc"><tr><td align="center" style="padding:28px 12px">
            <!--[if mso]><table role="presentation" width="580" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:580px;background-color:#ffffff;border:1px solid #e2e8f2;border-radius:12px"><tr><td style="padding:28px 24px">
            <p style="margin:0 0 24px;font-size:24px;line-height:1.2;font-weight:bold;color:#194cbb">{{brand}}BHome</p>
            <h1 style="margin:0 0 22px;font-size:24px;line-height:1.35;font-weight:bold;color:#15243e;overflow-wrap:anywhere">{{Encode(title)}}</h1>
            {{paragraphs}}{{details}}{{action}}{{mobile}}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td style="border-top:1px solid #e2e8f2;padding-top:18px;font-size:12px;line-height:1.7;color:#53657f">{{Footer}}</td></tr></table>
            </td></tr></table>
            <!--[if mso]></td></tr></table><![endif]-->
            </td></tr></table></body></html>
            """;
    }

    private static string Encode(string text) => WebUtility.HtmlEncode(text);
    private static void Validate(string title, string body, string? actionUrl, string? mobileActionUrl, EmailCredentials? credentials)
    {
        if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(body) ||
            credentials is not null && (string.IsNullOrWhiteSpace(credentials.Account) || string.IsNullOrWhiteSpace(credentials.Password)))
            throw new ChannelDeliveryException("email_template_variables_missing");
        foreach (var url in new[] { actionUrl, mobileActionUrl })
            if (url is not null && (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 ||
                url.Any(char.IsControl) || !(uri.Scheme == "https" || uri.Scheme == "http" && uri.IsLoopback ||
                    uri.Scheme == "bhome" && uri.Host is "reset-password" or "accept-invitation" or "confirm-email" or "sign-contract")))
                throw new ChannelDeliveryException("email_action_url_invalid");
    }
}
