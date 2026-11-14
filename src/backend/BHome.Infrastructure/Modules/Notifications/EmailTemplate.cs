using System.Net;

namespace BHome.Infrastructure.Modules.Notifications;

internal static class EmailTemplate
{
    internal static string Subject(string title) => "[BHOME] " + title.Replace('\r', ' ').Replace('\n', ' ');

    internal static string ActionLabel(string eventType) => eventType switch
    {
        "EMAIL_CONFIRMATION_REQUESTED" => "Xác nhận email",
        "PASSWORD_RESET_REQUESTED" => "Đặt lại mật khẩu",
        "ACCOUNT_INVITATION" => "Thiết lập tài khoản",
        "CONTRACT_SIGNING_INVITATION" => "Mở BHOME để ký hợp đồng",
        _ => "Mở liên kết bảo mật BHOME"
    };

    internal static string Html(string title, string body, string? actionUrl = null, string actionLabel = "Mở liên kết bảo mật BHOME")
    {
        var text = WebUtility.HtmlEncode(body).Replace("\r\n", "\n").Replace("\n", "<br>");
        var url = WebUtility.HtmlEncode(actionUrl);
        // Keep the action before repeated body/footer text. Gmail may trim repeated content
        // or remove a localhost/native href; visible URL text remains available to copy.
        var action = actionUrl is null ? "" : $$"""
            <tr><td style="padding:16px 0">
            <a rel="noreferrer" href="{{url}}" style="display:inline-block;background-color:#166534;color:#ffffff;padding:14px 24px;border-radius:6px;font-weight:bold;text-decoration:none">{{WebUtility.HtmlEncode(actionLabel)}}</a>
            <p style="font-size:13px;line-height:1.6">Nếu nút không mở được, hãy sao chép toàn bộ liên kết dưới đây và dán vào thanh địa chỉ trình duyệt hoặc mở bằng ứng dụng BHOME. Không chia sẻ liên kết này.</p>
            <p dir="ltr" style="font-size:12px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere">{{url}}</p>
            </td></tr>
            """;
        var guidance = actionUrl is null ? "<p>Vui lòng mở ứng dụng BHOME để xem thông tin và thực hiện thao tác trong phạm vi được phép.</p>" : "";
        return $$"""
            <!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px"><tr><td style="padding:24px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td><div style="font-size:24px;font-weight:bold;color:#166534">BHOME</div>
            <h1 style="font-size:20px">{{WebUtility.HtmlEncode(title)}}</h1></td></tr>
            {{action}}
            <tr><td><p style="line-height:1.7">{{text}}</p>{{guidance}}
            <p>Trân trọng,<br>BHOME</p></td></tr>
            </table></td></tr></table></td></tr></table></body></html>
            """;
    }
}
