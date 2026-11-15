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

internal sealed class HandoverPdfRenderer : IHandoverDocumentRenderer
{
    private static readonly Lazy<byte[]> Font = new(() =>
    {
        using var stream = typeof(ContractPdfRenderer).Assembly.GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new ContractException(503, "contract_pdf_font_not_available");
        using var bytes = new MemoryStream(); stream.CopyTo(bytes); return bytes.ToArray();
    });
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
            void Assets(string heading, HandoverAsset[] assets)
            {
                Text(heading);
                if (assets.Length == 0) { Text(r.Snapshot.NoAssetsConfirmed ? "Owner đã xác nhận không có tài sản bàn giao." : "Không có dữ liệu lịch sử về tài sản."); return; }
                var table = new Table(UnitValue.CreatePercentArray([27f, 12f, 12f, 12f, 37f])).UseAllAvailableWidth();
                foreach (var label in new[] { "Nhóm / đơn vị", "Yêu cầu", "Thực tế", "Bàn giao", "Tình trạng / ghi chú" }) table.AddHeaderCell(new Cell().Add(new Paragraph(label)));
                foreach (var a in assets)
                {
                    t.ThrowIfCancellationRequested();
                    static string Q(int? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "Chưa rõ";
                    foreach (var value in new[] { a.Name + "\n" + a.Unit, Q(a.ConfiguredQuantity), Q(a.ObservedQuantity), Q(a.HandedOverQuantity),
                        $"Tốt: {Q(a.GoodQuantity)}; hao mòn: {Q(a.WornQuantity)}; hỏng: {Q(a.DamagedQuantity)}; thiếu: {Q(a.MissingQuantity)}\n{a.ObservedCondition}\n{a.Notes}" })
                        table.AddCell(new Cell().Add(new Paragraph(value)).SetPadding(5));
                }
                doc.Add(table);
            }
            if (r.Baseline is not null) Assets("Dữ liệu bàn giao đã xác nhận dùng để so sánh", r.Baseline.Assets);
            Assets("Kết quả kiểm tra thực tế", r.Snapshot.Assets);
            Text("Hiện trạng phòng: " + r.Snapshot.RoomCondition);
            Text("Chìa khóa / thẻ / quyền truy cập: " + r.Snapshot.KeysAndAccess);
            Text($"Chỉ số điện đã xác nhận: {r.Snapshot.Electricity.Value} ({r.Snapshot.Electricity.MeterCode}, {r.Snapshot.Electricity.Id})\nChỉ số nước đã xác nhận: {r.Snapshot.Water.Value} ({r.Snapshot.Water.MeterCode}, {r.Snapshot.Water.Id})");
            Text("Ghi chú: " + r.Snapshot.Notes);
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
}
