using System.Xml.Linq;

namespace BHome.Infrastructure.Contracts;

// Apply presentation after the template's legal text and data slots have been resolved.
internal static class ContractDocxLayout
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private const string Font = "Times New Roman";
    private static XElement Element(string name, string value) => new(W + name, new XAttribute(W + "val", value));

    internal static void Apply(XDocument document)
    {
        foreach (var section in document.Descendants(W + "sectPr"))
        {
            section.Element(W + "pgSz")?.ReplaceWith(new XElement(W + "pgSz",
                new XAttribute(W + "w", "11906"), new XAttribute(W + "h", "16838")));
            section.Element(W + "pgMar")?.ReplaceWith(new XElement(W + "pgMar",
                new XAttribute(W + "top", "1134"), new XAttribute(W + "right", "1134"),
                new XAttribute(W + "bottom", "1134"), new XAttribute(W + "left", "1701"),
                new XAttribute(W + "header", "567"), new XAttribute(W + "footer", "567"), new XAttribute(W + "gutter", "0")));
            section.Elements(W + "docGrid").Remove();
        }

        foreach (var paragraph in document.Descendants(W + "p").ToArray())
        {
            var text = string.Concat(paragraph.Descendants(W + "t").Select(node => node.Value)).Trim();
            var inTable = paragraph.Ancestors(W + "tc").Any();
            var signature = inTable && (text.StartsWith("ĐẠI DIỆN BÊN ", StringComparison.Ordinal) ||
                text.StartsWith("BÊN NHẬN TIỀN ĐẶT CỌC", StringComparison.Ordinal) ||
                text.StartsWith("BÊN GIAO TIỀN ĐẶT CỌC", StringComparison.Ordinal));
            if (!inTable && string.IsNullOrWhiteSpace(text) &&
                !paragraph.Descendants().Any(e => e.Name == W + "sectPr" || e.Name == W + "drawing" || e.Name == W + "object" || e.Name == W + "fldChar" || e.Name == W + "br" || e.Name == W + "bookmarkStart"))
            {
                paragraph.Remove();
                continue;
            }

            var national = text.StartsWith("CỘNG H", StringComparison.Ordinal);
            var motto = text.StartsWith("Độc lập", StringComparison.OrdinalIgnoreCase);
            var title = text is "HỢP ĐỒNG THUÊ PHÒNG TRỌ" or "HỢP ĐỒNG NHẬN TIỀN ĐẶT CỌC";
            var centered = national || motto || title || text.StartsWith("---oOo---", StringComparison.Ordinal)
                || text.StartsWith("( Về việc:", StringComparison.Ordinal) || text.StartsWith("BẢN NHÁP – ", StringComparison.Ordinal) || signature;
            var heading = text.StartsWith("Điều ", StringComparison.OrdinalIgnoreCase) || text is "TRÁCH NHIỆM CỦA CÁC BÊN" or "TRÁCH NHIỆM CHUNG"
                || text.StartsWith("1.Đại diện", StringComparison.Ordinal) || text.StartsWith("2. Bên thuê", StringComparison.Ordinal)
                || text.StartsWith("BÊN A :", StringComparison.Ordinal) || text.StartsWith("BÊN B :", StringComparison.Ordinal)
                || text.StartsWith("* Trách nhiệm", StringComparison.Ordinal) || text.StartsWith("3.1 Cam kết", StringComparison.Ordinal)
                || text.StartsWith("3.2 Cam kết", StringComparison.Ordinal);
            var bold = national || motto || title || heading || signature;
            var old = paragraph.Element(W + "pPr");
            var properties = old ?? new XElement(W + "pPr");
            if (old is null) paragraph.AddFirst(properties);
            var numbered = properties.Element(W + "numPr") is not null;
            var field = new[] { "Ông/bà:", "CCCD số:", "Địa chỉ thường trú:", "Điện thoại:", "Số điện thoại:", "Nơi đăng ký",
                "(Sau đây gọi", "Hôm nay ngày", "Hợp đồng lập ngày", "Ngày lập hợp đồng:", "- Căn cứ" }
                .Any(prefix => text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            var list = text.StartsWith("- ", StringComparison.Ordinal) || text.StartsWith("* ", StringComparison.Ordinal) ||
                System.Text.RegularExpressions.Regex.IsMatch(text, @"^\d+\.\d+\s|^[a-z]\)\s");
            if ((centered && !signature) || heading) Set(properties, new XElement(W + "keepNext"));
            else properties.Elements(W + "keepNext").Remove();
            Set(properties, new XElement(W + "widowControl"));
            Set(properties, new XElement(W + "spacing", new XAttribute(W + "before", title ? "180" : heading ? "120" : "0"),
                new XAttribute(W + "after", "120"), new XAttribute(W + "line", "312"), new XAttribute(W + "lineRule", "auto")));
            if (!numbered && !inTable)
                Set(properties, list && !field
                    ? new XElement(W + "ind", new XAttribute(W + "left", "567"), new XAttribute(W + "hanging", "283"))
                    : new XElement(W + "ind", new XAttribute(W + "firstLine", centered || heading || field ? "0" : "567")));
            if (!inTable || signature)
                Set(properties, Element("jc", centered ? "center" : heading || field ? "left" : "both"));
            // Keep numbering, styles, borders, section breaks and run emphasis intact.
            var paragraphRun = properties.Element(W + "rPr") ?? new XElement(W + "rPr");
            Set(properties, paragraphRun);
            FormatRun(paragraphRun, bold, title, signature);

            foreach (var run in paragraph.Descendants(W + "r"))
            {
                var existing = run.Element(W + "rPr");
                var format = existing ?? new XElement(W + "rPr");
                if (existing is null) run.AddFirst(format);
                FormatRun(format, bold, title, signature);
            }
        }
    }

    private static void FormatRun(XElement properties, bool bold, bool title, bool signature)
    {
        Set(properties, new XElement(W + "rFonts", new XAttribute(W + "ascii", Font), new XAttribute(W + "hAnsi", Font),
            new XAttribute(W + "eastAsia", Font), new XAttribute(W + "cs", Font)));
        if (bold) { Set(properties, Element("b", "1")); Set(properties, Element("bCs", "1")); }
        Set(properties, Element("color", "000000"));
        Set(properties, Element("sz", title ? "32" : signature ? "22" : "26"));
        Set(properties, Element("szCs", title ? "32" : signature ? "22" : "26"));
    }

    private static void Set(XElement parent, XElement value)
    {
        var previous = parent.Element(value.Name);
        if (ReferenceEquals(previous, value)) return;
        if (previous is not null) previous.ReplaceWith(value);
        else
        {
            // Insert in WordprocessingML schema order, retaining unrelated properties.
            var order = parent.Name == W + "pPr"
                ? "pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange"
                : "rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange";
            var names = order.Split(' ');
            var rank = Array.IndexOf(names, value.Name.LocalName);
            var next = rank < 0 ? null : parent.Elements().FirstOrDefault(e => Array.IndexOf(names, e.Name.LocalName) > rank);
            if (next is null) parent.Add(value); else next.AddBeforeSelf(value);
        }
    }

    // A single unsplittable row keeps both signers and their blank signing area together.
    internal static XElement SignatureTable(string left, string right)
    {
        XElement Cell(string title) => new(W + "tc",
            new XElement(W + "tcPr", new XElement(W + "tcW", new XAttribute(W + "w", "4535"), new XAttribute(W + "type", "dxa"))),
            new XElement(W + "p", new XElement(W + "r", new XElement(W + "t", title))));
        return new XElement(W + "tbl",
            new XElement(W + "tblPr", new XElement(W + "tblW", new XAttribute(W + "w", "9070"), new XAttribute(W + "type", "dxa")),
                Element("jc", "center"), new XElement(W + "tblLayout", new XAttribute(W + "type", "fixed"))),
            new XElement(W + "tblGrid", new XElement(W + "gridCol", new XAttribute(W + "w", "4535")), new XElement(W + "gridCol", new XAttribute(W + "w", "4535"))),
            new XElement(W + "tr", new XElement(W + "trPr", new XElement(W + "cantSplit"),
                new XElement(W + "trHeight", new XAttribute(W + "val", "2800"), new XAttribute(W + "hRule", "atLeast"))),
                Cell(left), Cell(right)));
    }
}
