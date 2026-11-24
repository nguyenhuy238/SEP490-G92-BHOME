using BHome.Application.Contracts;
using BHome.Application.StaffOperations;
using BHome.Infrastructure.Contracts;
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
        var text = Text(pdf);
        Assert.Contains("BIÊN BẢN BÀN GIAO TÀI SẢN", text);
        Assert.Contains("PHỤ LỤC 01", text);
        Assert.Contains("Phân công quản lý Cơ sở Hòa Bình cho Trần Văn Kiểm Kê", text);
        Assert.Contains("Hiệu lực phân công: 01/11/2026 – 30/11/2026", text);
        Assert.Contains("Nguyễn Văn Quản Lý", text);
        Assert.Contains("Theo hồ sơ Tenant", text);
        Assert.Contains("Staff kiểm kê trực tiếp", text);
        Assert.Contains("KHÔNG phải chữ ký số", text);
        Assert.Contains("Chờ xác nhận", text);
        Assert.Contains("Trang 1", text);
        Assert.DoesNotContain(report.TaskId.ToString("D"), PdfTextExtractor.GetTextFromPage(pdf.GetPage(1)));
        Assert.DoesNotContain(report.AssignmentId.ToString("D"), PdfTextExtractor.GetTextFromPage(pdf.GetPage(1)));
    }

    [Fact]
    public void SignedCopyRendersBothAuthenticatedAcceptanceRecords()
    {
        var report = MakeReport();
        var owner = new LocationAssetHandoverAcceptance(report.OwnerId,
            DateTimeOffset.Parse("2026-11-19T09:00:00+07:00"), "AuthenticatedSessionAcceptance", report.SnapshotHash);
        var staff = new LocationAssetHandoverAcceptance(report.StaffId,
            DateTimeOffset.Parse("2026-11-19T09:05:00+07:00"), "AuthenticatedSessionAcceptance", report.SnapshotHash);
        var ink = new SignaturePictureGenerator().Render(new HandoverInkInput(320, 160,
            [[[15d, 25d], [45d, 60d], [72d, 40d], [94d, 76d], [125d, 48d]]]));
        var signed = report with
        {
            OwnerSignature = owner,
            StaffSignature = staff,
            OwnerInkPng = ink,
            StaffInkPng = ink
        };
        var bytes = LocationAssetHandoverPdfRenderer.Render(signed, CancellationToken.None);

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.Contains("Đã xác nhận qua tài khoản BHOME", text);
        Assert.Contains(report.OwnerId.ToString(), text);
        Assert.Contains(report.StaffId.ToString(), text);
        Assert.DoesNotContain("Chờ xác nhận", text);
        Assert.True(Enumerable.Range(1, pdf.GetNumberOfPages()).Sum(page =>
            pdf.GetPage(page).GetResources().GetResource(PdfName.XObject) is PdfDictionary images
                ? images.Size() : 0) >= 2,
            "Both handwritten signatures must appear as images in the PDF.");
        var pages = Enumerable.Range(1, pdf.GetNumberOfPages())
            .Select(page => PdfTextExtractor.GetTextFromPage(pdf.GetPage(page))).ToArray();
        Assert.Contains(pages, page => page.Contains("BÊN GIAO") && page.Contains("BÊN NHẬN"));
        Assert.True(Array.FindIndex(pages, page => page.Contains("BÊN GIAO")) <
            Array.FindIndex(pages, page => page.Contains("PHỤ LỤC 01")),
            "Balanced Owner/Staff signatures belong to the core minutes, before the appendix.");
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
        var compactText = string.Concat(text.Where(character => !char.IsWhiteSpace(character)));
        Assert.Contains("Tàisảnhưhỏng", compactText);
        Assert.Contains("Khôngthểkiểmtra", compactText);
        Assert.Contains("Kế thừa kết quả kiểm kê từ Staff trước", text);
        Assert.Contains(priorStaffId.ToString(), string.Concat(text.Where(character => !char.IsWhiteSpace(character))));
    }

    [Fact]
    public void ContradictoryMissingNoteRetainsIntactConditionAndFlagsReview()
    {
        var report = MakeReport();
        var contradictory = report.Items[0] with
        {
            Condition = "Intact",
            Note = "Thiếu 1 giường so với danh mục ban đầu"
        };
        var bytes = LocationAssetHandoverPdfRenderer.Render(report with
        {
            Items = [contradictory]
        }, CancellationToken.None);

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.Contains("Ghi chú cần đối chiếu", text);
        Assert.Contains("Đủ và nguyên vẹn", text);
        Assert.Contains("Thiếu 1 giường so với danh mục ban đầu", text);
        Assert.Contains("Phòng P101", text);
    }

    [Fact]
    public void EmptyInventoryShowsExplicitZeroQuantityAndStillRendersSignatureSection()
    {
        var report = MakeReport() with { Items = [], ExceptionDecision = "Không có tài sản để bàn giao" };
        var bytes = LocationAssetHandoverPdfRenderer.Render(report, CancellationToken.None);

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var text = Text(pdf);
        Assert.Contains("Tổng số lượng: 0", text);
        Assert.Contains("Không có tài sản trong phạm vi bàn giao (0 mục, số lượng 0)", text);
        Assert.Contains("BÊN GIAO", text);
        Assert.Contains("BÊN NHẬN", text);
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
            StaffDisplayName: "Trần Văn Kiểm Kê",
            AssignmentStart: new DateOnly(2026, 11, 1),
            AssignmentEnd: new DateOnly(2026, 11, 30));
    }
}
