using BHome.Application.StaffOperations;
using BHome.Infrastructure.StaffOperations;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;

namespace BHome.Infrastructure.UnitTests;

public sealed class LocationAssetHandoverNewLayoutPdfTests
{
    private static readonly DateTimeOffset ApprovedAt = new(2026, 11, 27, 10, 0, 0, TimeSpan.Zero);

    private static LocationAssetReportPdf Report()
    {
        var items = new LocationAssetReportItem[]
        {
            new(Guid.NewGuid(), "Phòng 101", "Giường đơn", 2, false, null, null, null)
            { Condition = "Intact", Unit = "cái" },
            new(Guid.NewGuid(), "Phòng 101", "Tủ quần áo", 1, false, null, Guid.NewGuid(), "Hỏng bản lề")
            { Condition = "Damaged", Unit = "cái" },
            new(Guid.NewGuid(), "Phòng 102", "Điều hòa", 1, true, Guid.NewGuid(), null, null)
            { Condition = "Intact", Unit = "cái" },
            new(Guid.NewGuid(), "Phòng 103", "Ghế", 3, false, null, null, "Thiếu một ghế", Guid.NewGuid(), Guid.NewGuid())
            { Condition = "Missing", Unit = "cái" },
            new(Guid.NewGuid(), "Phòng 104", "Không có tài sản", 0, false, null, null, null),
            new(Guid.NewGuid(), "Sân", "Camera", 1, false, null, null, null)
            { Condition = "NotAccessible", Unit = "cái", IsCommonArea = true }
        };
        return new(Guid.NewGuid(), Guid.NewGuid(), 1, "Cơ sở mẫu", "Địa chỉ mẫu",
            Guid.NewGuid(), Guid.NewGuid(), ApprovedAt, new string('A', 64),
            "Kiểm tra lại camera và sửa bản lề.", items,
            OwnerDisplayName: "Nguyễn Văn A", StaffDisplayName: "Trần Văn B",
            AssignmentStart: new(2026, 11, 1), AssignmentEnd: new(2027, 11, 1));
    }

    private static string Text(PdfDocument pdf) => string.Join("\n",
        Enumerable.Range(1, pdf.GetNumberOfPages()).Select(page => PdfTextExtractor.GetTextFromPage(pdf.GetPage(page))));

    [Fact]
    public void NewLayoutRetainsBusinessFactsAndMetadataWithoutVisibleTechnicalIdentifiers()
    {
        var report = Report();
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(
            LocationAssetHandoverPdfRenderer.Render(report, default))));
        var text = Text(pdf);
        foreach (var expected in new[] { "THÔNG TIN CÁC BÊN", "NỘI DUNG BÀN GIAO", "DANH MỤC TÀI SẢN BÀN GIAO",
            "TỒN TẠI VÀ HƯỚNG XỬ LÝ", "TRÁCH NHIỆM VÀ XÁC NHẬN", "Nguyễn Văn A", "Trần Văn B",
            "Hiện trạng", "Ghi chú", "Hỏng bản lề", "Thiếu một ghế", "Theo biên bản bàn giao phòng",
            "Kế thừa kết quả kiểm kê trước", "Không thể kiểm tra", "Không có tài sản",
            "Kiểm tra lại camera và sửa bản lề.", "Chờ ký xác nhận" })
            Assert.Contains(expected, text);
        foreach (var absent in new[] { "THÔNG TIN TRUY VẾT KỸ THUẬT", "PAdES", "phiên đăng nhập BHOME",
            "Biên bản đã chốt không được sửa trực tiếp", report.TaskId.ToString(), report.AssignmentId.ToString(),
            report.OwnerId.ToString(), report.StaffId.ToString(), report.SnapshotHash })
            Assert.DoesNotContain(absent, text);
        Assert.Equal(report.TaskId.ToString(), pdf.GetDocumentInfo().GetMoreInfo("BHomeInventoryTaskId"));
        Assert.Equal(report.SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeInventorySnapshotSHA256"));
        Assert.Equal("1", pdf.GetDocumentInfo().GetMoreInfo("BHomeInventoryRevision"));
    }

    [Fact]
    public void SigningStagesKeepLayoutAndShowCompletionOnlyWhenBothHaveSigned()
    {
        var report = Report();
        var owner = new LocationAssetHandoverAcceptance(report.OwnerId, ApprovedAt.AddMinutes(5),
            "AuthenticatedSessionHandwritten", report.SnapshotHash);
        var staff = new LocationAssetHandoverAcceptance(report.StaffId, ApprovedAt.AddMinutes(10),
            "AuthenticatedSessionHandwritten", report.SnapshotHash);
        using var ownerPdf = new PdfDocument(new PdfReader(new MemoryStream(
            LocationAssetHandoverPdfRenderer.Render(report with { OwnerSignature = owner }, default))));
        var ownerText = Text(ownerPdf);
        Assert.Contains("Ngày ký: 27/11/2026 17:05", ownerText);
        Assert.Contains("Chờ ký xác nhận", ownerText);
        Assert.DoesNotContain("Hoàn tất bàn giao:", ownerText);
        using var signedPdf = new PdfDocument(new PdfReader(new MemoryStream(
            LocationAssetHandoverPdfRenderer.Render(report with { OwnerSignature = owner, StaffSignature = staff }, default))));
        var signedText = Text(signedPdf);
        Assert.Contains("Hoàn tất bàn giao: 27/11/2026 17:10", signedText);
        Assert.Contains("Ngày ký: 27/11/2026 17:10", signedText);
        Assert.DoesNotContain("Chờ ký xác nhận", signedText);
        Assert.DoesNotContain("THÔNG TIN TRUY VẾT KỸ THUẬT", signedText);
    }

    [Fact]
    public void LegacyLayoutRemainsAvailableForAlreadyApprovedRevisions()
    {
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(
            LocationAssetHandoverPdfRenderer.Render(Report() with { LayoutVersion = 1 }, default))));
        Assert.Contains("THÔNG TIN TRUY VẾT KỸ THUẬT", Text(pdf));
        Assert.Contains("PAdES", Text(pdf));
    }
}
