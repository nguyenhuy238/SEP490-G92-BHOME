using System.Globalization;
using BHome.Application.StaffOperations;
using iText.IO.Font;
using iText.Kernel.Font;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
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
    string? OwnerDisplayName = null, string? StaffDisplayName = null);

internal static class LocationAssetHandoverPdfRenderer
{
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

    internal static byte[] Render(LocationAssetReportPdf report, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var document = new Document(pdf, PageSize.A4))
        {
            var font = PdfFontFactory.CreateFont(Font.Value, PdfEncodings.IDENTITY_H,
                PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            document.SetFont(font).SetFontSize(10).SetMargins(38, 32, 42, 32);
            var info = pdf.GetDocumentInfo();
            info.SetTitle("Biên bản bàn giao tài sản và trách nhiệm quản lý cơ sở");
            info.SetMoreInfo("BHomeInventoryTaskId", report.TaskId.ToString());
            info.SetMoreInfo("BHomeInventoryRevision", report.Revision.ToString(CultureInfo.InvariantCulture));
            info.SetMoreInfo("BHomeInventorySnapshotSHA256", report.SnapshotHash);

            document.Add(new Paragraph("BIÊN BẢN BÀN GIAO TÀI SẢN VÀ TRÁCH NHIỆM QUẢN LÝ CƠ SỞ")
                .SetTextAlignment(TextAlignment.CENTER).SetFontSize(13));
            document.Add(new Paragraph($"Mã công việc: {report.TaskId:D}  ·  Lần lập: {report.Revision}\n" +
                $"Phân công: {report.AssignmentId:D}\n" +
                $"Cơ sở: {report.LocationName}\nĐịa chỉ: {report.Address}\n" +
                $"Owner: {report.OwnerDisplayName ?? report.OwnerId.ToString("D")} (tài khoản {report.OwnerId:D})\n" +
                $"Staff nhận bàn giao: {report.StaffDisplayName ?? report.StaffId.ToString("D")} (tài khoản {report.StaffId:D})\n" +
                $"Owner duyệt dữ liệu ngày: {report.ApprovedAt.ToOffset(TimeSpan.FromHours(7)):dd/MM/yyyy HH:mm:ss}"));

            var direct = report.Items.Count(x => !x.Inherited);
            var inherited = report.Items.Count - direct;
            document.Add(new Paragraph($"Tổng mục tài sản: {report.Items.Count}; kiểm tra trực tiếp: {direct}; " +
                $"xác nhận theo hồ sơ bàn giao Tenant: {inherited}."));
            document.Add(new Paragraph("Mục xác nhận theo biên bản Tenant không đồng nghĩa Staff đã vào phòng " +
                "kiểm kê trực tiếp. Trách nhiệm bảo quản của Tenant theo hợp đồng và biên bản phòng không tự động " +
                "chuyển sang Staff."));
            document.Add(new Paragraph("Bảng kê tài sản đã được đối soát").SetFontSize(11));
            if (report.Items.Count == 0)
                document.Add(new Paragraph("Không có mục tài sản trong phạm vi đã chốt; xem quyết định ngoại lệ bên dưới."));
            else
            {
                var table = new Table(UnitValue.CreatePercentArray([24f, 23f, 10f, 43f]))
                    .UseAllAvailableWidth().SetFontSize(9);
                foreach (var title in new[] { "Phòng / khu vực", "Tài sản", "Số lượng", "Phương thức xác nhận / chú thích" })
                    table.AddHeaderCell(new Cell().Add(new Paragraph(title)));
                foreach (var item in report.Items)
                {
                    token.ThrowIfCancellationRequested();
                    var method = item.Inherited
                        ? $"Theo hồ sơ Tenant: {item.SourceHandoverContractId?.ToString("D") ?? "chưa rõ nguồn"}"
                        : item.PriorStaffUserId is { } priorStaff
                            ? $"Kế thừa kết quả kiểm kê từ Staff trước (tài khoản {priorStaff:D})"
                            : "Staff kiểm kê trực tiếp";
                    if (item.IncidentId is { } incident) method += $"\nSự cố: {incident:D}";
                    method += "\nHiện trạng: " + ConditionLabel(item.Condition);
                    if (!string.IsNullOrWhiteSpace(item.Note)) method += "\n" + item.Note;
                    foreach (var cell in new[] { item.Scope, item.Name,
                                 item.Quantity.ToString(CultureInfo.InvariantCulture), method })
                        table.AddCell(new Cell().Add(new Paragraph(cell)).SetPadding(5));
                }
                document.Add(table);
            }
            if (!string.IsNullOrWhiteSpace(report.ExceptionDecision))
                document.Add(new Paragraph("QUYẾT ĐỊNH NGOẠI LỆ CỦA OWNER\n" + report.ExceptionDecision));
            document.Add(new Paragraph("Dấu vân tay SHA-256 của dữ liệu kiểm kê đã đóng băng: " + report.SnapshotHash)
                .SetFontSize(8));
            document.Add(new Paragraph("Hai bên xác nhận đã xem cùng phiên bản biên bản này. " +
                "Đây là ghi nhận chấp thuận điện tử qua phiên đăng nhập BHOME, có tài khoản, thời điểm và " +
                "mã băm dữ liệu; KHÔNG phải chữ ký số chứng thư số/PAdES."));

            var signatures = new Table(UnitValue.CreatePercentArray([50f, 50f])).UseAllAvailableWidth();
            static string Label(string role, string? name, LocationAssetHandoverAcceptance? signature) =>
                role + (string.IsNullOrWhiteSpace(name) ? "" : "\n" + name) +
                "\n" + (signature is null ? "Chờ xác nhận" :
                    $"Đã xác nhận qua tài khoản BHOME\n{signature.ActorId:D}\n" +
                    $"{signature.SignedAt.ToOffset(TimeSpan.FromHours(7)):dd/MM/yyyy HH:mm:ss}");
            signatures.AddCell(new Cell().Add(new Paragraph(Label("OWNER", report.OwnerDisplayName, report.OwnerSignature)))
                .SetMinHeight(85).SetPadding(8));
            signatures.AddCell(new Cell().Add(new Paragraph(Label("STAFF", report.StaffDisplayName, report.StaffSignature)))
                .SetMinHeight(85).SetPadding(8));
            document.Add(signatures);
            document.Add(new Paragraph("Biên bản đã chốt không được sửa trực tiếp. Nếu thay đổi kết quả kiểm kê, " +
                "hệ thống phải tạo lần lập mới và thu thập lại các xác nhận.").SetFontSize(8));
        }
        // iText closes the writer's stream along with the PDF. MemoryStream.ToArray()
        // deliberately works after Close(), while Length throws ObjectDisposedException.
        var bytes = output.ToArray();
        if (bytes.Length > 20 * 1024 * 1024)
            throw new OperationalTaskException(413, "location_handover_pdf_too_large");
        return bytes;
    }
}
