using System.Net;
using System.Text;

namespace BHome.Infrastructure.Modules.Notifications;

internal static class EmailTemplate
{
    internal static string Subject(string title) => "[BHOME] " + title.Replace('\r', ' ').Replace('\n', ' ');

    internal static string Html(string title, string body, string? actionUrl = null)
    {
        var text = WebUtility.HtmlEncode(body).Replace("\r\n", "\n").Replace("\n", "<br>");
        var action = actionUrl is null ? "" : $"<p><a rel=\"noreferrer\" href=\"{WebUtility.HtmlEncode(actionUrl)}\">Mở liên kết bảo mật BHOME</a></p>";
        return $$"""
            <!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937">
            <main style="max-width:600px;margin:24px auto;padding:24px;background:white;border-radius:8px">
            <div style="font-size:24px;font-weight:bold;color:#166534">BHOME</div>
            <h1 style="font-size:20px">{{WebUtility.HtmlEncode(title)}}</h1>
            <p style="line-height:1.7">{{text}}</p>{{action}}
            <p>Vui lòng mở ứng dụng BHOME để xem thông tin và thực hiện thao tác trong phạm vi được phép.</p>
            <p>Trân trọng,<br>BHOME</p></main></body></html>
            """;
    }
}
