using System.Globalization;
using System.Text.RegularExpressions;
using BHome.Application.StaffOperations;
using BHome.Infrastructure.Branding;
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
    public string? Unit { get; init; }
    public bool IsCommonArea { get; init; }
}

internal sealed record LocationAssetReportPdf(
    Guid TaskId, Guid AssignmentId, int Revision, string LocationName, string Address,
    Guid OwnerId, Guid StaffId, DateTimeOffset ApprovedAt, string SnapshotHash,
    string? ExceptionDecision, IReadOnlyList<LocationAssetReportItem> Items,
    LocationAssetHandoverAcceptance? OwnerSignature = null,
    LocationAssetHandoverAcceptance? StaffSignature = null,
    string? OwnerDisplayName = null, string? StaffDisplayName = null,
    byte[]? OwnerInkPng = null, byte[]? StaffInkPng = null,
    DateOnly? AssignmentStart = null, DateOnly? AssignmentEnd = null,
    int LayoutVersion = 2);

internal static class LocationAssetHandoverPdfRenderer
{
    private static readonly DeviceRgb Ink = new(32, 48, 62);
    private static readonly DeviceRgb Secondary = new(87, 99, 109);
    private static readonly DeviceRgb HeaderBackground = new(237, 241, 244);

    private static string ConditionLabel(LocationAssetReportItem item)
    {
        if (item.Quantity == 0) return "Đã xác nhận không có tài sản";
        return item.Condition switch
        {
            "Intact" => "Đủ và nguyên vẹn",
            "Missing" => "Thiếu tài sản",
            "Damaged" => "Tài sản hư hỏng",
            "NotAccessible" => "Không thể kiểm tra",
            _ => "Chưa ghi nhận hiện trạng (dữ liệu cũ)"
        };
    }

    private static string UnitLabel(string? unit) =>
        string.IsNullOrWhiteSpace(unit) ? "—" : unit.Trim();

    private static string QuantitySummary(IEnumerable<LocationAssetReportItem> items)
    {
        var groups = items.Where(item => item.Quantity > 0)
            .GroupBy(item => string.IsNullOrWhiteSpace(item.Unit) ? null : item.Unit.Trim(),
                StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key ?? "—", StringComparer.CurrentCultureIgnoreCase)
            .Select(group => group.Key is null
                ? $"{group.Sum(item => (long)item.Quantity).ToString("N0", CultureInfo.InvariantCulture)} (chưa khai báo đơn vị)"
                : $"{group.Sum(item => (long)item.Quantity).ToString("N0", CultureInfo.InvariantCulture)} {group.Key}")
            .ToArray();
        return groups.Length == 0 ? "0" : string.Join("; ", groups);
    }

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

    // Notes remain verbatim beside the asset row. A discrepancy calls for review; it must
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

    private static Cell AssetNoteCell(LocationAssetReportItem item)
    {
        var cell = new Cell().SetPadding(5).SetFontSize(8.5f);
        var source = item.Quantity == 0 && !item.Inherited ? "Chủ sở hữu xác nhận không có tài sản"
            : item.Inherited ? "Theo biên bản bàn giao phòng"
            : item.PriorStaffUserId is not null || item.PriorStaffTaskId is not null
                ? "Kế thừa kết quả kiểm kê trước"
            : null;
        if (source is not null)
            cell.Add(new Paragraph(source).SetMargin(0));
        if (item.IncidentId is not null)
            cell.Add(new Paragraph("Có sự cố liên kết")
                .SetMarginTop(1).SetMarginBottom(0));
        if (!string.IsNullOrWhiteSpace(item.Note))
            cell.Add(new Paragraph(item.Note.Trim()).SetMarginTop(1).SetMarginBottom(0));
        if (NeedsConditionReview(item))
            cell.Add(new Paragraph("Cần đối chiếu ghi chú với hiện trạng")
                .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginTop(1).SetMarginBottom(0));
        if (source is null && item.IncidentId is null && string.IsNullOrWhiteSpace(item.Note))
            cell.Add(new Paragraph("—").SetMargin(0));
        return cell;
    }

    private static Cell SignatureCell(string heading, string role, string? displayName,
        LocationAssetHandoverAcceptance? acceptance, byte[]? ink)
    {
        var cell = new Cell().SetPadding(6).SetMinHeight(108).SetKeepTogether(true);
        cell.Add(new Paragraph(heading).SetFontColor(Ink)
            .SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(2));
        cell.Add(new Paragraph("(Ký và ghi rõ họ tên)").SetFontSize(8)
            .SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(4));

        if (ink is { Length: > 0 })
        {
            var picture = new Image(ImageDataFactory.Create(ink));
            picture.ScaleToFit(165, 44);
            picture.SetHorizontalAlignment(HorizontalAlignment.CENTER);
            cell.Add(picture);
        }
        else if (acceptance is null)
        {
            cell.Add(new Paragraph("Chờ ký xác nhận")
                .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER)
                .SetHeight(44).SetMargin(0));
        }
        else
        {
            cell.Add(new Paragraph("Đã xác nhận (không có hình chữ ký)")
                .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER)
                .SetHeight(44).SetMargin(0));
        }

        cell.Add(new Paragraph(DisplayName(displayName, role))
            .SetTextAlignment(TextAlignment.CENTER).SetMarginTop(3).SetMarginBottom(2));
        if (acceptance is not null)
            cell.Add(new Paragraph($"Ngày ký: {Date(acceptance.SignedAt)}")
                .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER).SetMargin(0));
        return cell;
    }

    private readonly record struct AssetScope(string Name, bool IsCommonArea);

    private sealed class AssetScopeComparer : IEqualityComparer<AssetScope>
    {
        public static AssetScopeComparer Instance { get; } = new();

        public bool Equals(AssetScope x, AssetScope y) =>
            x.IsCommonArea == y.IsCommonArea &&
            string.Equals(x.Name, y.Name, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode(AssetScope scope) =>
            HashCode.Combine(StringComparer.OrdinalIgnoreCase.GetHashCode(scope.Name), scope.IsCommonArea);
    }

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
        // A revision approved before the layout change must retain its original content when signed.
        if (report.LayoutVersion == 1)
            return LegacyLocationAssetHandoverPdfRenderer.Render(report, token);
        if (report.LayoutVersion != 2)
            throw OperationalTaskException.Conflict("location_handover_pdf_layout_unsupported");
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
            info.SetTitle("Biên bản bàn giao tài sản và trách nhiệm quản lý cơ sở").SetCreator("BHome");
            info.SetMoreInfo("BHomeInventoryTaskId", report.TaskId.ToString());
            info.SetMoreInfo("BHomeInventoryRevision", report.Revision.ToString(CultureInfo.InvariantCulture));
            info.SetMoreInfo("BHomeInventorySnapshotSHA256", report.SnapshotHash);

            var documentNumber = $"BBBG/{report.ApprovedAt.ToOffset(TimeSpan.FromHours(7)):yyyyMMdd}/" +
                $"{report.TaskId.ToString("N")[..8].ToUpperInvariant()}/L{report.Revision:D2}";
            pdf.AddEventHandler(PdfDocumentEvent.END_PAGE, new PageFooter(font, documentNumber));
            var ownerName = DisplayName(report.OwnerDisplayName, "Chủ sở hữu");
            var staffName = DisplayName(report.StaffDisplayName, "Nhân viên");
            var assessedItems = report.Items.Where(item => item.Quantity > 0).ToArray();
            var conditionSummary = string.Join("  ·  ", new[]
            {
                $"Đủ, nguyên vẹn: {assessedItems.Count(item => item.Condition == "Intact")}",
                $"Thiếu: {assessedItems.Count(item => item.Condition == "Missing")}",
                $"Hư hỏng: {assessedItems.Count(item => item.Condition == "Damaged")}",
                $"Không thể kiểm tra: {assessedItems.Count(item => item.Condition == "NotAccessible")}",
                $"Chưa đánh giá: {assessedItems.Count(item => item.Condition is not ("Intact" or "Missing" or "Damaged" or "NotAccessible"))}"
            });
            var groups = report.Items.GroupBy(item => new AssetScope(item.Scope, item.IsCommonArea), AssetScopeComparer.Instance)
                .OrderBy(group => group.Key.IsCommonArea ? 1 : 0)
                .ThenBy(group => group.Key.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();

            BrandAssets.AddPdfMark(document, PageSize.A4.GetWidth() - 62, PageSize.A4.GetHeight() - 31, 26, BrandAssets.MarkPng);
            document.Add(new Paragraph("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(10.5f).SetMarginBottom(2));
            document.Add(new Paragraph("Độc lập - Tự do - Hạnh phúc")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(10).SetMarginBottom(10));
            document.Add(new Paragraph("BIÊN BẢN BÀN GIAO TÀI SẢN")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(15)
                .SetFontColor(Ink).SetMarginBottom(5));
            document.Add(new Paragraph($"Số biên bản: {documentNumber}  |  Phiên bản: {report.Revision}")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(8.5f)
                .SetFontColor(Secondary).SetMarginBottom(5));
            document.Add(new Paragraph($"Ngày lập: {Date(report.ApprovedAt)}\n" +
                $"Cơ sở: {report.LocationName}\nĐịa chỉ: {report.Address}")
                .SetMarginTop(0).SetMarginBottom(8));

            document.Add(Section("I. THÔNG TIN CÁC BÊN"));
            document.Add(new Paragraph($"Bên giao: {ownerName}\nVai trò: Chủ sở hữu")
                .SetMarginTop(0).SetMarginBottom(5));
            document.Add(new Paragraph($"Bên nhận: {staffName}\nVai trò: Nhân viên quản lý cơ sở")
                .SetMarginTop(0).SetMarginBottom(5));

            document.Add(Section("II. NỘI DUNG BÀN GIAO"));
            document.Add(new Paragraph($"Căn cứ phân công quản lý tại {report.LocationName} cho {staffName}.")
                .SetMarginTop(0).SetMarginBottom(3));
            if (report.AssignmentStart is { } assignmentStart && report.AssignmentEnd is { } assignmentEnd)
            {
                document.Add(new Paragraph("Hiệu lực phân công: " +
                    $"{assignmentStart.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} – " +
                    $"{assignmentEnd.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}")
                    .SetMarginTop(0).SetMarginBottom(4));
            }
            document.Add(new Paragraph("Bên giao bàn giao cho Bên nhận trách nhiệm quản lý tài sản trong phạm vi phân công, theo bảng kê dưới đây.")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph($"Phạm vi: {groups.Count(group => !group.Key.IsCommonArea)} phòng, " +
                $"{groups.Count(group => group.Key.IsCommonArea)} khu vực chung; {assessedItems.Length} mục tài sản. " +
                $"Số lượng theo danh mục: {QuantitySummary(report.Items)}.")
                .SetMarginTop(0).SetMarginBottom(3));
            if (assessedItems.Length > 0)
                document.Add(new Paragraph("Hiện trạng theo số mục: " + conditionSummary + ".")
                    .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(4));
            document.Add(Section("III. DANH MỤC TÀI SẢN BÀN GIAO"));
            document.Add(new Paragraph("Số lượng là số lượng theo danh mục đã xác nhận, không phải số lượng thực tế đếm được. " +
                "Các mục không có ghi chú về nguồn được kiểm kê trực tiếp.")
                .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(4));

            if (report.Items.Count == 0)
            {
                document.Add(new Paragraph("Không có tài sản trong phạm vi bàn giao (0 mục, số lượng 0).")
                    .SetMarginTop(0).SetMarginBottom(5));
            }
            else
            {
                var ordinal = 0;
                foreach (var group in groups)
                {
                    token.ThrowIfCancellationRequested();
                    document.Add(Section(group.Key.IsCommonArea
                        ? $"Khu vực chung: {group.Key.Name}"
                        : group.Key.Name));
                    var ledger = new Table(UnitValue.CreatePercentArray([7f, 28f, 10f, 10f, 20f, 25f]))
                        .UseAllAvailableWidth().SetFontSize(8.5f);
                    foreach (var heading in new[] { "STT", "Tên tài sản", "ĐVT", "SL danh mục", "Hiện trạng", "Ghi chú" })
                        ledger.AddHeaderCell(TableCell(heading, true));
                    foreach (var item in group)
                    {
                        token.ThrowIfCancellationRequested();
                        ordinal++;
                        ledger.AddCell(TableCell(ordinal.ToString(CultureInfo.InvariantCulture)));
                        ledger.AddCell(TableCell(item.Quantity == 0 ? "Không có tài sản" : item.Name));
                        ledger.AddCell(TableCell(UnitLabel(item.Unit)));
                        ledger.AddCell(TableCell(item.Quantity.ToString("N0", CultureInfo.InvariantCulture)));
                        ledger.AddCell(TableCell(ConditionLabel(item)));
                        ledger.AddCell(AssetNoteCell(item));
                    }
                    document.Add(ledger);
                }
            }

            document.Add(Section("IV. TỒN TẠI VÀ HƯỚNG XỬ LÝ"));
            var exceptions = groups.SelectMany(group => group)
                .Where(item => item.Quantity > 0 && (item.Condition != "Intact" ||
                    item.IncidentId is not null || NeedsConditionReview(item))).ToArray();
            if (exceptions.Length == 0)
                document.Add(new Paragraph("Không ghi nhận mục tài sản bất thường trong bảng kê.").SetMarginTop(0));
            else
                foreach (var item in exceptions)
                    document.Add(new Paragraph($"{item.Scope} – {item.Name}: {ConditionLabel(item)}" +
                        (NeedsConditionReview(item) ? "; cần đối chiếu ghi chú" : "") +
                        (item.IncidentId is not null ? "; có sự cố liên kết" : "") + ".")
                        .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(2));
            document.Add(new Paragraph(string.IsNullOrWhiteSpace(report.ExceptionDecision)
                ? "Ý kiến xử lý của bên giao: Chưa ghi nhận."
                : "Ý kiến xử lý của bên giao: " + report.ExceptionDecision).SetMarginTop(0).SetMarginBottom(5));

            document.Add(Section("V. TRÁCH NHIỆM VÀ XÁC NHẬN"));
            document.Add(new Paragraph("Bên giao xác nhận danh mục và kết quả đối soát được ghi trong biên bản; phối hợp xử lý các tồn tại. " +
                "Bên nhận tiếp nhận trách nhiệm quản lý, theo dõi và báo cáo mất mát, hư hỏng trong phạm vi phân công.")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph("Các mục kế thừa từ biên bản bàn giao phòng hoặc kết quả kiểm kê trước không phải kiểm kê trực tiếp của bên nhận. " +
                "Trách nhiệm bảo quản của người thuê theo hợp đồng không tự động chuyển sang bên nhận.")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph("Hai bên thống nhất nội dung bàn giao khi đã ký xác nhận.").SetMarginBottom(5));
            if (report.OwnerSignature is { } ownerSignature && report.StaffSignature is { } staffSignature)
                document.Add(new Paragraph($"Hoàn tất bàn giao: {Date(ownerSignature.SignedAt > staffSignature.SignedAt ? ownerSignature.SignedAt : staffSignature.SignedAt)}")
                    .SetMarginTop(0).SetMarginBottom(5));

            var signatures = new Table(UnitValue.CreatePercentArray([50f, 50f]))
                .UseAllAvailableWidth().SetKeepTogether(true);
            signatures.AddCell(SignatureCell("BÊN GIAO", "Chủ sở hữu", report.OwnerDisplayName,
                report.OwnerSignature, report.OwnerInkPng));
            signatures.AddCell(SignatureCell("BÊN NHẬN", "Nhân viên", report.StaffDisplayName,
                report.StaffSignature, report.StaffInkPng));
            document.Add(signatures);

        }
        // iText closes the writer's stream along with the PDF. MemoryStream.ToArray()
        // deliberately works after Close(), while Length throws ObjectDisposedException.
        var bytes = output.ToArray();
        if (bytes.Length > 20 * 1024 * 1024)
            throw new OperationalTaskException(413, "location_handover_pdf_too_large");
        return bytes;
    }
}
