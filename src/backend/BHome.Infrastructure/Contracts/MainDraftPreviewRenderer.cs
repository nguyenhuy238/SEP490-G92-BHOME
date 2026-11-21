using BHome.Application.Contracts;
using iText.Kernel.Pdf;
using Microsoft.Extensions.Configuration;

namespace BHome.Infrastructure.Contracts;

internal sealed class MainDraftPreviewRenderer(IConfiguration configuration) : IMainDraftPreviewRenderer
{
    public IReadOnlyList<DraftPreviewPage> Inspect(byte[] pdf)
    {
        if (pdf.Length is < 5 or > 10_485_760 || !pdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) throw ContractException.Invalid("draft_preview_invalid_pdf");
        try
        {
            using var document = new PdfDocument(new PdfReader(new MemoryStream(pdf)));
            var count = document.GetNumberOfPages();
            if (count is < 1 or > 20) throw ContractException.Invalid("draft_preview_page_limit");
            return Enumerable.Range(1, count).Select(number =>
            {
                var box = document.GetPage(number).GetPageSizeWithRotation();
                if (box.GetWidth() <= 0 || box.GetHeight() <= 0) throw ContractException.Invalid("draft_preview_invalid_pdf");
                return new DraftPreviewPage(number, box.GetWidth(), box.GetHeight());
            }).ToArray();
        }
        catch (Exception error) when (error is iText.Kernel.Exceptions.PdfException or IOException or ArgumentException)
        { throw ContractException.Invalid("draft_preview_invalid_pdf"); }
    }
    public async Task<byte[]> PageAsync(byte[] pdf, int page, CancellationToken token)
    {
        if (page < 1 || page > Inspect(pdf).Count) throw ContractException.Invalid("draft_preview_page_invalid");
        var bytes = await PrivateContractConversion.RunAsync(configuration, pdf, "draft.pdf", "page.png",
            configuration["MainDraft:PdfToPpmPath"], "pdftoppm",
            ["-f", page.ToString(System.Globalization.CultureInfo.InvariantCulture), "-l", page.ToString(System.Globalization.CultureInfo.InvariantCulture), "-singlefile", "-scale-to", "1800", "-png", "{work}/draft.pdf", "{work}/page"], token);
        if (bytes.Length < 8 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
            throw new ContractException(503, "draft_preview_render_failed");
        return bytes;
    }
}
