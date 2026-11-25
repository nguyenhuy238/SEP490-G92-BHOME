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
    DateOnly? AssignmentStart = null, DateOnly? AssignmentEnd = null);

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

    private static Cell AssetConditionCell(LocationAssetReportItem item)
    {
        var cell = new Cell().SetPadding(5).SetFontSize(8.5f);
        cell.Add(new Paragraph(ConditionLabel(item)).SetMargin(0));
        var source = item.Quantity == 0 && !item.Inherited ? "Owner xác nhận không có tài sản"
            : item.Inherited ? "Theo hồ sơ Tenant"
            : item.PriorStaffUserId is not null || item.PriorStaffTaskId is not null
                ? "Kế thừa kết quả kiểm kê từ Staff trước"
            : "Staff kiểm kê trực tiếp";
        cell.Add(new Paragraph($"Nguồn: {source}")
            .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginTop(2).SetMarginBottom(0));
        if (item.IncidentId is not null)
            cell.Add(new Paragraph("Có sự cố liên kết")
                .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginTop(1).SetMarginBottom(0));
        if (!string.IsNullOrWhiteSpace(item.Note))
            cell.Add(new Paragraph("Ghi chú: " + item.Note.Trim())
                .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginTop(1).SetMarginBottom(0));
        if (NeedsConditionReview(item))
            cell.Add(new Paragraph("Cần đối chiếu ghi chú với hiện trạng")
                .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginTop(1).SetMarginBottom(0));
        return cell;
    }

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
        else if (acceptance is null)
        {
            cell.Add(new Paragraph("Chờ ký xác nhận")
                .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER)
                .SetHeight(44).SetMargin(0));
        }
        else
        {
            cell.Add(new Paragraph("Đã xác nhận (không lưu ảnh chữ ký)")
                .SetFontColor(Secondary).SetFontSize(8).SetTextAlignment(TextAlignment.CENTER)
                .SetHeight(44).SetMargin(0));
        }

        cell.Add(new Paragraph(DisplayName(displayName,
                heading.Contains("OWNER", StringComparison.Ordinal) ? "Owner" : "Staff"))
            .SetTextAlignment(TextAlignment.CENTER).SetMarginTop(3).SetMarginBottom(2));
        if (acceptance is not null)
            cell.Add(new Paragraph($"Đã xác nhận qua tài khoản BHOME · {Date(acceptance.SignedAt)}")
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
            var ownerName = DisplayName(report.OwnerDisplayName, "Owner");
            var staffName = DisplayName(report.StaffDisplayName, "Staff");
            var direct = report.Items.Count(item => !item.Inherited &&
                item.PriorStaffUserId is null && item.PriorStaffTaskId is null);
            var previousStaff = report.Items.Count(item => !item.Inherited &&
                (item.PriorStaffUserId is not null || item.PriorStaffTaskId is not null));
            var tenantEvidence = report.Items.Count(item => item.Inherited);
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
            document.Add(new Paragraph($"Số biên bản: {documentNumber}  |  Lần lập: {report.Revision}")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(8.5f)
                .SetFontColor(Secondary).SetMarginBottom(5));
            document.Add(new Paragraph($"Hôm nay, ngày {report.ApprovedAt.ToOffset(TimeSpan.FromHours(7)).ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}, " +
                $"tại {report.LocationName}, địa chỉ {report.Address}.")
                .SetMarginTop(0).SetMarginBottom(8));

            document.Add(new Paragraph("Chúng tôi gồm:").SetMarginBottom(3));
            document.Add(Section("I. BÊN GIAO"));
            document.Add(new Paragraph($"Ông/Bà: {ownerName}\nVai trò: Chủ sở hữu (Owner)")
                .SetMarginTop(0).SetMarginBottom(5));
            document.Add(Section("II. BÊN NHẬN"));
            document.Add(new Paragraph($"Ông/Bà: {staffName}\nVai trò: Nhân viên quản lý cơ sở (Staff)")
                .SetMarginTop(0).SetMarginBottom(5));

            document.Add(Section("III. NỘI DUNG BÀN GIAO"));
            document.Add(new Paragraph($"Căn cứ phân công quản lý tại {report.LocationName} cho {staffName}.")
                .SetMarginTop(0).SetMarginBottom(3));
            if (report.AssignmentStart is { } assignmentStart && report.AssignmentEnd is { } assignmentEnd)
            {
                document.Add(new Paragraph("Hiệu lực phân công: " +
                    $"{assignmentStart.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} – " +
                    $"{assignmentEnd.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}")
                    .SetMarginTop(0).SetMarginBottom(4));
            }
            document.Add(new Paragraph("Bên giao tiến hành bàn giao cho Bên nhận danh mục tài sản thuộc " +
                $"{report.LocationName}, bao gồm các phòng và khu vực chung, theo bảng kê chi tiết sau:")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph($"Phạm vi: {report.Items.Count} dòng trong bảng kê tại " +
                $"{groups.Length} phòng/khu vực. Số lượng theo đơn vị: {QuantitySummary(report.Items)}.")
                .SetMarginTop(0).SetMarginBottom(3));
            document.Add(new Paragraph($"Nguồn đối soát: {direct} mục Staff kiểm kê trực tiếp; " +
                $"{previousStaff} mục kế thừa kết quả Staff trước; {tenantEvidence} mục theo hồ sơ Tenant.")
                .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(3));
            if (assessedItems.Length > 0)
                document.Add(new Paragraph("Hiện trạng theo số mục: " + conditionSummary + ".")
                    .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph(string.IsNullOrWhiteSpace(report.ExceptionDecision)
                    ? "Nội dung ngoại lệ do Owner ghi nhận: Không ghi nhận."
                    : "Nội dung ngoại lệ do Owner ghi nhận: " + report.ExceptionDecision)
                .SetFontSize(8.5f).SetMarginTop(0).SetMarginBottom(5));

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
                    var ledger = new Table(UnitValue.CreatePercentArray([7f, 35f, 13f, 13f, 32f]))
                        .UseAllAvailableWidth().SetFontSize(8.5f);
                    foreach (var heading in new[] { "STT", "Tên tài sản", "Đơn vị", "Số lượng", "Tình trạng" })
                        ledger.AddHeaderCell(TableCell(heading, true));
                    foreach (var item in group)
                    {
                        token.ThrowIfCancellationRequested();
                        ordinal++;
                        ledger.AddCell(TableCell(ordinal.ToString(CultureInfo.InvariantCulture)));
                        ledger.AddCell(TableCell(item.Quantity == 0 ? "Không có tài sản" : item.Name));
                        ledger.AddCell(TableCell(UnitLabel(item.Unit)));
                        ledger.AddCell(TableCell(item.Quantity.ToString("N0", CultureInfo.InvariantCulture)));
                        ledger.AddCell(AssetConditionCell(item));
                    }
                    document.Add(ledger);
                }
            }

            document.Add(Section("IV. CAM KẾT VÀ TRÁCH NHIỆM"));
            document.Add(new Paragraph("Bên giao cam đoan danh mục bàn giao được lập từ phạm vi tài sản đã được Owner xác nhận " +
                "và kết quả đối soát thể hiện trong biên bản. Bên nhận xác nhận đã xem bảng kê, hiện trạng và tiếp nhận trách nhiệm " +
                "quản lý tài sản trong thời hạn, phạm vi phân công nêu trên.")
                .SetMarginTop(0).SetMarginBottom(4));
            document.Add(new Paragraph("Các mục có nguồn theo hồ sơ Tenant là bằng chứng kế thừa từ biên bản bàn giao phòng đã được xác nhận, " +
                "không đồng nghĩa Staff đã trực tiếp kiểm kê tại phòng. Trách nhiệm bảo quản của Tenant theo hợp đồng và biên bản bàn giao phòng " +
                "không tự động chuyển sang Staff. Ngoại lệ hoặc sự cố còn tồn tại phải được ghi nhận và xử lý theo quy trình của cơ sở.")
                .SetMarginTop(0).SetMarginBottom(5));
            document.Add(new Paragraph("Hai bên ký tay và xác nhận trong phiên đăng nhập BHOME trên cùng phiên bản dữ liệu. " +
                "Đây là ghi nhận chấp thuận điện tử, KHÔNG phải chữ ký số chứng thư số/PAdES.")
                .SetFontSize(8.5f).SetMarginBottom(6));

            var signatures = new Table(UnitValue.CreatePercentArray([50f, 50f]))
                .UseAllAvailableWidth().SetKeepTogether(true);
            signatures.AddCell(SignatureCell("BÊN GIAO · OWNER", report.OwnerDisplayName,
                report.OwnerSignature, report.OwnerInkPng));
            signatures.AddCell(SignatureCell("BÊN NHẬN · STAFF", report.StaffDisplayName,
                report.StaffSignature, report.StaffInkPng));
            document.Add(signatures);
            document.Add(new Paragraph("Biên bản đã chốt không được sửa trực tiếp. Nếu kết quả kiểm kê thay đổi, " +
                "hệ thống phải lập phiên bản mới và thu thập lại xác nhận.")
                .SetFontColor(Secondary).SetFontSize(8).SetMarginTop(5));

            document.Add(Section("THÔNG TIN TRUY VẾT KỸ THUẬT"));
            document.Add(new Paragraph($"Mã công việc: {report.TaskId:D}\n" +
                $"Mã phân công: {report.AssignmentId:D}\n" +
                $"Tài khoản Owner: {report.OwnerId:D} · Tài khoản Staff: {report.StaffId:D}\n" +
                $"SHA-256 dữ liệu kiểm kê đã đóng băng: {report.SnapshotHash}")
                .SetFontSize(7.5f).SetFontColor(Secondary).SetMarginBottom(5));
            var referenced = groups.SelectMany(group => group)
                .Select((item, index) => (Item: item, Number: index + 1))
                .Where(row => row.Item.SourceHandoverContractId is not null ||
                    row.Item.IncidentId is not null || row.Item.PriorStaffTaskId is not null ||
                    row.Item.PriorStaffUserId is not null).ToArray();
            if (referenced.Length > 0)
            {
                document.Add(new Paragraph("Tham chiếu hồ sơ/nguồn liên kết (theo STT Phụ lục 01):")
                    .SetFontColor(Secondary).SetFontSize(7.5f).SetMarginBottom(2).SetKeepWithNext(true));
                var references = new List<string>(referenced.Length);
                foreach (var row in referenced)
                {
                    token.ThrowIfCancellationRequested();
                    var item = row.Item;
                    var links = new List<string> { $"Mục {row.Number}" };
                    if (item.SourceHandoverContractId is { } source) links.Add($"Hồ sơ Tenant: {source:D}");
                    if (item.IncidentId is { } incident) links.Add($"Sự cố: {incident:D}");
                    if (item.PriorStaffTaskId is { } priorTask) links.Add($"Công việc Staff trước: {priorTask:D}");
                    if (item.PriorStaffUserId is { } priorStaff) links.Add($"Staff trước: {priorStaff:D}");
                    references.Add(string.Join(" · ", links));
                }
                document.Add(new Paragraph(string.Join("  |  ", references))
                    .SetFontColor(Secondary).SetFontSize(7f).SetMarginBottom(0));
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
