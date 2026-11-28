using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;
using iText.Kernel.Pdf.Canvas.Parser.Data;
using iText.Kernel.Pdf.Canvas.Parser.Listener;
using iText.Kernel.Geom;
using iText.Kernel.Pdf.Canvas;
using iText.Kernel.Font;
using iText.IO.Font.Constants;
using System.Text;

namespace BHome.Infrastructure.Contracts;

// The supplied DOCX places Tenant (B) on the left and Owner (A) on the right.
internal static class MainTemplateSignatureSlots
{
    internal const string SourceTemplate = "BHomeSourceTemplate";
    internal const string TemplateId = "main-tenancy-docx-v1";
    private sealed record Fragment(string Text, float X, float Right, float Y);
    private sealed class Listener : IEventListener
    {
        internal List<Fragment> Text { get; } = [];
        public void EventOccurred(IEventData data, EventType type)
        {
            if (data is TextRenderInfo text)
            {
                var line = text.GetBaseline();
                Text.Add(new(text.GetText(), line.GetStartPoint().Get(Vector.I1), line.GetEndPoint().Get(Vector.I1), line.GetStartPoint().Get(Vector.I2)));
            }
        }
        public ICollection<EventType> GetSupportedEvents() => new HashSet<EventType> { EventType.RENDER_TEXT };
    }
    internal static byte[] Add(byte[] source, string templateId = TemplateId, bool ownerOnLeft = false,
        string ownerHeading = "ĐẠI DIỆN BÊN A", string tenantHeading = "ĐẠI DIỆN BÊN B")
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(source)), new PdfWriter(output)))
        {
            var found = new HashSet<string>();
            var pageNumberFont = PdfFontFactory.CreateFont(StandardFonts.TIMES_ROMAN);
            for (var page = 1; page <= pdf.GetNumberOfPages(); page++)
            {
                var size = pdf.GetPage(page).GetPageSize(); var listener = new Listener();
                new PdfCanvasProcessor(listener).ProcessPageContent(pdf.GetPage(page));
                foreach (var (owner, key) in new[] { (true, ContractSignatureSlots.Owner), (false, ContractSignatureSlots.Tenant) })
                {
                    var lines = listener.Text.Where(f => (owner == ownerOnLeft) == (f.X < size.GetWidth() / 2))
                        .GroupBy(f => Math.Round(f.Y)).Select(g => new { Text = string.Concat(g.OrderBy(f => f.X).Select(f => f.Text)).Normalize(NormalizationForm.FormC).Replace(" ", ""), Parts = g.ToArray() });
                    var heading = (owner ? ownerHeading : tenantHeading).Replace(" ", "");
                    var title = lines.FirstOrDefault(l => l.Text.Contains(heading, StringComparison.Ordinal));
                    if (title is null) continue;
                    var center = (title.Parts.Min(f => f.X) + title.Parts.Max(f => f.Right)) / 2;
                    var width = size.GetWidth() * .32f;
                    var x = Math.Clamp(center - width / 2, 20, size.GetWidth() - width - 20);
                    var slot = new ContractSignatureSlot(page, x / size.GetWidth(), (size.GetHeight() - title.Parts.Average(f => f.Y) + 14) / size.GetHeight(), width / size.GetWidth());
                    pdf.GetDocumentInfo().SetMoreInfo(key, slot.Format()); found.Add(key);
                }
                var number = page.ToString(System.Globalization.CultureInfo.InvariantCulture);
                var canvas = new PdfCanvas(pdf.GetPage(page));
                canvas.BeginText().SetFontAndSize(pageNumberFont, 10)
                    .MoveText((size.GetWidth() - pageNumberFont.GetWidth(number, 10)) / 2, 28)
                    .ShowText(number).EndText();
            }
            if (found.Count != 2) throw new BHome.Application.Contracts.ContractException(503, "contract_template_slots_changed");
            pdf.GetDocumentInfo().SetMoreInfo(SourceTemplate, templateId);
        }
        return output.ToArray();
    }
}
