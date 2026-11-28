using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;

internal static class IdentityPrivateReview
{
    private sealed record ReviewedImage(int Index, OcrDocumentKind Side, string Condition, OcrProposal Proposal, long Milliseconds);

    // Human truth is entered locally as correct/incorrect/unreadable flags.
    // Images and extracted values exist only in RAM and no-store loopback responses.
    public static async Task<int> Run(string models, string input, string report)
    {
        var files = Directory.EnumerateFiles(input).Where(file => Path.GetExtension(file).ToLowerInvariant() is ".jpg" or ".jpeg" or ".png")
            .Order(StringComparer.Ordinal).Take(5).ToArray();
        if (files.Length != 4) throw new InvalidDataException();
        var options = new OcrOptions { Enabled = true, ModelDirectory = models };
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        using var reservation = new TcpListener(IPAddress.Loopback, 0);
        reservation.Start();
        var port = ((IPEndPoint)reservation.LocalEndpoint).Port;
        reservation.Stop();
        var prefix = $"http://127.0.0.1:{port}/";
        var secret = Guid.NewGuid().ToString("N");
        var route = "/" + secret + "/";
        using var listener = new HttpListener();
        listener.Prefixes.Add(prefix);
        listener.Start();
        Console.WriteLine("Private local review opened. No identity values or images are logged.");
        Process.Start(new ProcessStartInfo(prefix + secret + "/") { UseShellExecute = true });
        var reviewed = new List<ReviewedImage>();
        var saved = false;
        using var expiry = new CancellationTokenSource(TimeSpan.FromMinutes(45));
        using var stop = expiry.Token.Register(listener.Stop);
        while (listener.IsListening)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync(); }
            catch (HttpListenerException) when (expiry.IsCancellationRequested) { break; }
            context.Response.Headers["Cache-Control"] = "no-store, max-age=0";
            context.Response.Headers["Pragma"] = "no-cache";
            context.Response.Headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            try
            {
                var path = context.Request.Url!.AbsolutePath;
                if (!path.StartsWith(route, StringComparison.Ordinal) || !context.Request.IsLocal)
                { context.Response.StatusCode = 404; continue; }
                var action = path[route.Length..];
                if (context.Request.HttpMethod == "GET" && action.StartsWith("image/", StringComparison.Ordinal))
                {
                    if (!int.TryParse(action[6..], out var index) || index is < 0 or > 3) { context.Response.StatusCode = 404; continue; }
                    context.Response.ContentType = Path.GetExtension(files[index]).Equals(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";
                    await using var image = File.OpenRead(files[index]);
                    await image.CopyToAsync(context.Response.OutputStream, expiry.Token);
                    continue;
                }
                var form = new Dictionary<string, string>();
                if (context.Request.HttpMethod == "POST")
                {
                    if (context.Request.ContentLength64 is < 0 or > 8192) { context.Response.StatusCode = 400; continue; }
                    using var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8);
                    var body = await reader.ReadToEndAsync(expiry.Token);
                    foreach (var entry in body.Split('&'))
                    {
                        var pair = entry.Split('=', 2);
                        if (pair.Length == 2) form[WebUtility.UrlDecode(pair[0])] = WebUtility.UrlDecode(pair[1]);
                    }
                }
                if (action == "run" && context.Request.HttpMethod == "POST")
                {
                    reviewed.Clear();
                    for (var index = 0; index < files.Length; index++)
                    {
                        if (!form.TryGetValue("side" + index, out var side) || side is not ("front" or "back") ||
                            !form.TryGetValue("condition" + index, out var condition) || condition is not ("normal" or "hard")) throw new InvalidDataException();
                        await using var image = File.OpenRead(files[index]);
                        var clock = Stopwatch.StartNew();
                        var kind = side == "front" ? OcrDocumentKind.IdentityFront : OcrDocumentKind.IdentityBack;
                        var proposal = await service.ExtractAsync(image, kind, expiry.Token);
                        reviewed.Add(new(index, kind, condition, proposal, clock.ElapsedMilliseconds));
                    }
                }
                if (action == "save" && context.Request.HttpMethod == "POST" && reviewed.Count == 4)
                {
                    var results = reviewed.Select(item => new
                    {
                        imageIndex = item.Index,
                        profile = item.Side.ToString(),
                        item.Condition,
                        elapsedMilliseconds = item.Milliseconds,
                        fields = Expected(item).ToDictionary(field => field, field => form.GetValueOrDefault(item.Index + "." + field, "pending")),
                        warnings = item.Proposal.Warnings
                    }).ToArray();
                    if (results.SelectMany(item => item.fields.Values).Any(value => value is not ("correct" or "incorrect" or "unreadable"))) throw new InvalidDataException();
                    var times = reviewed.Select(item => item.Milliseconds).Order().ToArray();
                    await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new
                    {
                        dataset = "private-local-human-review",
                        engineVersion = OnnxOcrEngine.Version,
                        humanReviewed = true,
                        imageCount = 4,
                        independentCardCountNotEstablished = true,
                        p95Milliseconds = times[^1],
                        groups = results.GroupBy(item => item.Condition).ToDictionary(group => group.Key, group => new
                        {
                            images = group.Count(),
                            exactImages = group.Count(item => item.fields.Values.All(value => value == "correct")),
                            correctFields = group.Sum(item => item.fields.Values.Count(value => value == "correct")),
                            incorrectFields = group.Sum(item => item.fields.Values.Count(value => value == "incorrect")),
                            unreadableFields = group.Sum(item => item.fields.Values.Count(value => value == "unreadable"))
                        }),
                        results
                    }, OcrEvaluation.Json));
                    await Html(context, "<h1>Đã ghi số liệu đối chiếu</h1><p>Chỉ lưu đúng/sai/không đọc được và thời gian. Không lưu ảnh hay giá trị danh tính. Mẫu bốn ảnh chưa chứng minh tỷ lệ chính xác trên quần thể.</p>");
                    saved = true;
                    break;
                }
                var html = new StringBuilder("<h1>Đối chiếu CCCD cục bộ</h1><p>Trang chỉ hoạt động trên máy này, không gọi dịch vụ ngoài. Không chụp màn hình hoặc dán dữ liệu vào chat. Đánh dấu sai nếu khác dù chỉ một dấu tiếng Việt; chọn không đọc được chỉ khi chữ gốc thực sự không rõ.</p>");
                html.Append($"<form method='post' action='{route}{(reviewed.Count == 4 ? "save" : "run")}'>");
                for (var index = 0; index < files.Length; index++)
                {
                    html.Append($"<section><h2>Ảnh {index + 1}</h2><img src='{route}image/{index}' alt='Ảnh gốc chỉ hiển thị cục bộ'>");
                    if (reviewed.Count != 4)
                    {
                        html.Append($"<p>Mặt <select name='side{index}' required><option value=''>Chọn mặt</option><option value='front'>Trước</option><option value='back'>Sau</option></select> Điều kiện <select name='condition{index}' required><option value=''>Chọn điều kiện</option><option value='normal'>Thông thường</option><option value='hard'>Khó nhưng chữ đọc được</option></select></p>");
                    }
                    else
                    {
                        var item = reviewed[index];
                        html.Append($"<p>Mặt {(item.Side == OcrDocumentKind.IdentityFront ? "trước" : "sau")}, {item.Milliseconds} ms. Ngày hiển thị theo yyyy-MM-dd.</p><table>");
                        foreach (var field in Expected(item))
                        {
                            var value = item.Proposal.ProposedFields.GetValueOrDefault(field, "(chưa đọc được)");
                            html.Append($"<tr><th>{WebUtility.HtmlEncode(field)}</th><td>{WebUtility.HtmlEncode(value)}</td><td><select required name='{index}.{field}'><option value=''>Đối chiếu ảnh gốc</option><option value='correct'>Đúng toàn bộ</option><option value='incorrect'>Sai hoặc thiếu dù chữ rõ</option><option value='unreadable'>Chữ gốc không đọc được</option></select></td></tr>");
                        }
                        html.Append("</table>");
                    }
                    html.Append("</section>");
                }
                html.Append($"<button>{(reviewed.Count == 4 ? "Ghi số liệu đúng/sai và đóng phiên" : "Chạy OCR cục bộ")}</button></form>");
                await Html(context, html.ToString());
            }
            catch (Exception) { context.Response.StatusCode = 400; await Html(context, "<h1>Chưa ghi kết quả</h1><p>Hãy quay lại, chọn đủ mặt/điều kiện và đối chiếu từng trường. Chi tiết đầu vào không được ghi log.</p>"); }
            finally { context.Response.Close(); }
        }
        reviewed.Clear();
        return saved ? 0 : 1;
    }

    private static IEnumerable<string> Expected(ReviewedImage item) => item.Side == OcrDocumentKind.IdentityFront ? IdentityOcrEvidence.FrontFields : ["dateOfIssue"];
    private static async Task Html(HttpListenerContext context, string body)
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        var html = "<!doctype html><html lang='vi'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Đối chiếu cục bộ</title><style>body{font:16px system-ui;max-width:1100px;margin:24px auto;padding:16px;color:#193653}section{margin:32px 0}img{max-width:100%;max-height:650px;object-fit:contain}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}select,button{font:inherit;padding:12px}button{margin:24px 0}</style>" + body + "</html>";
        await context.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(html));
    }
}
