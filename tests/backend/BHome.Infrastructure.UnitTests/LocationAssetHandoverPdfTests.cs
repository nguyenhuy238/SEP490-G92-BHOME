using BHome.Application.StaffOperations;
using BHome.Infrastructure.StaffOperations;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;

namespace BHome.Infrastructure.UnitTests;

public sealed class LocationAssetHandoverPdfTests
{
    [Fact]
    public void PreviewRetainsFrozenSnapshotIdentityAndSeparatesDirectFromTenantEvidence()
    {
        var report = MakeReport();
        var bytes = LocationAssetHandoverPdfRenderer.Render(report, CancellationToken.None);

        Assert.True(bytes.Length > 500);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(bytes[..5]));
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        Assert.Equal(report.TaskId.ToString(), pdf.GetDocumentInfo().GetMoreInfo("BHomeInventoryTaskId"));
        Assert.Equal("1", pdf.GetDocumentInfo().GetMoreInfo("BHomeInventoryRevision"));
        Assert.Equal(report.SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeInventorySnapshotSHA256"));
        Assert.Equal("BHome", pdf.GetDocumentInfo().GetCreator());
        Assert.Contains(Enumerable.Range(1, pdf.GetNumberOfPdfObjects()),
            index => pdf.GetPdfObject(index) is PdfStream stream &&
                PdfName.Image.Equals(stream.GetAsName(PdfName.Subtype)));
        var text = Text(pdf);
        Assert.Contains("BHome", text);
        Assert.Contains("Bảng kê tài sản", text);
        Assert.Contains("Owner: Nguyễn Văn Quản Lý", text);
        Assert.Contains("Staff nhận bàn giao: Trần Văn Kiểm Kê", text);
        Assert.Contains("Theo hồ sơ Tenant:", text);
        Assert.Contains("Staff kiểm kê trực tiếp", text);
        Assert.Contains("KHÔNG phải chữ ký số", text);
        Assert.Contains("Chờ xác nhận", text);
    }

    [Fact]
    public void SignedCopyRendersBothAuthenticatedAcceptanceRecords()
    {
        var report = MakeReport();
        var owner = new LocationAssetHandoverAcceptance(report.OwnerId,
            DateTimeOffset.Parse("2026-11-19T09:00:00+07:00"), "AuthenticatedSessionAcceptance", report.SnapshotHash);
        var staff = new LocationAssetHandoverAcceptance(report.StaffId,
            DateTimeOffset.Parse("2026-11-19T09:05:00+07:00"), "AuthenticatedSessionAcceptance", report.SnapshotHash);
        var signed = report with { OwnerSignature = owner, StaffSignature = staff };
        var bytes = LocationAssetHandoverPdfRenderer.Render(signed, CancellationToken.None);

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.Contains("Đã xác nhận qua tài khoản BHOME", text);
        Assert.Contains(report.OwnerId.ToString(), text);
        Assert.Contains(report.StaffId.ToString(), text);
        Assert.DoesNotContain("Chờ xác nhận", text);
        Assert.Equal(report.SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeInventorySnapshotSHA256"));
    }

    [Fact]
    public void PreviewIncludesStaffObservedConditionInTheFrozenAssetTable()
    {
        var report = MakeReport();
        var priorStaffId = Guid.NewGuid();
        var damaged = report.Items[1] with { Condition = "Damaged", PriorStaffUserId = priorStaffId };
        var inaccessible = report.Items[0] with { Condition = "NotAccessible" };
        var bytes = LocationAssetHandoverPdfRenderer.Render(report with
        {
            Items = [damaged, inaccessible]
        }, CancellationToken.None);

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.Contains("Hiện trạng: Tài sản hư hỏng", text);
        Assert.Contains("Hiện trạng: Không thể kiểm tra", text);
        Assert.Contains("Kế thừa kết quả kiểm kê từ Staff trước", text);
        Assert.Contains(priorStaffId.ToString(), string.Concat(text.Where(character => !char.IsWhiteSpace(character))));
    }

    private static string Text(PdfDocument pdf) => string.Join("\n",
        Enumerable.Range(1, pdf.GetNumberOfPages())
            .Select(page => PdfTextExtractor.GetTextFromPage(pdf.GetPage(page))));

    private static LocationAssetReportPdf MakeReport()
    {
        var task = Guid.NewGuid();
        var source = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var staff = Guid.NewGuid();
        var hash = new string('A', 64);
        return new(task, Guid.NewGuid(), 1, "Cơ sở Hòa Bình", "Hà Nội", owner, staff,
            DateTimeOffset.Parse("2026-11-19T08:55:00+07:00"), hash, null,
            [
                new(Guid.NewGuid(), "Phòng P101", "Giường đơn", 2, true, source, null, "Tenant giữ"),
                new(Guid.NewGuid(), "Khu vực chung", "Bàn ghế", 3, false, null, null, "Đủ số lượng")
            ], OwnerDisplayName: "Nguyễn Văn Quản Lý",
            StaffDisplayName: "Trần Văn Kiểm Kê");
    }
}
