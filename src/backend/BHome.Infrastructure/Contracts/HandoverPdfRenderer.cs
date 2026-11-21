using System.Globalization;
using BHome.Application.Contracts;
using iText.IO.Font;
using iText.IO.Image;
using iText.Kernel.Font;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using iText.Layout.Properties;

namespace BHome.Infrastructure.Contracts;

internal sealed class HandoverPdfRenderer : IHandoverDocumentRenderer, IHandoverDraftPdfRenderer
{
    private static readonly Lazy<byte[]> Font = new(() =>
    {
        using var stream = typeof(ContractPdfRenderer).Assembly.GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new ContractException(503, "contract_pdf_font_not_available");
        using var bytes = new MemoryStream(); stream.CopyTo(bytes); return bytes.ToArray();
    });
    public Task<byte[]> RenderDraftAsync(HandoverDraftView r, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var doc = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            doc.SetFont(font).SetFontSize(10).SetMargins(35, 35, 40, 35);
            pdf.GetDocumentInfo().SetTitle("BHOME - Biên bản bàn giao phòng - Bản nháp").SetCreator("BHOME");
            doc.Add(new Paragraph("BIÊN BẢN BÀN GIAO PHÒNG VÀ TÀI SẢN")
                .SetFontSize(16).SetTextAlignment(TextAlignment.CENTER));
            doc.Add(new Paragraph("BẢN NHÁP - CHƯA XÁC NHẬN / KHÔNG PHẢI CHỮ KÝ")
                .SetTextAlignment(TextAlignment.CENTER));
            doc.Add(new Paragraph($"Hợp đồng: {r.ContractId} · Phiên bản nháp {r.Version} · {r.Status}"));
            doc.Add(new Paragraph($"Cơ sở: {r.LocationName}\nĐịa chỉ: {r.LocationAddress}\nPhòng: {r.RoomNumber}"));
            doc.Add(new Paragraph($"Thời hạn thuê: {r.StartDate:dd/MM/yyyy} - {r.EndDate:dd/MM/yyyy}\n" +
                $"Tiền thuê: {r.MonthlyRent:N0} VND/tháng · Tiền cọc: {r.RequiredDeposit:N0} VND"));
            doc.Add(new Paragraph("Điều khoản hợp đồng tham chiếu: " + r.Terms));
            doc.Add(new Paragraph("1. KIỂM TRA ĐIỆN NƯỚC"));
            doc.Add(new Paragraph("Điện: " + (r.Electricity is null ? "Chưa có ảnh và chỉ số khởi tạo đã xác nhận" :
                $"{r.Electricity.Value} kWh · {r.Electricity.MeterCode} · {r.Electricity.Date:dd/MM/yyyy}")));
            doc.Add(new Paragraph("Nước: " + (r.Water is null ? "Chưa có ảnh và chỉ số khởi tạo đã xác nhận" :
                $"{r.Water.Value} m³ · {r.Water.MeterCode} · {r.Water.Date:dd/MM/yyyy}")));
            doc.Add(new Paragraph("2. KIỂM KÊ TÀI SẢN"));
            if (r.Assets.Length == 0) doc.Add(new Paragraph(r.NoAssetsConfirmed
                ? "Owner đã xác nhận phòng không có tài sản bàn giao."
                : "Chưa có kiểm kê tài sản bàn giao."));
            else
            {
                var table = new Table(UnitValue.CreatePercentArray([35f, 15f, 15f, 35f])).UseAllAvailableWidth();
                foreach (var heading in new[] { "Tài sản", "Dự kiến", "Thực giao", "Tình trạng / ghi chú" })
                    table.AddHeaderCell(new Cell().Add(new Paragraph(heading)));
                foreach (var asset in r.Assets)
                {
                    foreach (var cell in new[] { asset.Name, asset.ConfiguredQuantity?.ToString() ?? "—",
                        asset.HandedOverQuantity?.ToString() ?? "Chưa kiểm", asset.Checked
                            ? asset.ObservedCondition + "\n" + asset.Notes : "Chưa kiểm kê" })
                        table.AddCell(new Cell().Add(new Paragraph(cell ?? "")));
                }
                doc.Add(table);
            }
            doc.Add(new Paragraph("3. HIỆN TRẠNG PHÒNG, CHÌA KHÓA VÀ BẰNG CHỨNG"));
            doc.Add(new Paragraph("Tình trạng phòng: " + (string.IsNullOrWhiteSpace(r.RoomCondition) ? "Chưa kiểm tra" : r.RoomCondition)));
            if (r.KeyEvidenceIds is null)
            {
                doc.Add(new Paragraph("Chìa khóa / thẻ / quyền truy cập: " +
                    (string.IsNullOrWhiteSpace(r.KeysAndAccess) ? "Chưa kiểm tra" : r.KeysAndAccess)));
                doc.Add(new Paragraph("Ảnh minh chứng kèm theo: " + r.EvidenceIds.Length));
            }
            else
            {
                doc.Add(new Paragraph("Chìa khóa bàn giao: " +
                    (r.AccessItems?.FirstOrDefault(item => item.Type == "RoomKey")?.Quantity.ToString() ?? "Chưa kiểm đếm")));
                doc.Add(new Paragraph("Ảnh chìa khóa bàn giao: " + r.KeyEvidenceIds.Length));
            }
            doc.Add(new Paragraph("Ghi chú: " + r.Notes));
            doc.Add(new Paragraph("4. CHECKLIST HIỆN TRẠNG CHI TIẾT"));
            foreach (var code in HandoverRoomChecklist.RequiredCodes)
            {
                var check = (r.RoomChecks ?? []).SingleOrDefault(item => item.Code == code);
                doc.Add(new Paragraph($"{HandoverRoomChecklist.Labels[code]}: " +
                    (check is null ? "Chưa kiểm tra" : $"{RoomCheckStatus(check.Status)} · {check.Notes} · {check.EvidenceIds.Length} ảnh")));
            }
            doc.Add(new Paragraph(r.KeyEvidenceIds is null
                ? "5. CHÌA KHÓA / QUYỀN TRUY CẬP THỰC GIAO" : "5. CHÌA KHÓA BÀN GIAO"));
            foreach (var item in r.AccessItems ?? [])
                doc.Add(new Paragraph($"{(r.KeyEvidenceIds is not null && item.Type == "RoomKey" ? "Chìa khóa bàn giao" : AccessTypeLabel(item.Type))}: {item.Quantity} · {item.Notes}"));
            if (r.AccessItems is not { Length: > 0 }) doc.Add(new Paragraph("Chưa kiểm đếm chìa khóa"));
            doc.Add(new Paragraph("6. VẤN ĐỀ TỒN TẠI VÀ PHƯƠNG ÁN KHẮC PHỤC"));
            foreach (var issue in r.OutstandingIssues ?? [])
                doc.Add(new Paragraph($"{(HandoverRoomChecklist.Labels.TryGetValue(issue.Code, out var label) ? label : issue.Code)}: " +
                    $"{issue.Description} · Người xử lý: {issue.ResponsibleParty} · Hạn: {issue.DueDate:dd/MM/yyyy}"));
            if (r.OutstandingIssues is not { Length: > 0 }) doc.Add(new Paragraph("Chưa ghi nhận vấn đề cần khắc phục"));
            doc.Add(new Paragraph("7. THEO DÕI DUYỆT VÀ XÁC NHẬN"));
            doc.Add(new Paragraph("Owner sẵn sàng bàn giao: " + (r.OwnerReadyAt?.ToString("dd/MM/yyyy HH:mm") ?? "Chưa duyệt")));
            doc.Add(new Paragraph("Tenant xác nhận: " + (r.TenantConfirmedAt?.ToString("dd/MM/yyyy HH:mm") ?? "Chưa xác nhận")));
            foreach (var request in r.Requests)
                doc.Add(new Paragraph($"Yêu cầu sửa {request.CreatedAt:dd/MM/yyyy}: {request.Reason}\n" +
                    $"Trạng thái: {request.Status} · {request.DecisionReason}"));
            if (r.Missing.Length != 0) doc.Add(new Paragraph("Hạng mục chưa hoàn tất: " + string.Join(", ", r.Missing)));
            doc.Add(new Paragraph("Tài liệu này tự cập nhật theo dữ liệu xác nhận trên BHOME. " +
                "Chỉ biên bản hoàn tất được lưu riêng dưới dạng PDF có kiểm tra toàn vẹn."));
        }
        return Task.FromResult(output.ToArray());
    }
    public Task<byte[]> RenderAsync(HandoverDocumentReport r, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        var title = r.Type switch { "MoveIn" => "BIÊN BẢN BÀN GIAO NHẬN PHÒNG", "MoveOut" => "BIÊN BẢN KIỂM TRA TRẢ PHÒNG", _ => "BIÊN BẢN BÀN GIAO THAY ĐỔI TÀI SẢN" };
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var doc = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            doc.SetFont(font).SetFontSize(10).SetMargins(32, 32, 44, 32);
            var info = pdf.GetDocumentInfo().SetTitle(title).SetCreator("BHOME");
            info.SetMoreInfo("BHomeDocumentId", r.DocumentId.ToString());
            info.SetMoreInfo("BHomeContractId", r.ContractId.ToString());
            info.SetMoreInfo("BHomeVersion", r.Version.ToString(CultureInfo.InvariantCulture));
            void Text(string value) => doc.Add(new Paragraph(value).SetMarginBottom(5));
            Text(title);
            Text($"Số biên bản: {r.DocumentId} · Phiên bản {r.Version}\nHợp đồng: {r.ContractId}");
            Text($"Cơ sở: {r.LocationName}\nĐịa chỉ: {r.Address}\nPhòng: {r.Snapshot.RoomNumber}\nNgày thực tế: {r.Snapshot.Date:dd/MM/yyyy}");
            Text($"Owner: {r.OwnerId}\nStaff: {r.StaffId}\nTenant: {r.TenantId}");
            Text("Các xác nhận dưới đây được ghi nhận trong ứng dụng BHOME, không phải chữ ký số được chứng thực.");
            if (r.Snapshot.OtherTenantsRemain) Text("Kiểm tra hiện trạng phòng chung khi một Tenant rời đi. Tài sản chung tiếp tục ở lại phòng; không ghi nhận hoàn trả toàn bộ tài sản.");
            if (r.Snapshot.MissingBaselineReason is { } missing) Text("GIỚI HẠN DỮ LIỆU SO SÁNH: " + missing + ". Không suy đoán hiện trạng ban đầu hoặc tự xác định trách nhiệm bồi thường.");
            void Assets(string heading, HandoverAsset[] assets, bool comparison = false)
            {
                Text(heading);
                if (assets.Length == 0) { Text(r.Snapshot.NoAssetsConfirmed ? "Owner đã xác nhận không có tài sản bàn giao." : "Không có dữ liệu lịch sử về tài sản."); return; }
                var table = new Table(UnitValue.CreatePercentArray(comparison ? [27f, 18f, 55f] : [27f, 12f, 12f, 12f, 37f])).UseAllAvailableWidth();
                foreach (var label in comparison ? new[] { "Nhóm / đơn vị", "Số đã nhận hiệu lực", "Tình trạng tham chiếu / ghi chú" } : new[] { "Nhóm / đơn vị", "Yêu cầu", "Thực tế", "Bàn giao", "Tình trạng / ghi chú" }) table.AddHeaderCell(new Cell().Add(new Paragraph(label)));
                foreach (var a in assets)
                {
                    t.ThrowIfCancellationRequested();
                    static string Q(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "Chưa rõ";
                    var cells = comparison ? new[] { a.Name + "\n" + a.Unit, Q(a.HandedOverQuantity), a.ObservedCondition + "\n" + a.Notes } :
                        new[] { a.Name + "\n" + a.Unit, Q(a.ConfiguredQuantity), Q(a.ObservedQuantity), Q(a.HandedOverQuantity),
                        $"Tốt: {Q(a.GoodQuantity)}; hao mòn: {Q(a.WornQuantity)}; hỏng: {Q(a.DamagedQuantity)}; thiếu: {Q(a.MissingQuantity)}\n{a.ObservedCondition}\n{a.Notes}" };
                    foreach (var value in cells)
                        table.AddCell(new Cell().Add(new Paragraph(value)).SetPadding(5));
                }
                doc.Add(table);
            }
            if (r.Baseline is not null) Assets("Baseline đối chiếu: số đã nhận có tính các thay đổi Tenant đã xác nhận", r.Baseline.Assets, true);
            Assets("Kết quả kiểm tra thực tế", r.Snapshot.Assets);
            if (r.Type != "AssetChange")
            {
                Text("Hiện trạng phòng: " + r.Snapshot.RoomCondition);
                Text(r.Type == "MoveIn" && r.Snapshot.KeyEvidenceIds is not null
                    ? "Chìa khóa bàn giao: " + (r.Snapshot.AccessItems?.FirstOrDefault(item => item.Type == "RoomKey")?.Quantity.ToString() ?? "Chưa kiểm đếm") + " chiếc"
                    : "Chìa khóa / thẻ / quyền truy cập: " + r.Snapshot.KeysAndAccess);
                Text($"Chỉ số điện đã xác nhận: {r.Snapshot.Electricity.Value} ({r.Snapshot.Electricity.MeterCode}, {r.Snapshot.Electricity.Id})\nChỉ số nước đã xác nhận: {r.Snapshot.Water.Value} ({r.Snapshot.Water.MeterCode}, {r.Snapshot.Water.Id})");
                if (r.Type == "MoveIn" && r.Snapshot.RoomChecks is { Length: > 0 })
                {
                    Text("CHECKLIST HIỆN TRẠNG NHẬN PHÒNG");
                    foreach (var check in r.Snapshot.RoomChecks)
                        Text($"{(HandoverRoomChecklist.Labels.TryGetValue(check.Code, out var label) ? label : check.Code)}: " +
                            $"{RoomCheckStatus(check.Status)} · {check.Notes} · {check.EvidenceIds.Length} ảnh");
                }
                if (r.Type == "MoveIn" && r.Snapshot.AccessItems is { Length: > 0 })
                {
                    Text(r.Snapshot.KeyEvidenceIds is null ? "CHÌA KHÓA VÀ QUYỀN TRUY CẬP ĐÃ GIAO" : "CHÌA KHÓA ĐÃ GIAO");
                    foreach (var access in r.Snapshot.AccessItems)
                        Text($"{(r.Snapshot.KeyEvidenceIds is not null && access.Type == "RoomKey" ? "Chìa khóa bàn giao" : AccessTypeLabel(access.Type))}: {access.Quantity} · {access.Notes}");
                    if (r.Snapshot.KeyEvidenceIds is not null)
                        Text($"Ảnh chìa khóa bàn giao: {r.Snapshot.KeyEvidenceIds.Length}");
                }
                if (r.Type == "MoveIn" && r.Snapshot.OutstandingIssues is { Length: > 0 })
                {
                    Text("VẤN ĐỀ TỒN TẠI VÀ THỜI HẠN XỬ LÝ");
                    foreach (var issue in r.Snapshot.OutstandingIssues)
                        Text($"{(HandoverRoomChecklist.Labels.TryGetValue(issue.Code, out var label) ? label : issue.Code)}: " +
                            $"{issue.Description} · Người xử lý: {issue.ResponsibleParty} · Hạn: {issue.DueDate:dd/MM/yyyy}");
                }
            }
            Text("Ghi chú: " + r.Snapshot.Notes);
            if (!string.IsNullOrWhiteSpace(r.Snapshot.ProposedCompensation)) Text("Đề xuất của Staff, chưa phải khoản phải thu: " + r.Snapshot.ProposedCompensation);
            if (r.Snapshot.OwnerAcceptance is { } approval) Text($"Owner chấp nhận ngoại lệ v{approval.Version}: {approval.Reason}\nPhương án: {approval.HandlingPlan}\nNgười xác nhận: {approval.ActorId} · {approval.At:O}");
            if (r.Snapshot.TenantFeedback is { } feedback) Text($"Phản hồi Tenant: {(feedback.Confirmed ? "Xác nhận hiện trạng" : "Không đồng ý")} · {feedback.Reason}\n{feedback.ActorId} · {feedback.At:O}\nPhản hồi hiện trạng không đồng nghĩa chấp nhận bồi thường.");
            foreach (var decision in r.Decisions) Text(decision);
            foreach (var reference in r.References) Text("Tham chiếu: " + reference);
            Text($"Tenant xác nhận: {r.TenantConfirmedAt?.ToString("O", CultureInfo.InvariantCulture) ?? "Chưa xác nhận / xử lý ngoại lệ được ghi riêng"}\nXác nhận hoàn tất: {r.ConfirmedAt:O}");
            if (r.Photos.Length > 0)
            {
                doc.Add(new AreaBreak(AreaBreakType.NEXT_PAGE)); Text("PHỤ LỤC BẰNG CHỨNG");
                foreach (var photo in r.Photos)
                {
                    t.ThrowIfCancellationRequested();
                    var block = new Div().SetKeepTogether(true).Add(new Paragraph(photo.Caption + " · " + photo.Id).SetFontSize(9));
                    block.Add(new Image(ImageDataFactory.Create(photo.Bytes)).ScaleToFit(490, 300)); doc.Add(block);
                }
            }
        }
        using var final = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(output.ToArray())), new PdfWriter(final)))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            for (var page = 1; page <= pdf.GetNumberOfPages(); page++)
            {
                var canvas = new iText.Kernel.Pdf.Canvas.PdfCanvas(pdf.GetPage(page));
                using var footer = new Canvas(canvas, pdf.GetPage(page).GetPageSize());
                footer.SetFont(font).SetFontSize(8).ShowTextAligned(new Paragraph($"BHOME · {r.Type} · v{r.Version} · Trang {page}/{pdf.GetNumberOfPages()}"), 32, 20, TextAlignment.LEFT);
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
