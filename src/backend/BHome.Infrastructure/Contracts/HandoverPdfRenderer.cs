using System.Globalization;
using BHome.Application.Contracts;
using iText.IO.Font;
using iText.Kernel.Colors;
using iText.Kernel.Font;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using iText.Layout.Properties;

namespace BHome.Infrastructure.Contracts;

internal sealed class HandoverPdfRenderer : IHandoverDocumentRenderer, IHandoverDraftPdfRenderer
{
    private static readonly CultureInfo Vietnamese = CultureInfo.GetCultureInfo("vi-VN");
    private static readonly DeviceRgb Ink = new(33, 47, 65);
    private static readonly DeviceRgb Subtle = new(93, 106, 121);
    private static readonly DeviceRgb HeaderFill = new(238, 243, 247);
    private static readonly TimeZoneInfo VietnamTime = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
    private static readonly Lazy<byte[]> Font = new(() =>
    {
        using var stream = typeof(ContractPdfRenderer).Assembly.GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new ContractException(503, "contract_pdf_font_not_available");
        using var bytes = new MemoryStream(); stream.CopyTo(bytes); return bytes.ToArray();
    });
    public Task<byte[]> RenderDraftAsync(HandoverDraftView r, CancellationToken t) => RenderPreparation(r, false, t);

    public Task<byte[]> RenderSigningAsync(HandoverDraftView r, HandoverDocumentPhoto[] photos,
        CancellationToken t) => RenderPreparation(r, true, t);

    private static string Meter(decimal value) =>
        decimal.Truncate(value).ToString("N0", Vietnamese);

    private static string Money(decimal value) => value.ToString("N0", Vietnamese) + " đ";
    private static string LocalDateTime(DateTimeOffset value) =>
        TimeZoneInfo.ConvertTime(value, VietnamTime).ToString("dd/MM/yyyy HH:mm", Vietnamese);

    private static void Title(Document doc, string title, string reference)
    {
        doc.Add(new Paragraph("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM")
            .SetFontSize(12).SetFontColor(Ink).SetTextAlignment(TextAlignment.CENTER)
            .SetMarginBottom(2));
        doc.Add(new Paragraph("Độc lập - Tự do - Hạnh phúc")
            .SetFontSize(11).SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(17));
        doc.Add(new Paragraph(title).SetFontSize(16).SetFontColor(Ink)
            .SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(5));
        doc.Add(new Paragraph(reference).SetFontSize(9).SetFontColor(Subtle)
            .SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(10));
    }

    private static void Section(Document doc, string heading) =>
        doc.Add(new Paragraph(heading).SetFontSize(11).SetFontColor(Ink)
            .SetMarginTop(11).SetMarginBottom(5));

    private static void Line(Document doc, string label, string value) =>
        doc.Add(new Paragraph(label + ": " + (string.IsNullOrWhiteSpace(value) ? "—" : value))
            .SetMarginTop(0).SetMarginBottom(4));

    private static Table Grid(params float[] widths) =>
        new Table(UnitValue.CreatePercentArray(widths)).UseAllAvailableWidth()
            .SetMarginBottom(6);

    private static void Cells(Table table, bool header, params string[] values)
    {
        foreach (var value in values)
        {
            var cell = new Cell().Add(new Paragraph(value ?? "—")
                .SetFontSize(header ? 9 : 9.5f).SetMargin(0))
                .SetPaddingTop(4).SetPaddingBottom(4).SetPaddingLeft(6).SetPaddingRight(6);
            if (header) cell.SetBackgroundColor(HeaderFill).SetFontColor(Ink);
            table.AddCell(cell);
        }
    }

    private static string StatusAndNotes(string status, string? reason)
    {
        // A passed inspection is self-contained in the issued document. Preserve
        // Legacy signed snapshots can contain notes from a prior failed check.
        // Do not print them beside an item whose final status is passed.
        // Real deficiencies must still show their reason verbatim.
        if (status is "Đạt" or "Đã kiểm kê") return "Trạng thái: " + status;
        var detailLabel = status is "Cần xử lý" or "Không áp dụng" ? "Lý do" : "Ghi chú";
        return "Trạng thái: " + status + (string.IsNullOrWhiteSpace(reason)
            ? "" : "\n" + detailLabel + ": " + reason.Trim());
    }

    private static string AssetCondition(HandoverAsset asset)
    {
        if (!asset.Checked) return StatusAndNotes("Chưa kiểm kê", null);
        var issues = string.Join("; ", new[]
        {
            asset.DamagedQuantity is > 0 ? $"Hư hỏng: {asset.DamagedQuantity}" : null,
            asset.MissingQuantity is > 0 ? $"Thiếu: {asset.MissingQuantity}" : null
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
        var abnormal = asset.DamagedQuantity is > 0 || asset.MissingQuantity is > 0 ||
            asset.ObservedCondition is "Damaged" or "Missing" or "Hư hỏng" or "Thiếu";
        var notes = string.Join(" · ", new[] { issues, asset.ObservedCondition, asset.Notes }
            .Where(value => !string.IsNullOrWhiteSpace(value)));
        return StatusAndNotes(abnormal ? "Cần xử lý" : "Đã kiểm kê", notes);
    }

    private static string InspectedCondition(HandoverInspectedAsset asset)
    {
        var status = asset.Condition switch
        {
            "Good" => "Đạt",
            "Missing" or "Damaged" => "Cần xử lý",
            _ => asset.Condition
        };
        var reason = asset.Condition switch
        {
            "Missing" => "Thiếu tài sản",
            "Damaged" => "Tài sản hư hỏng",
            _ => ""
        };
        return StatusAndNotes(status, string.Join(" · ", new[] { reason, asset.Notes }
            .Where(value => !string.IsNullOrWhiteSpace(value))));
    }

    private static void AddSignaturePage(Document doc, PdfDocument pdf, bool signing)
    {
        // The signature image is placed by the existing signing service using these exact
        // top-left-relative coordinates. Draw empty boxes at the same positions.
        doc.Add(new AreaBreak(AreaBreakType.NEXT_PAGE));
        doc.Add(new Paragraph("XÁC NHẬN CỦA CÁC BÊN").SetFontColor(Ink)
            .SetFontSize(13).SetTextAlignment(TextAlignment.CENTER).SetMarginTop(12));
        doc.Add(new Paragraph("Bên giao và bên nhận xác nhận các thông tin, chỉ số công tơ, " +
            "hiện trạng phòng, tài sản và các vấn đề được ghi trong biên bản.")
            .SetFontSize(10).SetTextAlignment(TextAlignment.CENTER).SetMarginBottom(25));

        var page = pdf.GetNumberOfPages();
        var size = pdf.GetPage(page).GetPageSize();
        var boxTop = size.GetHeight() * (1f - 0.23f);
        const float boxHeight = 135f;
        foreach (var (key, heading, x) in new[]
        {
            (ContractSignatureSlots.Owner, "BÊN GIAO (CHỦ NHÀ)", 0.08),
            (ContractSignatureSlots.Tenant, "BÊN NHẬN (NGƯỜI THUÊ)", 0.56)
        })
        {
            const double normalizedWidth = 0.36;
            var left = (float)(x * size.GetWidth());
            var width = (float)(normalizedWidth * size.GetWidth());
            doc.Add(new Paragraph(heading).SetFontSize(10)
                .SetTextAlignment(TextAlignment.CENTER)
                .SetFixedPosition(page, left, boxTop + 16, width));
            var canvas = new iText.Kernel.Pdf.Canvas.PdfCanvas(pdf.GetPage(page));
            canvas.SaveState().SetStrokeColorGray(0.7f).SetLineWidth(0.65f)
                .SetLineDash(3, 3)
                .Rectangle(left, boxTop - boxHeight, width, boxHeight)
                .Stroke().RestoreState();
            doc.Add(new Paragraph(signing ? "Ký điện tử" : "Ký và ghi rõ họ tên")
                .SetFontSize(9).SetFontColor(Subtle).SetTextAlignment(TextAlignment.CENTER)
                .SetFixedPosition(page, left, boxTop - boxHeight - 22, width));
            if (signing)
                pdf.GetDocumentInfo().SetMoreInfo(key,
                    new ContractSignatureSlot(page, x, 0.23, normalizedWidth).Format());
        }
    }

    private static Task<byte[]> RenderPreparation(HandoverDraftView r, bool signing, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var doc = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            doc.SetFont(font).SetFontSize(10).SetMargins(35, 38, 40, 38);
            pdf.GetDocumentInfo().SetTitle(signing ? "BHOME - Biên bản bàn giao phòng - Chờ ký" :
                "BHOME - Biên bản bàn giao phòng - Bản nháp").SetCreator("BHOME");
            Title(doc, "BIÊN BẢN BÀN GIAO PHÒNG Ở", $"Căn cứ hợp đồng thuê phòng: {r.ContractId} · Phiên bản {r.Version}");
            if (!signing)
                doc.Add(new Paragraph("BẢN NHÁP - CHƯA KÝ")
                    .SetTextAlignment(TextAlignment.CENTER).SetFontSize(9).SetFontColor(Subtle));
            Section(doc, "1. THÔNG TIN CÁC BÊN VÀ PHÒNG BÀN GIAO");
            Line(doc, "Bên giao", "Chủ nhà (theo hợp đồng thuê phòng nêu trên)");
            Line(doc, "Bên nhận", "Người thuê (theo hợp đồng thuê phòng nêu trên)");
            Line(doc, "Cơ sở", r.LocationName);
            Line(doc, "Phòng", r.RoomNumber);
            Line(doc, "Địa chỉ", r.LocationAddress);
            Line(doc, "Thời hạn thuê", $"{r.StartDate:dd/MM/yyyy} – {r.EndDate:dd/MM/yyyy}");
            Line(doc, "Giá thuê", $"{Money(r.MonthlyRent)}/tháng");
            Line(doc, "Tiền cọc", Money(r.RequiredDeposit));
            Line(doc, "Ngày lập/ghi nhận kiểm tra", r.StaffSubmittedAt is { } receivedAt
                ? LocalDateTime(receivedAt) : "Chưa xác định");
            Section(doc, "2. CHỈ SỐ ĐIỆN, NƯỚC BAN ĐẦU");
            var meters = Grid(22, 23, 32, 23);
            Cells(meters, true, "Loại", "Chỉ số", "Mã công tơ", "Ngày ghi");
            Cells(meters, false, "Điện (kWh)", r.Electricity is null ? "Chưa xác nhận" : Meter(r.Electricity.Value),
                r.Electricity?.MeterCode ?? "—", r.Electricity?.Date.ToString("dd/MM/yyyy") ?? "—");
            Cells(meters, false, "Nước (m³)", r.Water is null ? "Chưa xác nhận" : Meter(r.Water.Value),
                r.Water?.MeterCode ?? "—", r.Water?.Date.ToString("dd/MM/yyyy") ?? "—");
            doc.Add(meters);
            Section(doc, "3. HIỆN TRẠNG PHÒNG VÀ CHÌA KHÓA");
            Line(doc, "Hiện trạng", r.RoomCondition);
            Line(doc, "Chìa khóa bàn giao", r.AccessItems?.FirstOrDefault(item => item.Type == "RoomKey") is { } keys
                ? $"{keys.Quantity} chiếc" + (string.IsNullOrWhiteSpace(keys.Notes) ? "" : " · " + keys.Notes)
                : r.KeysAndAccess);
            var checks = Grid(46, 54);
            Cells(checks, true, "Hạng mục", "Kết quả ghi nhận");
            foreach (var code in HandoverRoomChecklist.RequiredCodes)
            {
                t.ThrowIfCancellationRequested();
                var check = (r.RoomChecks ?? []).FirstOrDefault(item => item.Code == code);
                Cells(checks, false, HandoverRoomChecklist.Labels[code], check is null
                    ? StatusAndNotes("Chưa kiểm tra", null)
                    : StatusAndNotes(RoomCheckStatus(check.Status), check.Notes));
            }
            doc.Add(checks);
            Section(doc, "4. TÀI SẢN BÀN GIAO");
            if (r.InspectedAssets is { Length: 0 })
                Line(doc, "Kiểm kê", "Đã hoàn thành kiểm kê; không ghi nhận tài sản trong phòng.");
            else if (r.Assets.Length == 0 && r.InspectedAssets is not { Length: > 0 }) Line(doc, "Kiểm kê", r.NoAssetsConfirmed
                ? "Xác nhận phòng không có tài sản bàn giao." : "Chưa có kiểm kê tài sản bàn giao.");
            else
            {
                var table = Grid(25, 15, 19, 41);
                Cells(table, true, "Tài sản", "Dự kiến", "Thực tế kiểm kê", "Trạng thái / lý do");
                if (r.InspectedAssets is { Length: > 0 } inspected)
                {
                    foreach (var asset in inspected)
                    {
                        t.ThrowIfCancellationRequested();
                        var rechecked = (r.ReinspectionItems ?? []).Any(item =>
                            item.Kind == "Asset" && item.AssetId == asset.Id && item.Rechecked);
                        var updated = rechecked
                            ? r.Assets.FirstOrDefault(item => item.Id == asset.Id && item.Checked)
                            : null;
                        Cells(table, false, asset.Name, (updated?.ConfiguredQuantity ?? asset.ExpectedQuantity).ToString(Vietnamese),
                            (updated?.ObservedQuantity ?? asset.ActualQuantity).ToString(Vietnamese),
                            updated is null ? InspectedCondition(asset) : AssetCondition(updated));
                    }
                }
                else
                {
                    foreach (var asset in r.Assets)
                    {
                        t.ThrowIfCancellationRequested();
                        Cells(table, false, asset.Name, asset.ConfiguredQuantity?.ToString() ?? "—",
                            asset.ObservedQuantity?.ToString() ?? "—", AssetCondition(asset));
                    }
                }
                doc.Add(table);
            }
            Section(doc, "5. GHI CHÚ VÀ XỬ LÝ NGOẠI LỆ");
            if (!string.IsNullOrWhiteSpace(r.Notes)) Line(doc, "Ghi chú của Staff", r.Notes);
            foreach (var issue in r.OutstandingIssues ?? [])
                Line(doc, HandoverRoomChecklist.Labels.TryGetValue(issue.Code, out var label) ? label : issue.Code,
                    issue.Description);
            if (!string.IsNullOrWhiteSpace(r.OwnerReadyReason))
                Line(doc, "Ý kiến của Chủ nhà", r.OwnerReadyReason);
            if (!string.IsNullOrWhiteSpace(r.OwnerHandlingPlan))
                Line(doc, "Phương án xử lý", r.OwnerHandlingPlan);
            if (r.ReinspectionHistory is { Length: > 0 })
                Line(doc, "Kiểm tra lại", $"{r.ReinspectionHistory.Length} lượt · {r.ReinspectionHistory[^1].Reason}");
            if (r.Requests.Length > 0)
                Line(doc, "Yêu cầu điều chỉnh", $"{r.Requests.Length} lượt · Trạng thái gần nhất: {r.Requests[^1].Status}");
            AddSignaturePage(doc, pdf, signing);
        }
        return Task.FromResult(output.ToArray());
    }
    public Task<byte[]> RenderAsync(HandoverDocumentReport r, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        // Archived Move-Out PDFs remain downloadable as stored objects, but
        // no caller may create a new Move-Out PDF or implied signing document.
        if (r.Type == "MoveOut")
            throw ContractException.Conflict("move_out_pdf_not_supported");
        var title = r.Type switch { "MoveIn" => "BIÊN BẢN BÀN GIAO PHÒNG Ở", _ => "BIÊN BẢN BÀN GIAO THAY ĐỔI TÀI SẢN" };
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var doc = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            doc.SetFont(font).SetFontSize(10).SetMargins(32, 38, 44, 38);
            var info = pdf.GetDocumentInfo().SetTitle(title).SetCreator("BHOME");
            info.SetMoreInfo("BHomeDocumentId", r.DocumentId.ToString());
            info.SetMoreInfo("BHomeContractId", r.ContractId.ToString());
            info.SetMoreInfo("BHomeVersion", r.Version.ToString(CultureInfo.InvariantCulture));
            Title(doc, title, $"Biên bản {r.DocumentId} · Phiên bản {r.Version}");
            Section(doc, "1. THÔNG TIN CĂN CỨ");
            Line(doc, "Hợp đồng", r.ContractId.ToString());
            if (r.Type == "MoveIn")
            {
                Line(doc, "Bên giao", "Chủ nhà (theo hợp đồng thuê phòng nêu trên)");
                Line(doc, "Bên nhận", "Người thuê (theo hợp đồng thuê phòng nêu trên)");
            }
            Line(doc, "Cơ sở", r.LocationName);
            Line(doc, "Phòng", r.Snapshot.RoomNumber);
            Line(doc, "Địa chỉ", r.Address);
            Line(doc, "Ngày kiểm tra", r.Snapshot.Date.ToString("dd/MM/yyyy"));
            if (r.Snapshot.OtherTenantsRemain)
                Line(doc, "Phạm vi", "Kiểm tra khi còn người thuê chung; không ghi nhận trả toàn bộ tài sản.");
            if (r.Snapshot.MissingBaselineReason is { } missing)
                Line(doc, "Giới hạn dữ liệu đối chiếu", missing);
            void Assets(string heading, HandoverAsset[] assets, bool comparison = false)
            {
                Section(doc, heading);
                if (assets.Length == 0)
                {
                    Line(doc, "Tài sản", r.Snapshot.NoAssetsConfirmed
                        ? "Đã xác nhận không có tài sản bàn giao." : "Không có dữ liệu tài sản.");
                    return;
                }
                var table = comparison ? Grid(34, 20, 46) : Grid(30, 14, 14, 14, 28);
                if (comparison) Cells(table, true, "Tài sản", "Đã nhận", "Hiện trạng tham chiếu");
                else Cells(table, true, "Tài sản", "Dự kiến", "Thực tế", "Thực giao", "Hiện trạng / ghi chú");
                foreach (var a in assets)
                {
                    t.ThrowIfCancellationRequested();
                    static string Q(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "—";
                    var note = string.Join(" · ", new[] { a.ObservedCondition, a.Notes }
                        .Where(s => !string.IsNullOrWhiteSpace(s)));
                    if (comparison)
                        Cells(table, false, a.Name, Q(a.HandedOverQuantity), note);
                    else
                    {
                        var exceptions = string.Join(", ", new[]
                        {
                            a.DamagedQuantity is > 0 ? $"hỏng {a.DamagedQuantity}" : null,
                            a.MissingQuantity is > 0 ? $"thiếu {a.MissingQuantity}" : null,
                            a.WornQuantity is > 0 ? $"hao mòn {a.WornQuantity}" : null
                        }.Where(s => s is not null));
                        Cells(table, false, a.Name, Q(a.ConfiguredQuantity), Q(a.ObservedQuantity),
                            Q(a.HandedOverQuantity), string.Join(" · ", new[] { exceptions, note }
                                .Where(s => !string.IsNullOrWhiteSpace(s))));
                    }
                }
                doc.Add(table);
            }
            if (r.Baseline is not null) Assets("2. TÀI SẢN THEO BIÊN BẢN ĐỐI CHIẾU", r.Baseline.Assets, true);
            Assets(r.Baseline is not null ? "3. KẾT QUẢ KIỂM KÊ" : "2. KẾT QUẢ KIỂM KÊ", r.Snapshot.Assets);
            if (r.Type != "AssetChange")
            {
                Section(doc, "HIỆN TRẠNG PHÒNG VÀ ĐỒNG HỒ");
                Line(doc, "Hiện trạng", r.Snapshot.RoomCondition);
                Line(doc, "Chìa khóa", r.Type == "MoveIn" && r.Snapshot.KeyEvidenceIds is not null
                    ? (r.Snapshot.AccessItems?.FirstOrDefault(item => item.Type == "RoomKey")?.Quantity.ToString() ?? "Chưa kiểm đếm") + " chiếc"
                    : r.Snapshot.KeysAndAccess);
                var meters = Grid(22, 23, 32, 23);
                Cells(meters, true, "Loại", "Chỉ số", "Mã công tơ", "Ngày ghi");
                Cells(meters, false, "Điện (kWh)", Meter(r.Snapshot.Electricity.Value),
                    r.Snapshot.Electricity.MeterCode, r.Snapshot.Electricity.Date.ToString("dd/MM/yyyy"));
                Cells(meters, false, "Nước (m³)", Meter(r.Snapshot.Water.Value),
                    r.Snapshot.Water.MeterCode, r.Snapshot.Water.Date.ToString("dd/MM/yyyy"));
                doc.Add(meters);
                if (r.Type == "MoveIn" && r.Snapshot.RoomChecks is { Length: > 0 })
                {
                    Section(doc, "CHECKLIST HIỆN TRẠNG");
                    var checks = Grid(46, 54);
                    Cells(checks, true, "Hạng mục", "Kết quả");
                    foreach (var check in r.Snapshot.RoomChecks)
                        Cells(checks, false, HandoverRoomChecklist.Labels.TryGetValue(check.Code, out var label) ? label : check.Code,
                            StatusAndNotes(RoomCheckStatus(check.Status), check.Notes));
                    doc.Add(checks);
                }
                if (r.Type == "MoveIn" && r.Snapshot.AccessItems is { Length: > 0 })
                {
                    foreach (var access in r.Snapshot.AccessItems)
                        Line(doc, AccessTypeLabel(access.Type), access.Quantity + " chiếc" +
                            (string.IsNullOrWhiteSpace(access.Notes) ? "" : " · " + access.Notes));
                }
                if (r.Type == "MoveIn" && r.Snapshot.OutstandingIssues is { Length: > 0 })
                {
                    Section(doc, "VẤN ĐỀ CẦN XỬ LÝ");
                    foreach (var issue in r.Snapshot.OutstandingIssues)
                        Line(doc, HandoverRoomChecklist.Labels.TryGetValue(issue.Code, out var label) ? label : issue.Code,
                            issue.Description + $" · Hạn {issue.DueDate:dd/MM/yyyy}");
                }
            }
            Section(doc, "GHI CHÚ VÀ XÁC NHẬN");
            if (!string.IsNullOrWhiteSpace(r.Snapshot.Notes)) Line(doc, "Ghi chú", r.Snapshot.Notes);
            if (r.Snapshot.OwnerAcceptance is { } approval)
            {
                Line(doc, "Ý kiến Chủ nhà", approval.Reason);
                Line(doc, "Phương án", approval.HandlingPlan);
            }
            if (r.Snapshot.TenantFeedback is { } feedback)
                Line(doc, "Phản hồi người thuê", (feedback.Confirmed ? "Đã xác nhận hiện trạng" : "Chưa thống nhất") +
                    (string.IsNullOrWhiteSpace(feedback.Reason) ? "" : " · " + feedback.Reason));
            foreach (var decision in r.Decisions) Line(doc, "Quyết định", decision);
            foreach (var reference in r.References) Line(doc, "Tham chiếu", reference);
            Line(doc, "Ngày hoàn tất", r.ConfirmedAt.ToString("dd/MM/yyyy HH:mm"));
            doc.Add(new Paragraph("Các xác nhận tại đây là dữ liệu ứng dụng, không phải chữ ký số được chứng thực.")
                .SetFontSize(9).SetFontColor(Subtle).SetMarginTop(8));
        }
        using var final = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(output.ToArray())), new PdfWriter(final)))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            for (var page = 1; page <= pdf.GetNumberOfPages(); page++)
            {
                var canvas = new iText.Kernel.Pdf.Canvas.PdfCanvas(pdf.GetPage(page));
                using var footer = new Canvas(canvas, pdf.GetPage(page).GetPageSize());
                footer.SetFont(font).SetFontSize(8).ShowTextAligned(new Paragraph($"BHome · {r.Type} · v{r.Version} · Trang {page}/{pdf.GetNumberOfPages()}"), 32, 20, TextAlignment.LEFT);
            }
        }
        var bytes = final.ToArray();
        if (bytes.Length > 100 * 1024 * 1024) throw new ContractException(413, "handover_document_too_large");
        return Task.FromResult(bytes);
    }

    private static string RoomCheckStatus(string status) => status switch
    {
        "Passed" => "Đạt",
        "Issue" => "Cần xử lý",
        "NotApplicable" => "Không áp dụng",
        _ => status
    };

    private static string AccessTypeLabel(string type) => type switch
    {
        "RoomKey" => "Chìa khóa phòng",
        "GateKey" => "Chìa khóa cổng",
        "AccessCard" => "Thẻ từ",
        "Remote" => "Điều khiển",
        "DigitalAccess" => "Quyền ra vào điện tử",
        "Other" => "Quyền truy cập khác",
        _ => type
    };
}
