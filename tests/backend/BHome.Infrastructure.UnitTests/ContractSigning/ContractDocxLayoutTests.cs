using System.Xml.Linq;
using BHome.Infrastructure.Contracts;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

public sealed class ContractDocxLayoutTests
{
    [Fact]
    public void MultilinePolicyDoesNotStretchWordsAcrossManualLineBreaks()
    {
        XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        var paragraph = new XElement(w + "p", new XElement(w + "pPr", new XElement(w + "jc", new XAttribute(w + "val", "both"))),
            new XElement(w + "r", new XElement(w + "t", "NQ-02 – An toàn điện"), new XElement(w + "br"),
                new XElement(w + "t", "Không tự ý sửa chữa.")));
        var document = new XDocument(new XElement(w + "document", new XElement(w + "body", paragraph)));
        ContractDocxLayout.Apply(document);
        Assert.Equal("left", paragraph.Element(w + "pPr")!.Element(w + "jc")!.Attribute(w + "val")!.Value);
        Assert.Equal("0", paragraph.Element(w + "pPr")!.Element(w + "ind")!.Attribute(w + "firstLine")!.Value);
        Assert.Equal(new[] { "NQ-02 – An toàn điện", "Không tự ý sửa chữa." }, paragraph.Descendants(w + "t").Select(t => t.Value));
        Assert.Single(paragraph.Descendants(w + "br"));
    }
}
