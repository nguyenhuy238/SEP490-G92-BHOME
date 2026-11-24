using System.Globalization;
using System.Text.RegularExpressions;
using BHome.Application.StaffOperations;
using iText.IO.Font;
using iText.IO.Image;
using iText.Kernel.Colors;
using iText.Kernel.Font;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Event;
using iText.Kernel.Pdf.Canvas;
using iText.Layout;
using iText.Layout.Element;
using iText.Layout.Properties;

namespace BHome.Infrastructure.StaffOperations;

internal sealed record LocationAssetReportItem(
    Guid Id, string Scope, string Name, int Quantity, bool Inherited,
    Guid? SourceHandoverContractId, Guid? IncidentId, string? Note,
    Guid? PriorStaffTaskId = null, Guid? PriorStaffUserId = null)
{
    public string Condition { get; init; } = "Unassessed";
}

internal sealed record LocationAssetReportPdf(
    Guid TaskId, Guid AssignmentId, int Revision, string LocationName, string Address,
    Guid OwnerId, Guid StaffId, DateTimeOffset ApprovedAt, string SnapshotHash,
    string? ExceptionDecision, IReadOnlyList<LocationAssetReportItem> Items,
    LocationAssetHandoverAcceptance? OwnerSignature = null,
    LocationAssetHandoverAcceptance? StaffSignature = null,
    string? OwnerDisplayName = null, string? StaffDisplayName = null,
    byte[]? OwnerInkPng = null, byte[]? StaffInkPng = null,
    DateOnly? AssignmentStart = null, DateOnly? AssignmentEnd = null);

internal static class LocationAssetHandoverPdfRenderer
{
    private static readonly DeviceRgb Ink = new(32, 48, 62);
    private static readonly DeviceRgb Secondary = new(87, 99, 109);
    private static readonly DeviceRgb HeaderBackground = new(237, 241, 244);

    private static string ConditionLabel(string? condition) => condition switch
    {
        "Intact" => "Đủ và nguyên vẹn",
        "Missing" => "Thiếu tài sản",
        "Damaged" => "Tài sản hư hỏng",
        "NotAccessible" => "Không thể kiểm tra",
        _ => "Chưa ghi nhận hiện trạng (dữ liệu cũ)"
    };

    private static readonly Lazy<byte[]> Font = new(() =>
    {
        using var font = typeof(LocationAssetHandoverPdfRenderer).Assembly
            .GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new OperationalTaskException(503, "location_handover_pdf_font_missing");
        using var memory = new MemoryStream();
        font.CopyTo(memory);
        return memory.ToArray();
    });

    private static string DisplayName(string? name, string role) =>
        string.IsNullOrWhiteSpace(name) ? $"{role} (chưa có tên hiển thị)" : name.Trim();

    private static string Date(DateTimeOffset value) =>
        value.ToOffset(TimeSpan.FromHours(7)).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);

    // Notes remain verbatim in the appendix. A discrepancy calls for review; it must
    // never silently change the condition captured in the immutable snapshot.
    private static bool NeedsConditionReview(LocationAssetReportItem item)
    {
        if (item.Condition != "Intact" || string.IsNullOrWhiteSpace(item.Note)) return false;
        var note = Regex.Replace(item.Note, @"\b(?:không|chẳng)\s+thiếu\b", "",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return Regex.IsMatch(note, @"\b(?:thiếu|mất|thất lạc)\b|không (?:tìm )?thấy|chưa (?:có|nhận)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static Paragraph Section(string title) => new Paragraph(title)
        .SetFontSize(11).SetFontColor(Ink).SetMarginTop(8)
        .SetMarginBottom(4).SetKeepWithNext(true);

    private static Cell TableCell(string value, bool heading = false) =>
        new Cell().Add(new Paragraph(value).SetMargin(0))
            .SetPadding(5).SetFontSize(9)
            .SetBackgroundColor(heading ? HeaderBackground : ColorConstants.WHITE);

    private static Cell SignatureCell(string heading, string? displayName,
        LocationAssetHandoverAcceptance? acceptance, byte[]? ink)
    {
        var cell = new Cell().SetPadding(6).SetMinHeight(108).SetKeepTogether(true);
        cell.Add(new Paragraph(heading).SetFontColor(Ink)
            .SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(3));

        if (ink is { Length: > 0 })
        {
            var picture = new Image(ImageDataFactory.Create(ink));
            picture.ScaleToFit(165, 44);
            picture.SetHorizontalAlignment(HorizontalAlignment.CENTER);
            cell.Add(picture);
        }
        else
        {
            cell.Add(new Paragraph(acceptance is null ? "Chờ ký xác nhận" : "Đã xác nhận (không lưu ảnh chữ ký)")
                .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER)
                .SetHeight(44).SetMargin(0));
        }

        cell.Add(new Paragraph(DisplayName(displayName,
                heading.Contains("OWNER", StringComparison.Ordinal) ? "Owner" : "Staff"))
            .SetTextAlignment(TextAlignment.CENTER).SetMarginTop(3).SetMarginBottom(2));
        cell.Add(new Paragraph(acceptance is null
                ? "Chờ xác nhận"
                : $"Đã xác nhận qua tài khoản BHOME · {Date(acceptance.SignedAt)}")
            .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER).SetMargin(0));
        return cell;
    }

    private static bool CommonArea(string scope) =>
        scope.Contains("chung", StringComparison.OrdinalIgnoreCase) ||
        scope.Contains("common", StringComparison.OrdinalIgnoreCase);

    private sealed class PageFooter(PdfFont font, string documentNumber) : AbstractPdfDocumentEventHandler
    {
        protected override void OnAcceptedEvent(AbstractPdfDocumentEvent currentEvent)
        {
            var pageEvent = (PdfDocumentEvent)currentEvent;
            var pdf = pageEvent.GetDocument();
            var page = pageEvent.GetPage();
            var canvas = new PdfCanvas(page.NewContentStreamAfter(), page.GetResources(), pdf);
            canvas.BeginText().SetFontAndSize(font, 8)
                .MoveText(38, 25).ShowText($"BHOME  ·  {documentNumber}").EndText();
            canvas.BeginText().SetFontAndSize(font, 8)
                .MoveText(PageSize.A4.GetWidth() - 74, 25)
                .ShowText($"Trang {pdf.GetPageNumber(page)}").EndText();
        }
    }

    internal static byte[] Render(LocationAssetReportPdf report, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var document = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H,
                PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            document.SetFont(font).SetFontSize(9.5f).SetFontColor(Ink)
                .SetMargins(37, 38, 47, 38);
            var info = pdf.GetDocumentInfo();
            info.SetTitle("Biên bản bàn giao tài sản và trách nhiệm quản lý cơ sở");
            info.SetMoreInfo("BHomeInventoryTaskId", report.TaskId.ToString());
            info.SetMoreInfo("BHomeInventoryRevision", report.Revision.ToString(CultureInfo.InvariantCulture));
            info.SetMoreInfo("BHomeInventorySnapshotSHA256", report.SnapshotHash);

            var documentNumber = $"BBBG/{report.ApprovedAt.ToOffset(TimeSpan.FromHours(7)):yyyyMMdd}/" +
                $"{report.TaskId.ToString("N")[..8].ToUpperInvariant()}/L{report.Revision:D2}";
            pdf.AddEventHandler(PdfDocumentEvent.END_PAGE, new PageFooter(font, documentNumber));
            var ownerName = DisplayName(report.OwnerDisplayName, "Owner");
            var staffName = DisplayName(report.StaffDisplayName, "Staff");
            var direct = report.Items.Count(item => !item.Inherited && item.PriorStaffUserId is null);
            var previousStaff = report.Items.Count(item => !item.Inherited && item.PriorStaffUserId is not null);
            var tenantEvidence = report.Items.Count(item => item.Inherited);
            var totalQuantity = report.Items.Sum(item => (long)item.Quantity);
            var conflicts = report.Items.Where(NeedsConditionReview).ToArray();

            document.Add(new Paragraph("BHOME  /  BIÊN BẢN QUẢN LÝ NỘI BỘ")
                .SetFontColor(Secondary).SetFontSize(9).SetMarginBottom(10));
            document.Add(new Paragraph("BIÊN BẢN BÀN GIAO TÀI SẢN\nVÀ TRÁCH NHIỆM QUẢN LÝ CƠ SỞ")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(15)
                .SetFontColor(Ink).SetMarginBottom(10));
            document.Add(new Paragraph($"Số biên bản: {documentNumber}  |  Lần lập: {report.Revision}")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(9)
                .SetFontColor(Secondary).SetMarginBottom(3));
            document.Add(new Paragraph($"Ngày lập: {Date(report.ApprovedAt)}  ·  Tại: {report.LocationName}")
                .SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(9));

            document.Add(Section("1. THÔNG TIN VÀ CĂN CỨ BÀN GIAO"));
            document.Add(new Paragraph($"Cơ sở: {report.LocationName}\nĐịa chỉ: {report.Address}")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph($"Căn cứ phân công: Phân công quản lý {report.LocationName} cho {staffName}.")
                .SetMarginTop(0).SetMarginBottom(6));
            if (report.AssignmentStart is { } assignmentStart && report.AssignmentEnd is { } assignmentEnd)
            {
                document.Add(new Paragraph($"Hiệu lực phân công: " +
                    $"{assignmentStart.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} – " +
                    $"{assignmentEnd.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}")
                    .SetMarginTop(0).SetMarginBottom(5));
            }
            var parties = new Table(UnitValue.CreatePercentArray([50f, 50f])).UseAllAvailableWidth();
            parties.AddCell(TableCell($"BÊN GIAO · OWNER\n{ownerName}"));
            parties.AddCell(TableCell($"BÊN NHẬN · STAFF\n{staffName}"));
            document.Add(parties);

            document.Add(Section("2. PHẠM VI VÀ KẾT QUẢ ĐỐI SOÁT"));
            document.Add(new Paragraph($"Số mục tài sản: {report.Items.Count}  ·  Tổng số lượng: {totalQuantity}  ·  " +
                $"Phòng/khu vực có ghi nhận: {report.Items.Select(item => item.Scope).Distinct(StringComparer.OrdinalIgnoreCase).Count()}.")
                .SetMarginTop(0).SetMarginBottom(4));
            var methods = new Table(UnitValue.CreatePercentArray([34f, 16f, 34f, 16f])).UseAllAvailableWidth();
            methods.AddCell(TableCell("Staff kiểm kê trực tiếp", true));
            methods.AddCell(TableCell(direct.ToString(CultureInfo.InvariantCulture)));
            methods.AddCell(TableCell("Kế thừa kết quả Staff trước", true));
            methods.AddCell(TableCell(previousStaff.ToString(CultureInfo.InvariantCulture)));
            methods.AddCell(TableCell("Theo hồ sơ Tenant", true));
            methods.AddCell(TableCell(tenantEvidence.ToString(CultureInfo.InvariantCulture)));
            methods.AddCell(TableCell("Tổng số mục", true));
            methods.AddCell(TableCell(report.Items.Count.ToString(CultureInfo.InvariantCulture)));
            document.Add(methods);

            var conditions = new Table(UnitValue.CreatePercentArray([20f, 20f, 20f, 20f, 20f]))
                .UseAllAvailableWidth().SetMarginTop(5);
            foreach (var label in new[] { "Đủ, nguyên vẹn", "Thiếu", "Hư hỏng", "Chưa tiếp cận", "Chưa đánh giá" })
                conditions.AddHeaderCell(TableCell(label, true));
            foreach (var code in new[] { "Intact", "Missing", "Damaged", "NotAccessible", "Unassessed" })
                conditions.AddCell(TableCell(report.Items.Count(item =>
                    code == "Unassessed" ? item.Condition is not ("Intact" or "Missing" or "Damaged" or "NotAccessible")
                        : item.Condition == code).ToString(CultureInfo.InvariantCulture)));
            document.Add(conditions);
            document.Add(new Paragraph("Bảng kê chi tiết, hiện trạng từng mục, ghi chú và nguồn đối soát được lưu " +
                "trong Phụ lục 01 kèm theo biên bản.").SetFontSize(8.5f).SetMarginTop(5).SetMarginBottom(0));

            document.Add(Section("3. NGOẠI LỆ VÀ NỘI DUNG CẦN ĐỐI CHIẾU"));
            document.Add(new Paragraph(string.IsNullOrWhiteSpace(report.ExceptionDecision)
                    ? "Quyết định ngoại lệ của Owner: Không ghi nhận."
                    : "Quyết định ngoại lệ của Owner: " + report.ExceptionDecision)
                .SetMarginTop(0).SetMarginBottom(4));
            foreach (var item in conflicts)
            {
                token.ThrowIfCancellationRequested();
                document.Add(new Paragraph($"Ghi chú cần đối chiếu: {item.Scope} / {item.Name} ghi hiện trạng " +
                    "'Đủ và nguyên vẹn' nhưng ghi chú đề cập tài sản thiếu hoặc mất. " +
                    "Giữ nguyên dữ liệu đã xác nhận; kiểm tra ghi chú tại Phụ lục 01.")
                    .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(4));
            }

            document.Add(Section("4. PHẠM VI TRÁCH NHIỆM VÀ XÁC NHẬN"));
            document.Add(new Paragraph("Bên giao bàn giao hồ sơ kiểm kê thuộc cơ sở nêu trên; " +
                "bên nhận xác nhận đã xem phiên bản biên bản và phạm vi công việc được phân công. " +
                "Mục theo hồ sơ Tenant là bằng chứng kế thừa, không đồng nghĩa Staff đã vào phòng kiểm kê trực tiếp.")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph("Trách nhiệm bảo quản của Tenant theo hợp đồng và biên bản bàn giao phòng " +
                "không tự động chuyển sang Staff. Phát hiện phát sinh phải được ghi nhận và xử lý theo quy trình " +
                "của cơ sở; việc ký nhận không thay thế xử lý ngoại lệ hoặc sự cố còn tồn tại.")
                .SetMarginTop(0).SetMarginBottom(5));
            document.Add(new Paragraph("Hai bên ký tay và xác nhận trong phiên đăng nhập BHOME trên cùng phiên bản dữ liệu. " +
                "Đây là ghi nhận chấp thuận điện tử, KHÔNG phải chữ ký số chứng thư số/PAdES.")
                .SetFontSize(8.5f).SetMarginBottom(7));

            var signatures = new Table(UnitValue.CreatePercentArray([50f, 50f]))
                .UseAllAvailableWidth().SetKeepTogether(true);
            signatures.AddCell(SignatureCell("BÊN GIAO · OWNER", report.OwnerDisplayName,
                report.OwnerSignature, report.OwnerInkPng));
            signatures.AddCell(SignatureCell("BÊN NHẬN · STAFF", report.StaffDisplayName,
                report.StaffSignature, report.StaffInkPng));
            document.Add(signatures);
            document.Add(new Paragraph("Biên bản đã chốt không được sửa trực tiếp. Nếu kết quả kiểm kê thay đổi, " +
                "hệ thống phải lập phiên bản mới và thu thập lại xác nhận.")
                .SetFontColor(Secondary).SetFontSize(8).SetMarginTop(6));

            document.Add(new AreaBreak(AreaBreakType.NEXT_PAGE));
            document.Add(new Paragraph("PHỤ LỤC 01  ·  BẢNG KÊ TÀI SẢN")
                .SetFontSize(13).SetFontColor(Ink).SetMarginBottom(5));
            document.Add(new Paragraph($"Kèm biên bản số {documentNumber} · Lần lập {report.Revision} · Cơ sở {report.LocationName}")
                .SetFontColor(Secondary).SetFontSize(8.5f).SetMarginBottom(10));

            if (report.Items.Count == 0)
            {
                document.Add(new Paragraph("Không có tài sản trong phạm vi bàn giao (0 mục, số lượng 0)."));
            }
            else
            {
                var groups = report.Items.GroupBy(item => item.Scope, StringComparer.OrdinalIgnoreCase)
                    .OrderBy(group => CommonArea(group.Key) ? 1 : 0)
                    .ThenBy(group => group.Key, StringComparer.CurrentCultureIgnoreCase);
                var ordinal = 0;
                foreach (var group in groups)
                {
                    token.ThrowIfCancellationRequested();
                    document.Add(Section($"{(CommonArea(group.Key) ? "Khu vực chung" : "Phòng / khu vực")}: {group.Key}"));
                    var ledger = new Table(UnitValue.CreatePercentArray([7f, 22f, 10f, 23f, 38f]))
                        .UseAllAvailableWidth().SetFontSize(8.5f);
                    foreach (var heading in new[] { "STT", "Tài sản", "SL", "Hiện trạng", "Nguồn đối soát / ghi chú" })
                        ledger.AddHeaderCell(TableCell(heading, true));
                    foreach (var item in group)
                    {
                        token.ThrowIfCancellationRequested();
                        ordinal++;
                        var method = item.Inherited ? "Theo hồ sơ Tenant"
                            : item.PriorStaffUserId is not null ? "Kế thừa kết quả kiểm kê từ Staff trước"
                            : "Staff kiểm kê trực tiếp";
                        if (item.IncidentId is not null) method += "; có sự cố liên kết";
                        if (!string.IsNullOrWhiteSpace(item.Note)) method += "\nGhi chú: " + item.Note;
                        if (NeedsConditionReview(item)) method += "\nGhi chú cần đối chiếu với hiện trạng";
                        ledger.AddCell(TableCell(ordinal.ToString(CultureInfo.InvariantCulture)));
                        ledger.AddCell(TableCell(item.Name));
                        ledger.AddCell(TableCell(item.Quantity.ToString(CultureInfo.InvariantCulture)));
                        ledger.AddCell(TableCell(ConditionLabel(item.Condition)));
                        ledger.AddCell(TableCell(method));
                    }
                    document.Add(ledger);
                }
            }

            document.Add(Section("THÔNG TIN TRUY VẾT KỸ THUẬT"));
            document.Add(new Paragraph($"Mã công việc: {report.TaskId:D}\n" +
                $"Mã phân công: {report.AssignmentId:D}\n" +
                $"Tài khoản Owner: {report.OwnerId:D} · Tài khoản Staff: {report.StaffId:D}\n" +
                $"SHA-256 dữ liệu kiểm kê đã đóng băng: {report.SnapshotHash}")
                .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginBottom(5));
            var referenced = report.Items.GroupBy(item => item.Scope, StringComparer.OrdinalIgnoreCase)
                .OrderBy(group => CommonArea(group.Key) ? 1 : 0)
                .ThenBy(group => group.Key, StringComparer.CurrentCultureIgnoreCase)
                .SelectMany(group => group).Select((item, index) => (Item: item, Number: index + 1))
                .Where(row => row.Item.SourceHandoverContractId is not null ||
                    row.Item.IncidentId is not null || row.Item.PriorStaffTaskId is not null ||
                    row.Item.PriorStaffUserId is not null).ToArray();
            if (referenced.Length > 0)
            {
                document.Add(new Paragraph("Tham chiếu hồ sơ/nguồn liên kết (theo STT Phụ lục 01):")
                    .SetFontColor(Secondary).SetFontSize(7.5f).SetMarginBottom(3));
                foreach (var row in referenced)
                {
                    token.ThrowIfCancellationRequested();
                    var item = row.Item;
                    var links = new List<string> { $"Mục {row.Number}" };
                    if (item.SourceHandoverContractId is { } source) links.Add($"Hồ sơ Tenant: {source:D}");
                    if (item.IncidentId is { } incident) links.Add($"Sự cố: {incident:D}");
                    if (item.PriorStaffTaskId is { } priorTask) links.Add($"Công việc Staff trước: {priorTask:D}");
                    if (item.PriorStaffUserId is { } priorStaff) links.Add($"Staff trước: {priorStaff:D}");
                    document.Add(new Paragraph(string.Join(" · ", links))
                        .SetFontColor(Secondary).SetFontSize(7.5f).SetMarginBottom(2));
                }
            }

        }
        // iText closes the writer's stream along with the PDF. MemoryStream.ToArray()
        // deliberately works after Close(), while Length throws ObjectDisposedException.
        var bytes = output.ToArray();
        if (bytes.Length > 20 * 1024 * 1024)
            throw new OperationalTaskException(413, "location_handover_pdf_too_large");
        return bytes;
    }
}
