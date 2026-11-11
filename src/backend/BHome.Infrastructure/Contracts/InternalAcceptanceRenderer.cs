using BHome.Application.Contracts;
using iText.IO.Image;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using SkiaSharp;

namespace BHome.Infrastructure.Contracts;

internal sealed class InternalAcceptanceRenderer : IInternalAcceptanceRenderer
{
    public InternalAcceptedDocument Accept(byte[] source, DrawnPoint[][] strokes, Guid residentId, DateTimeOffset acceptedAt, string sourceHash)
    {
        using var bitmap = new SKBitmap(900, 300);
        using (var canvas = new SKCanvas(bitmap))
        using (var paint = new SKPaint { Color = SKColors.Black, IsAntialias = true, StrokeWidth = 3, Style = SKPaintStyle.Stroke, StrokeCap = SKStrokeCap.Round })
        {
            canvas.Clear(SKColors.White);
            foreach (var stroke in strokes)
            {
                for (var n = 1; n < stroke.Length; n++)
                    canvas.DrawLine((float)stroke[n - 1].X * 880 + 10, (float)stroke[n - 1].Y * 280 + 10,
                        (float)stroke[n].X * 880 + 10, (float)stroke[n].Y * 280 + 10, paint);
            }
        }
        using var image = SKImage.FromBitmap(bitmap); using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        var png = encoded.ToArray();
        return new(png, Append(source, $"Resident: {residentId:D}", acceptedAt, sourceHash, png));
    }
    public byte[] ConfirmOwner(byte[] tenantAcceptedPdf, Guid ownerId, DateTimeOffset acceptedAt, string sourceHash) =>
        Append(tenantAcceptedPdf, $"Owner confirmation: {ownerId:D}", acceptedAt, sourceHash, null);
    private static byte[] Append(byte[] source, string party, DateTimeOffset at, string hash, byte[]? image)
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(source)), new PdfWriter(output)))
        {
            var page = pdf.AddNewPage(PageSize.A4);
            using var canvas = new Canvas(page, new Rectangle(40, 40, 515, 750));
            canvas.Add(new Paragraph("BHOME - INTERNAL ELECTRONIC ACCEPTANCE").SetFontSize(16));
            canvas.Add(new Paragraph("Mode: INTERNAL_OTP_DRAWN. Not a CA digital signature."));
            canvas.Add(new Paragraph(party));
            canvas.Add(new Paragraph($"Accepted (UTC): {at:O}"));
            canvas.Add(new Paragraph($"Reviewed source SHA-256: {hash}").SetFontSize(9));
            canvas.Add(new Paragraph("Consent: internal-acceptance-v1. Original reviewed pages are retained unchanged."));
            if (image is not null) canvas.Add(new Image(ImageDataFactory.Create(image)).ScaleToFit(460, 160));
        }
        return output.ToArray();
    }
}
