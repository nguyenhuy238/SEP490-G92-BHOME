using BHome.Application.Contracts;
using iText.IO.Image;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas;
using iText.Layout;
using iText.Layout.Element;
using SkiaSharp;

namespace BHome.Infrastructure.Contracts;

internal sealed class InternalAcceptanceRenderer : IInternalAcceptanceRenderer
{
    public InternalAcceptedDocument Accept(byte[] source, DrawnPoint[][] strokes, Guid residentId, DateTimeOffset acceptedAt, string sourceHash, bool preserveSignatures = false)
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
        return new(png, Append(source, $"Resident: {residentId:D}", acceptedAt, sourceHash, png, preserveSignatures));
    }
    public byte[] ConfirmOwner(byte[] tenantAcceptedPdf, Guid ownerId, DateTimeOffset acceptedAt, string sourceHash) =>
        Append(tenantAcceptedPdf, $"Owner confirmation: {ownerId:D}", acceptedAt, sourceHash, null);
    public byte[] AppendTenant(byte[] ownerSignedPdf, byte[] signaturePng, Guid residentId, DateTimeOffset acceptedAt, string sourceHash) =>
        Append(ownerSignedPdf, $"Resident: {residentId:D}", acceptedAt, sourceHash, signaturePng, preserveSignatures: true);
    private static byte[] Append(byte[] source, string party, DateTimeOffset at, string hash, byte[]? image, bool preserveSignatures = false)
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(source)), new PdfWriter(output),
            preserveSignatures ? new StampingProperties().UseAppendMode() : new StampingProperties()))
        {
            var placed = false;
            if (image is not null && ContractSignatureSlots.Read(pdf, owner: false) is { } slot)
            {
                var target = pdf.GetPage(slot.Page);
                var size = target.GetPageSize();
                var data = ImageDataFactory.Create(image);
                var top = (float)((1 - slot.Y) * size.GetHeight());
                var height = Math.Min(top, Math.Min((float)slot.Width * size.GetWidth() * data.GetHeight() / data.GetWidth(), 105));
                if (target.GetRotation() == 0 && height > 0)
                {
                    var width = height * data.GetWidth() / data.GetHeight();
                    var box = new Rectangle(size.GetLeft() + (float)slot.X * size.GetWidth(),
                        size.GetBottom() + top - height, width, height);
                    var signature = new PdfCanvas(target.NewContentStreamAfter(), target.GetResources(), pdf);
                    signature.SaveState().AddImageFittedIntoRectangle(data, box, false);
                    signature.RestoreState();
                    placed = true;
                }
            }
            var page = pdf.AddNewPage(PageSize.A4);
            using var canvas = new Canvas(page, new Rectangle(40, 40, 515, 750));
            canvas.Add(new Paragraph("BHOME - INTERNAL ELECTRONIC ACCEPTANCE").SetFontSize(16));
            canvas.Add(new Paragraph("Mode: INTERNAL_OTP_DRAWN. Not a CA digital signature."));
            canvas.Add(new Paragraph(party));
            canvas.Add(new Paragraph($"Accepted (UTC): {at:O}"));
            canvas.Add(new Paragraph($"Reviewed source SHA-256: {hash}").SetFontSize(9));
            canvas.Add(new Paragraph("Consent: internal-acceptance-v1. The reviewed contract terms are preserved."));
            if (image is not null && !placed) canvas.Add(new Image(ImageDataFactory.Create(image)).ScaleToFit(460, 160));
        }
        return output.ToArray();
    }
}
