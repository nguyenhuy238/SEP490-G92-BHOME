using System.Globalization;
using System.Runtime.Versioning;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.DigitalSigning.Application;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using iText.Kernel.Pdf;
using Microsoft.EntityFrameworkCore;
using SkiaSharp;

namespace BHome.Infrastructure.Contracts;

// Where each party's box sits in the signature block ContractPdfRenderer draws, kept in the PDF's document
// information as "page;x;y;width" (fractions of the page from its top-left).
internal sealed record ContractSignatureSlot(int Page, double X, double Y, double Width)
{
    public string Format() => string.Join(';', Page.ToString(CultureInfo.InvariantCulture),
        X.ToString("0.#####", CultureInfo.InvariantCulture), Y.ToString("0.#####", CultureInfo.InvariantCulture),
        Width.ToString("0.#####", CultureInfo.InvariantCulture));
}

internal static class ContractSignatureSlots
{
    public const string Owner = "BHomeSignatureSlotOwner";
    public const string Tenant = "BHomeSignatureSlotTenant";

    public static SignaturePlacementInput? Read(byte[] pdf, bool owner)
    {
        try
        {
            using var document = new PdfDocument(new PdfReader(new MemoryStream(pdf)));
            return Read(document, owner);
        }
        catch (iText.Commons.Exceptions.ITextException) { return null; }
    }

    public static SignaturePlacementInput? Read(PdfDocument document, bool owner)
    {
        var value = document.GetDocumentInfo().GetMoreInfo(owner ? Owner : Tenant);
        var parts = value?.Split(';');
        if (parts is not { Length: 4 } ||
            !int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var page) ||
            !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) ||
            !double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var y) ||
            !double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var width)) return null;
        var placement = new SignaturePlacementInput(page, x, y, width);
        return placement.IsValid && page <= document.GetNumberOfPages() ? placement : null;
    }
}

// The pages of the PDF a signer is about to sign: sizes from iText, pictures from PDFium (PDFtoImage).
internal sealed class ContractSigningPages : IContractSigningPages
{
    public SigningLayoutInfo Inspect(byte[] pdf, bool owner)
    {
        using var document = Open(pdf);
        var pages = Enumerable.Range(1, document.GetNumberOfPages()).Select(n =>
        {
            var page = document.GetPage(n);
            var size = page.GetPageSize();
            return page.GetRotation() is 90 or 270
                ? new SigningPageSize(size.GetHeight(), size.GetWidth())
                : new SigningPageSize(size.GetWidth(), size.GetHeight());
        }).ToArray();
        return new(pages, ContractSignatureSlots.Read(document, owner));
    }

    public byte[] RenderPage(byte[] pdf, int page, int maxWidth)
    {
        int count;
        using (var document = Open(pdf)) count = document.GetNumberOfPages();
        if (page < 1 || page > count) throw ContractException.Invalid("signing_page_invalid");
        if (OperatingSystem.IsWindows() || OperatingSystem.IsLinux()) return Render(pdf, page, maxWidth);
        if (OperatingSystem.IsMacOS()) return Render(pdf, page, maxWidth);
        throw new IntegrationUnavailableException("PDF page rendering");
    }

    [SupportedOSPlatform("windows"), SupportedOSPlatform("linux"), SupportedOSPlatform("macos")]
    private static byte[] Render(byte[] pdf, int page, int maxWidth)
    {
        using var output = new MemoryStream();
        PDFtoImage.Conversion.SavePng(output, pdf, page - 1, null,
            new PDFtoImage.RenderOptions { Width = maxWidth, WithAspectRatio = true, WithAnnotations = true, WithFormFill = true });
        return output.ToArray();
    }

    private static PdfDocument Open(byte[] pdf)
    {
        try { return new PdfDocument(new PdfReader(new MemoryStream(pdf))); }
        catch (iText.Commons.Exceptions.ITextException) { throw ContractException.Invalid("contract_pdf_invalid"); }
    }
}

// One signature picture per signer: the PNG in object storage, its description in users.business_profile.signatureImage.
// Uploading a new picture writes a new object (named after its hash) before the description points at it.
internal sealed class CompactSignatureImageStore(BHomePersistenceContext db, IObjectStorage storage) : ISignatureImageStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Entry(string ObjectKey, int Width, int Height, string Sha256, DateTimeOffset UpdatedAt);

    public async Task<SignatureImage?> FindAsync(Guid ownerUserId, CancellationToken t)
    {
        var entry = await EntryAsync(ownerUserId, t);
        if (entry is null) return null;
        using var buffer = new MemoryStream();
        await storage.CopyToAsync(entry.ObjectKey, buffer, t);
        return new SignatureImage(buffer.ToArray(), entry.Width, entry.Height, entry.Sha256, entry.UpdatedAt);
    }

    public async Task SaveAsync(Guid ownerUserId, SignatureImage image, CancellationToken t)
    {
        Compact24Only();
        var before = await EntryAsync(ownerUserId, t);
        var key = $"signature-images/{ownerUserId:N}/{image.Sha256[..16]}.png";
        using (var content = new MemoryStream(image.Content, writable: false))
            await storage.PutAsync(key, content, image.Content.Length, "image/png", t);
        var entry = JsonSerializer.Serialize(new Entry(key, image.Width, image.Height, image.Sha256, image.UpdatedAt), Json);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE users SET business_profile = jsonb_set(COALESCE(business_profile,'{{}}'::jsonb), '{{signatureImage}}', {entry}::jsonb) WHERE id = {ownerUserId}", t);
        if (changed != 1) throw ContractException.Missing();
        if (before is not null && before.ObjectKey != key) await ForgetAsync(before.ObjectKey);
    }

    public async Task DeleteAsync(Guid ownerUserId, CancellationToken t)
    {
        Compact24Only();
        var before = await EntryAsync(ownerUserId, t);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE users SET business_profile = business_profile - 'signatureImage' WHERE id = {ownerUserId}", t);
        if (before is not null) await ForgetAsync(before.ObjectKey);
    }

    private async Task<Entry?> EntryAsync(Guid userId, CancellationToken t)
    {
        if (db is not Compact24DbContext) return null;
        var json = await db.Database.SqlQuery<string?>(
            $"SELECT (business_profile->'signatureImage')::text AS \"Value\" FROM users WHERE id = {userId}").SingleOrDefaultAsync(t);
        return string.IsNullOrEmpty(json) || json == "null" ? null : JsonSerializer.Deserialize<Entry>(json, Json);
    }

    // users.business_profile exists only in the 24-table database; the legacy schema keeps no picture.
    private void Compact24Only()
    {
        if (db is not Compact24DbContext) throw new IntegrationUnavailableException("signature picture storage (Compact24 database)");
    }

    // The old picture is no longer referenced; a failed delete leaves an orphan object, never a broken reference.
    private async Task ForgetAsync(string key)
    {
        try { await storage.DeleteAsync(key, CancellationToken.None); }
        catch (Exception e) when (e is not OperationCanceledException) { }
    }
}

// The single saved Viettel account, in the Owner's users.business_profile.digitalSigning.viettel. The client secret
// arrives here already encrypted by SigningAccountService.
internal sealed class CompactSigningSettingsStore(BHomePersistenceContext db) : ISigningSettingsStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ViettelSettingsRow?> FindAsync(CancellationToken t)
    {
        if (db is not Compact24DbContext) return null;
        var json = await db.Database.SqlQuery<string?>(
            $"SELECT (business_profile->'digitalSigning'->'viettel')::text AS \"Value\" FROM users WHERE 'Owner' = ANY(roles) ORDER BY id LIMIT 1").SingleOrDefaultAsync(t);
        return string.IsNullOrEmpty(json) || json == "null" ? null : JsonSerializer.Deserialize<ViettelSettingsRow>(json, Json);
    }

    public async Task SaveAsync(ViettelSettingsRow row, CancellationToken t)
    {
        if (db is not Compact24DbContext) throw new IntegrationUnavailableException("signing settings storage (Compact24 database)");
        var value = JsonSerializer.Serialize(row, Json);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE users SET business_profile = jsonb_set(jsonb_set(COALESCE(business_profile,'{{}}'::jsonb), '{{digitalSigning}}', COALESCE(business_profile->'digitalSigning','{{}}'::jsonb)), '{{digitalSigning,viettel}}', {value}::jsonb) WHERE id = (SELECT id FROM users WHERE 'Owner' = ANY(roles) ORDER BY id LIMIT 1)", t);
        if (changed != 1) throw new IntegrationUnavailableException("Owner account for signing settings");
    }
}

// "Tạo từ họ tên": a transparent PNG with the name in a slanted serif (the font the contract uses), so a signer
// without a scanned signature still gets a picture. The result goes through SignatureImageService's checks like an upload.
public sealed class SignaturePictureGenerator
{
    private static readonly Lazy<byte[]> FontBytes = new(() =>
    {
        using var stream = typeof(SignaturePictureGenerator).Assembly.GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new IntegrationUnavailableException("signature font");
        using var copy = new MemoryStream(); stream.CopyTo(copy); return copy.ToArray();
    });

    public byte[] FromName(string name)
    {
        var text = name.Trim();
        if (text.Length is < 2 or > 60 || text.Any(char.IsControl)) throw ContractException.Invalid("signature_name_invalid");
        using var data = SKData.CreateCopy(FontBytes.Value);
        using var typeface = SKTypeface.FromData(data) ?? throw new IntegrationUnavailableException("signature font");
        using var font = new SKFont(typeface, 96) { SkewX = -0.25f, Subpixel = true, Edging = SKFontEdging.Antialias };
        foreach (var c in text.EnumerateRunes())
            if (!System.Text.Rune.IsWhiteSpace(c) && font.GetGlyph(c.Value) == 0) throw ContractException.Invalid("signature_name_invalid");
        var width = (int)Math.Ceiling(font.MeasureText(text)) + 80;
        const int height = 200;
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.Transparent);
            using var ink = new SKPaint { Color = new SKColor(0x0D, 0x2C, 0x8C), IsAntialias = true };
            canvas.DrawText(text, 40, 130, SKTextAlign.Left, font, ink);
            using var line = new SKPaint { Color = new SKColor(0x0D, 0x2C, 0x8C, 0x99), IsAntialias = true, StrokeWidth = 3, IsStroke = true };
            canvas.DrawLine(30, 158, width - 30, 150, line);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        return png.ToArray();
    }

    // A signature drawn with a finger: strokes of [x, y] points on a Width × Height pad. Cropped to the ink, scaled to
    // 200 px high and drawn in the same ink on a transparent background, so it can be saved as the signer's picture.
    public byte[] FromStrokes(DrawnSignatureInput drawing)
    {
        if (drawing.Width is < 100 or > 4000 || drawing.Height is < 60 or > 4000 || drawing.Strokes is null ||
            drawing.Strokes.Length is 0 or > 80 || drawing.Strokes.Sum(s => s?.Length ?? 0) > 8000)
            throw ContractException.Invalid("signature_drawing_invalid");
        var points = new List<SKPoint[]>();
        foreach (var stroke in drawing.Strokes)
        {
            if (stroke is null || stroke.Length == 0) continue;
            var line = new SKPoint[stroke.Length];
            for (var i = 0; i < stroke.Length; i++)
            {
                var p = stroke[i];
                if (p is null || p.Length != 2 || !double.IsFinite(p[0]) || !double.IsFinite(p[1]) ||
                    p[0] < 0 || p[1] < 0 || p[0] > drawing.Width || p[1] > drawing.Height)
                    throw ContractException.Invalid("signature_drawing_invalid");
                line[i] = new SKPoint((float)p[0], (float)p[1]);
            }
            points.Add(line);
        }
        var all = points.SelectMany(p => p).ToArray();
        var left = all.Min(p => p.X); var top = all.Min(p => p.Y);
        var inkWidth = all.Max(p => p.X) - left; var inkHeight = all.Max(p => p.Y) - top;
        // A tap or a dot is not a signature.
        if (all.Length < 5 || Math.Max(inkWidth, inkHeight) < 20) throw ContractException.Invalid("signature_drawing_empty");
        const float pad = 16f, target = 200f;
        var scale = Math.Min(4f, (target - 2 * pad) / Math.Max(inkHeight, 1f));
        var width = (int)Math.Ceiling(Math.Max(inkWidth * scale + 2 * pad, 80));
        var height = (int)target;
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.Transparent);
            using var ink = new SKPaint
            {
                Color = new SKColor(0x0D, 0x2C, 0x8C), IsAntialias = true, IsStroke = true, StrokeWidth = 5,
                StrokeCap = SKStrokeCap.Round, StrokeJoin = SKStrokeJoin.Round
            };
            var top0 = (height - inkHeight * scale) / 2;
            SKPoint Map(SKPoint p) => new(pad + (p.X - left) * scale, top0 + (p.Y - top) * scale);
            foreach (var line in points)
            {
                // Round-capped segments join smoothly; a single point becomes a dot.
                if (line.Length == 1) canvas.DrawLine(Map(line[0]), Map(line[0]) + new SKPoint(0.5f, 0), ink);
                for (var i = 1; i < line.Length; i++) canvas.DrawLine(Map(line[i - 1]), Map(line[i]), ink);
            }
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        return png.ToArray();
    }
}

// Width/Height: the drawing pad in device units; Strokes: one array of [x, y] points per finger stroke.
public sealed record DrawnSignatureInput(int Width, int Height, double[][][]? Strokes);

