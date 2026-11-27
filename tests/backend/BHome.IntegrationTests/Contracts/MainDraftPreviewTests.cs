using BHome.Application.Contracts;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Unit")]
public sealed class MainDraftPreviewTests
{
    private static byte[] Pdf(int pages = 1, bool rotate = false)
    {
        using var buffer = new MemoryStream();
        using (var document = new PdfDocument(new PdfWriter(buffer)))
            for (var page = 0; page < pages; page++) document.AddNewPage(PageSize.A4).SetRotation(rotate ? 90 : 0);
        return buffer.ToArray();
    }
    [Theory]
    [InlineData("")]
    [InlineData("not-a-pdf")]
    [InlineData("%PDF-malformed")]
    public void RejectsEmptyOrInvalidPdf(string text)
    {
        using var services = ContractPdfRendererTests.Backend();
        var renderer = services.GetRequiredService<IMainDraftPreviewRenderer>();
        Assert.Equal("draft_preview_invalid_pdf", Assert.Throws<ContractException>(() => renderer.Inspect(System.Text.Encoding.ASCII.GetBytes(text))).Code);
    }
    [Fact]
    public async Task ReturnsRealPageDimensionsAndRejectsInvalidPageWithoutStartingConverter()
    {
        using var services = ContractPdfRendererTests.Backend(); var renderer = services.GetRequiredService<IMainDraftPreviewRenderer>();
        var bytes = Pdf(3, true); var pages = renderer.Inspect(bytes);
        Assert.Equal(new[] { 1, 2, 3 }, pages.Select(p => p.Number));
        Assert.All(pages, page => Assert.True(page.Width > page.Height));
        Assert.Equal("draft_preview_page_invalid", (await Assert.ThrowsAsync<ContractException>(() => renderer.PageAsync(bytes, 0, default))).Code);
        Assert.Equal("draft_preview_page_invalid", (await Assert.ThrowsAsync<ContractException>(() => renderer.PageAsync(bytes, 4, default))).Code);
        Assert.Equal("draft_preview_renderer_unavailable", (await Assert.ThrowsAsync<ContractException>(() => renderer.PageAsync(bytes, 1, default))).Code);
    }
    [Fact]
    public void BoundsDocumentPageCountBeforeRasterization()
    {
        using var services = ContractPdfRendererTests.Backend(); var renderer = services.GetRequiredService<IMainDraftPreviewRenderer>();
        Assert.Equal("draft_preview_page_limit", Assert.Throws<ContractException>(() => renderer.Inspect(Pdf(21))).Code);
    }
}
