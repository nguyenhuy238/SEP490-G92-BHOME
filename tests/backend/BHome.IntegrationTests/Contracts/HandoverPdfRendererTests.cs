using BHome.Application.Contracts;
using iText.Kernel.Pdf;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Unit")]
public sealed class HandoverPdfRendererTests
{
    [Theory] [InlineData("MoveIn")] [InlineData("MoveOut")] [InlineData("AssetChange")]
    public async Task VietnameseMultiPageReportHasVersionQuantitiesAndNoDigitalSignature(string type)
    {
        using var backend = ContractPdfRendererTests.Backend(); using var scope = backend.CreateScope();
        var reading = new HandoverReading(Guid.NewGuid(), "E-SYN", 0, new(2026, 11, 16), 124, Guid.NewGuid(), "private", "hash");
        var assets = Enumerable.Range(1, 60).Select(i => new HandoverAsset(Guid.NewGuid(), $"Nhóm ghế {i}", "Tốt", "Đã kiểm tra: Nguyễn Ánh, Đặng Thị Hồng",
            ConfiguredQuantity: 4, Unit: "cái", ObservedQuantity: 3, HandedOverQuantity: 3, GoodQuantity: 2, WornQuantity: 1, DamagedQuantity: 0, MissingQuantity: 1)).ToArray();
        var snapshot = new HandoverSnapshot(new(2026, 11, 16), "S101", "Tường, sàn, cửa đã kiểm tra", "Hai chìa khóa", "Ghi chú tổng hợp", assets, reading, reading with { UtilityType = 1 }, [],
            MissingBaselineReason: type == "MoveOut" ? "Hợp đồng cũ không có baseline" : null, OtherTenantsRemain: type == "MoveOut");
        var report = new HandoverDocumentReport(Guid.NewGuid(), Guid.NewGuid(), type, 3, "Cơ sở thử nghiệm", "Địa chỉ tổng hợp", Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow, snapshot, null, [], ["Owner chấp thuận ngoại lệ có bằng chứng"], []);
        var bytes = await scope.ServiceProvider.GetRequiredService<IHandoverDocumentRenderer>().RenderAsync(report, default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        Assert.True(pdf.GetNumberOfPages() > 2); Assert.Equal("3", pdf.GetDocumentInfo().GetMoreInfo("BHomeVersion"));
        var text = ContractPdfRendererTests.Text(pdf);
        Assert.Contains("Nguyễn Ánh, Đặng Thị Hồng", text); Assert.Contains("Nhóm ghế 60", text); Assert.Contains("Trang 1/", text);
        Assert.Contains("không phải chữ ký số", text); Assert.Empty(new iText.Signatures.SignatureUtil(pdf).GetSignatureNames());
        if (type == "MoveOut") { Assert.Contains("GIỚI HẠN", text); Assert.Contains("Tài sản chung", text); }
    }
}
