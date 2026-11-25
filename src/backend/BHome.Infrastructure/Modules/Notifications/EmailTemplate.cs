using System.Net;
using System.Text.RegularExpressions;
using BHome.Application.Notifications;

namespace BHome.Infrastructure.Modules.Notifications;

// Transactional email: shared table layout, inline styles and local embedded branding.
internal static class EmailTemplate
{
    internal const string BrandContentId = "bhome-brand-mark@bhome.notification";
    private const string Footer = "Đây là email được gửi tự động từ hệ thống BHome.";
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
        string? mobileActionUrl = null, EmailCredentials? credentials = null, bool includeBrandMark = false,
        string? eventType = null)
    {
        Validate(title, body, actionUrl, mobileActionUrl, credentials);
        if (actionUrl is not null && string.IsNullOrWhiteSpace(actionLabel)) throw new ChannelDeliveryException("email_template_variables_missing");
        var paragraphs = string.Join("", body.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(text => RenderParagraph(text, eventType)));
        var details = credentials is null ? "" : $$"""
            <h2 style="margin:20px 0 10px;font-size:17px;line-height:1.4;color:#062757">Thông tin tài khoản</h2>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:6px"><tr><td style="padding:16px">
            <p style="margin:0 0 4px;font-size:13px;color:#53657f">Tài khoản</p>
            <p style="margin:0 0 16px;font-size:15px;font-weight:bold;overflow-wrap:anywhere;word-break:break-word">{{Encode(credentials.Account)}}</p>
            <p style="margin:0 0 4px;font-size:13px;color:#53657f">Mật khẩu được cấp</p>
            <p dir="ltr" style="margin:0 0 16px;font-size:20px;font-weight:bold;overflow-wrap:anywhere;word-break:break-word">{{Encode(credentials.Password)}}</p>
            <p style="margin:0;font-size:14px;line-height:1.6">Vai trò: Nhân viên vận hành</p>
            </td></tr></table>
            <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#53657f">{{CredentialGuidance}}</p>
            """;
        var action = actionUrl is null ? "" : $$"""
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 14px"><tr><td align="center" bgcolor="#005ecc" style="border-radius:6px;mso-padding-alt:12px 20px">
            <a rel="noreferrer" href="{{Encode(actionUrl)}}" style="display:inline-block;border:1px solid #005ecc;border-radius:6px;background-color:#005ecc;color:#ffffff;font-size:15px;line-height:20px;font-weight:bold;padding:12px 20px;text-decoration:none">{{Encode(actionLabel)}}</a>
            </td></tr></table>
            <p style="margin:0;font-size:13px;line-height:1.7;color:#53657f">Nếu nút không mở được, hãy dùng <a rel="noreferrer" href="{{Encode(actionUrl)}}" style="color:#194cbb;text-decoration:underline">liên kết dự phòng</a>. Bạn có thể sao chép địa chỉ từ liên kết này. Không chia sẻ liên kết bảo mật.</p>
            """;
        var mobile = mobileActionUrl is null ? "" : $$"""
            <p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#53657f">Đã cài BHOME? <a rel="noreferrer" href="{{Encode(mobileActionUrl)}}" style="color:#194cbb;text-decoration:underline">Mở trong ứng dụng</a>. Nếu chưa cài, hãy dùng nút phía trên để tiếp tục trên trình duyệt.</p>
            """;
        var brand = includeBrandMark
            ? $"<img src=\"cid:{BrandContentId}\" alt=\"Logo BHome\" width=\"36\" height=\"36\" style=\"width:36px;height:36px;vertical-align:middle;margin-right:8px;border:0\" />"
            : "";
        return $$"""
            <!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{Encode(title)}}</title></head>
            <body style="margin:0;padding:0;background-color:#ffffff;color:#1f2937;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
            <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">Thông báo từ BHome. Mở email để xem chi tiết.</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff"><tr><td align="center" style="padding:16px 12px">
            <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px"><tr><td style="padding:24px 20px">
            <p style="margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;font-size:22px;line-height:1.2;font-weight:bold;color:#062757">{{brand}}BHome</p>
            <h1 style="margin:0 0 18px;font-size:24px;line-height:1.35;font-weight:bold;color:#062757;overflow-wrap:anywhere">{{Encode(title)}}</h1>
            {{paragraphs}}{{details}}{{action}}{{mobile}}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:13px;line-height:1.6;color:#53657f">{{Footer}}</td></tr></table>
            </td></tr></table>
            <!--[if mso]></td></tr></table><![endif]-->
            </td></tr></table></body></html>
            """;
    }

    private static string RenderParagraph(string text, string? eventType)
    {
        const string paragraphStyle = "margin:0 0 14px;font-size:15px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word";
        string Paragraph(string content) => $"<p style=\"{paragraphStyle}\">{Encode(content).Replace("\n", "<br>")}</p>";
        if (eventType == "CONTRACT_SIGNING_INVITATION")
        {
            // The existing sender supplies the real OTP and validity period. Only emphasize the
            // exact leading code; never copy it into the subject or preheader.
            var code = Regex.Match(text, @"\A(Mã (?:OTP|xác nhận) của bạn: )([0-9]{6})(?=\.|\s|$)");
            if (code.Success)
                return $"<p style=\"margin:0;font-size:14px;color:#53657f\">{Encode(code.Groups[1].Value.TrimEnd())}</p>" +
                    $"<p dir=\"ltr\" style=\"margin:6px 0 12px;color:#062757;font-size:32px;font-weight:bold;letter-spacing:4px;line-height:1.3\">{Encode(code.Groups[2].Value)}</p>" +
                    Paragraph(text[code.Length..].TrimStart('.', ' '));
        }

        // Only structured backend-generated sections become tables. Mixed/free-text sections
        // remain paragraphs, with all content encoded and the original order retained.
        if (eventType is "HOLDING_CONFIRMED" or "CONTRACT_ACTIVATED" or "TENANT_SETUP_AFTER_ACTIVATION" or
            "INVOICE_FINALIZED" or "INVOICE_DUE_SOON" or "INVOICE_OVERDUE" or "INVOICE_FULLY_PAID" or
            "PAYMENT_PARTIALLY_CONFIRMED" or "CONTRACT_EXPIRY_REMINDER" or "INCIDENT_EMERGENCY_SUBMITTED")
        {
            var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            var hasHeading = lines.Length > 0 && lines[0] == "Thông tin:";
            var rows = lines.Skip(hasHeading ? 1 : 0).Select(line => line.StartsWith("- ", StringComparison.Ordinal) ? line[2..] : line)
                .Select(line => (Line: line, Separator: line.IndexOf(": ", StringComparison.Ordinal))).ToArray();
            if (rows.Length > 1 && rows.All(row => row.Separator > 0 &&
                row.Line[..row.Separator] is "Cơ sở" or "Phòng" or "Hợp đồng" or "Thời hạn" or "Thời gian giữ chỗ" or
                "Số tiền giữ chỗ" or "Số tiền thanh toán đã xác minh" or "Tiền giữ chỗ đã áp dụng" or "Trạng thái" or
                "Trạng thái hợp đồng" or "Tài khoản đăng nhập" or "Trạng thái tài khoản" or "Kỳ thanh toán" or
                "Hạn thanh toán" or "Ngày hết hạn"))
            {
                var tableRows = string.Concat(rows.Select(row =>
                {
                    var label = row.Line[..row.Separator];
                    var value = row.Line[(row.Separator + 2)..];
                    var statusStyle = (label is "Trạng thái" or "Trạng thái hợp đồng" or "Trạng thái tài khoản") &&
                        (value is "Đã giữ chỗ thành công" or "Đang hoạt động")
                        ? "color:#16753b;font-weight:bold;" : "";
                    return $"<tr><th scope=\"row\" align=\"left\" valign=\"top\" style=\"width:42%;padding:9px 10px;font-size:14px;font-weight:normal;color:#53657f;border-bottom:1px solid #e5e7eb\">{Encode(label)}</th>" +
                        $"<td valign=\"top\" style=\"padding:9px 10px;font-size:15px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;border-bottom:1px solid #e5e7eb;{statusStyle}\">{Encode(value)}</td></tr>";
                }));
                return (hasHeading ? Paragraph(lines[0]) : "") +
                    $"<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 0 16px;border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate\">{tableRows}</table>";
            }
        }
        return Paragraph(text);
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
                    uri.Scheme == "bhome" && uri.Host is "reset-password" or "accept-invitation" or "confirm-email" or "sign-contract" or "open-invoice")))
                throw new ChannelDeliveryException("email_action_url_invalid");
    }
}
