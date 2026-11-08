using System.Globalization;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using iText.IO.Font;
using iText.Kernel.Font;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using iText.Layout.Properties;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractPdfRenderer(IOptions<ContractPdfOptions> options, IHostEnvironment? environment = null)
    : IContractDocumentRenderer
{
    internal const string DevelopmentTemplateId = "main-contract-development-v1";
    private static readonly Lazy<Template> DevelopmentTemplate = new(LoadDevelopmentTemplate);
    private static readonly Lazy<byte[]> FontBytes = new(LoadFont);
    private static readonly CultureInfo Vietnamese = CultureInfo.GetCultureInfo("vi-VN");

    public Task<ContractTemplateView> ConfigurationAsync(CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        var template = DevelopmentTemplate.Value;
        string? blocker = null;
        try { _ = ResolveTemplate(); }
        catch (ContractException error) { blocker = error.Code; }
        return Task.FromResult(new ContractTemplateView(template.Id, template.Version, template.Title, template.Notice,
            blocker is null, true, blocker, template.Fields.Select(f => f.Label).ToArray()));
    }

    public Task ValidateAsync(ContractDocument document, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        _ = ResolveTemplate();
        _ = Snapshot(document);
        return Task.CompletedTask;
    }

    public Task<byte[]> RenderAsync(ContractDocument document, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        var template = ResolveTemplate();
        var snapshot = Snapshot(document);
        var amendment = snapshot.IsOperatingPolicyAmendment;
        var title = amendment ? "PHỤ LỤC NỘI QUY HỢP ĐỒNG" : template.Title;
        var values = Values(snapshot);
        // PdfFont belongs to one PDF document. Only the immutable font bytes are shared between requests.
        var font = PdfFontFactory.CreateFont(FontBytes.Value, PdfEncodings.IDENTITY_H,
            PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
        EnsureGlyphs(font, values.Values.Append(template.Title).Append(template.Notice).Concat(template.Fields.Select(f => f.Label)));

        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var layout = new Document(pdf, PageSize.A4))
        {
            var info = pdf.GetDocumentInfo().SetTitle(title).SetCreator("BHOME");
            info.SetMoreInfo("BHomeContractId", snapshot.ContractId.ToString());
            info.SetMoreInfo("BHomeSnapshotHash", snapshot.SnapshotHash);
            info.SetMoreInfo("BHomeTemplateId", template.Id);
            info.SetMoreInfo("BHomeTemplateVersion", template.Version.ToString(CultureInfo.InvariantCulture));
            layout.SetFont(font).SetFontSize(11);
            layout.Add(new Paragraph(title).SetFontSize(16));
            layout.Add(new Paragraph(template.Notice).SetFontSize(10));
            layout.Add(new Paragraph($"Template: {template.Id} / v{template.Version}"));
            var table = new Table(UnitValue.CreatePercentArray([35f, 65f])).UseAllAvailableWidth();
            foreach (var field in template.Fields.Where(f => f.Key != nameof(ContractDocument.Terms) &&
                (!amendment || f.Key is not (nameof(ContractDocument.MonthlyRent) or nameof(ContractDocument.RequiredDeposit) or nameof(ContractDocument.AppliedHoldingDeposit) or nameof(ContractDocument.HoldingContractId)))))
            {
                t.ThrowIfCancellationRequested();
                table.AddCell(new Cell().Add(new Paragraph(field.Label)));
                table.AddCell(new Cell().Add(new Paragraph(values[field.Key]).SetFontSize(10)));
            }
            layout.Add(table);
            layout.Add(new Paragraph(template.Fields.Single(f => f.Key == nameof(ContractDocument.Terms)).Label));
            // Plain text, never HTML. Preserve the stored terms; no legal clauses or client PDF are substituted.
            layout.Add(new Paragraph(snapshot.Terms));
            AddSignatureBlock(pdf, layout, info);
        }
        t.ThrowIfCancellationRequested();
        var bytes = output.ToArray();
        if (bytes.Length > 10 * 1024 * 1024) throw ContractException.Invalid("contract_pdf_invalid");
        return Task.FromResult(bytes);
    }

    // "Đại diện bên A / bên B" with an empty box under each heading, drawn at fixed positions after the terms, so the
    // place each party's visible signature goes is known exactly. The boxes are recorded in the document information
    // (ContractSignatureSlots) and survive the incremental updates the two signatures add.
    private const float Margin = 36f, Gap = 20f, BlockHeight = 190f, HeadingHeight = 34f, BoxHeight = 135f;
    private static void AddSignatureBlock(PdfDocument pdf, Document layout, PdfDocumentInfo info)
    {
        var area = layout.GetRenderer().GetCurrentArea();
        var page = area.GetPageNumber();
        var top = area.GetBBox().GetTop();
        if (area.GetBBox().GetHeight() < BlockHeight + 10)
        {
            pdf.AddNewPage(PageSize.A4);
            page = pdf.GetNumberOfPages();
            top = PageSize.A4.GetHeight() - Margin;
        }
        var size = pdf.GetPage(page).GetPageSize();
        var column = (size.GetWidth() - 2 * Margin - Gap) / 2;
        var headingBottom = top - 10 - HeadingHeight;
        var boxTop = headingBottom - 4;
        foreach (var (party, title, left) in new[]
                 {
                     (ContractSignatureSlots.Owner, "ĐẠI DIỆN BÊN A (CHỦ NHÀ)", Margin),
                     (ContractSignatureSlots.Tenant, "ĐẠI DIỆN BÊN B (NGƯỜI THUÊ)", Margin + column + Gap)
                 })
        {
            layout.Add(new Paragraph(title + "\nKý số từ xa qua Viettel MySign").SetFontSize(10)
                .SetTextAlignment(TextAlignment.CENTER).SetFixedPosition(page, left, headingBottom, column));
            var box = new iText.Kernel.Pdf.Canvas.PdfCanvas(pdf.GetPage(page));
            box.SaveState().SetLineWidth(0.5f).SetStrokeColorGray(0.75f).SetLineDash(3, 3)
                .Rectangle(left, boxTop - BoxHeight, column, BoxHeight).Stroke().RestoreState();
            var slot = new ContractSignatureSlot(page, (left + column * 0.05f) / size.GetWidth(),
                (size.GetHeight() - boxTop + 4) / size.GetHeight(), column * 0.9f / size.GetWidth());
            info.SetMoreInfo(party, slot.Format());
        }
    }

    private Template ResolveTemplate()
    {
        var id = options.Value.TemplateId;
        if (string.IsNullOrEmpty(id)) throw new ContractException(503, "contract_template_not_configured");
        if (id != DevelopmentTemplateId) throw new ContractException(503, "contract_template_not_found");
        // No approved production template has been supplied. Configuration cannot approve the sample.
        if (environment is null || !(environment.IsDevelopment() || environment.IsEnvironment("Testing")))
            throw new ContractException(503, "contract_template_not_approved");
        return DevelopmentTemplate.Value;
    }

    private static ContractDocument Snapshot(ContractDocument document)
    {
        if (document is null || document.ResidentIds is null) throw ContractException.Invalid("invalid_contract_document");
        // Freeze the only mutable member before validating, hashing and rendering the same values.
        var snapshot = document with { ResidentIds = document.ResidentIds.ToArray() };
        static bool Money(decimal value) => value >= 0 && value < 1_000_000_000_000_000_000m && decimal.Truncate(value) == value;
        if (snapshot.ContractId == Guid.Empty || snapshot.RoomId == Guid.Empty || snapshot.OwnerSignerId == Guid.Empty ||
            snapshot.TenantUserId == Guid.Empty || snapshot.OwnerSignerId == snapshot.TenantUserId ||
            snapshot.RepresentativeResidentId == Guid.Empty || snapshot.ResidentIds.Length is < 1 or > 50 ||
            snapshot.ResidentIds.Contains(Guid.Empty) || snapshot.ResidentIds.Distinct().Count() != snapshot.ResidentIds.Length ||
            !snapshot.ResidentIds.Contains(snapshot.RepresentativeResidentId) || snapshot.StartDate == default || snapshot.EndDate <= snapshot.StartDate ||
            !Money(snapshot.MonthlyRent) || snapshot.MonthlyRent == 0 || !Money(snapshot.RequiredDeposit) ||
            !Money(snapshot.AppliedHoldingDeposit) || snapshot.AppliedHoldingDeposit > snapshot.RequiredDeposit ||
            snapshot.HoldingContractId == Guid.Empty || snapshot.HoldingContractId is null && snapshot.AppliedHoldingDeposit != 0 ||
            string.IsNullOrWhiteSpace(snapshot.Terms) || snapshot.Terms.Length > 12000 || string.IsNullOrWhiteSpace(snapshot.SnapshotHash))
            throw ContractException.Invalid("invalid_contract_document");
        if (snapshot.SnapshotHash != ContractDocumentSnapshot.Hash(snapshot)) throw ContractException.Conflict("signed_terms_changed");
        return snapshot;
    }

    private static Dictionary<string, string> Values(ContractDocument snapshot) => new()
    {
        [nameof(snapshot.ContractId)] = snapshot.ContractId.ToString(),
        [nameof(snapshot.SnapshotHash)] = snapshot.SnapshotHash,
        [nameof(snapshot.RoomId)] = snapshot.RoomId.ToString(),
        [nameof(snapshot.OwnerSignerId)] = snapshot.OwnerSignerId.ToString(),
        [nameof(snapshot.TenantUserId)] = snapshot.TenantUserId.ToString(),
        [nameof(snapshot.RepresentativeResidentId)] = snapshot.RepresentativeResidentId.ToString(),
        [nameof(snapshot.ResidentIds)] = string.Join('\n', snapshot.ResidentIds.Select(id => id.ToString())),
        [nameof(snapshot.StartDate)] = snapshot.StartDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
        [nameof(snapshot.EndDate)] = snapshot.EndDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
        [nameof(snapshot.MonthlyRent)] = snapshot.MonthlyRent.ToString("#,0", Vietnamese) + " VND",
        [nameof(snapshot.RequiredDeposit)] = snapshot.RequiredDeposit.ToString("#,0", Vietnamese) + " VND",
        [nameof(snapshot.HoldingContractId)] = snapshot.HoldingContractId?.ToString() ?? "Không áp dụng",
        [nameof(snapshot.AppliedHoldingDeposit)] = snapshot.AppliedHoldingDeposit.ToString("#,0", Vietnamese) + " VND",
        [nameof(snapshot.Terms)] = snapshot.Terms
    };

    private static void EnsureGlyphs(PdfFont font, IEnumerable<string> values)
    {
        foreach (var rune in values.SelectMany(value => value.EnumerateRunes()))
            if (!Rune.IsWhiteSpace(rune) && !font.ContainsGlyph(rune.Value))
                throw ContractException.Invalid("contract_document_unsupported_character");
    }

    private static Template LoadDevelopmentTemplate()
    {
        using var stream = typeof(ContractPdfRenderer).Assembly.GetManifestResourceStream($"BHome.Contracts.{DevelopmentTemplateId}.json")
            ?? throw new ContractException(503, "contract_template_not_found");
        Template? template;
        try { template = JsonSerializer.Deserialize<Template>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
        catch (JsonException) { throw new ContractException(503, "contract_template_invalid"); }
        var keys = typeof(ContractDocument).GetProperties().Where(p => !Attribute.IsDefined(p, typeof(System.Text.Json.Serialization.JsonIgnoreAttribute))).Select(p => p.Name).Order(StringComparer.Ordinal);
        if (template is null || template.Id != DevelopmentTemplateId || template.Version != 1 ||
            string.IsNullOrWhiteSpace(template.Title) || string.IsNullOrWhiteSpace(template.Notice) || template.Fields is null ||
            template.Fields.Any(f => f is null || string.IsNullOrWhiteSpace(f.Label)) ||
            !template.Fields.Select(f => f.Key).Order(StringComparer.Ordinal).SequenceEqual(keys))
            throw new ContractException(503, "contract_template_invalid");
        return template;
    }

    private static byte[] LoadFont()
    {
        using var stream = typeof(ContractPdfRenderer).Assembly.GetManifestResourceStream("BHome.Contracts.Tinos-Regular.ttf")
            ?? throw new ContractException(503, "contract_pdf_font_not_available");
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    private sealed record Template(string Id, int Version, string Title, string Notice, Field[] Fields);
    private sealed record Field(string Key, string Label);
}
