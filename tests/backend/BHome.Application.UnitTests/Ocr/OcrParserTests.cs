using System.Globalization;
using System.Text;
using BHome.Application.Ocr;

namespace BHome.Application.UnitTests.Ocr;

public sealed class OcrParserTests
{
    private static OcrProposal Parse(OcrDocumentKind kind, params string[] lines)
        => OcrFieldParser.Parse(new OcrText(lines.Select(x => new OcrLine(x, .96f)).ToArray(), "synthetic", []), kind);

    [Fact]
    public void VietnameseFieldsAndValidDatesAreProposalsRequiringConfirmation()
    {
        var result = Parse(OcrDocumentKind.IdentityFront, "Số: 000000000000",
            "Họ và tên / Full name: NGƯỜI KIỂM THỬ".Normalize(NormalizationForm.FormD),
            "Ngày sinh / Date of birth: 29/02/2000", "Nơi thường trú: ĐỊA CHỈ GIẢ LẬP");
        Assert.Equal("NGƯỜI KIỂM THỬ", result.ProposedFields["fullName"]);
        Assert.Equal("2000-02-29", result.ProposedFields["dateOfBirth"]);
        Assert.Equal("ĐỊA CHỈ GIẢ LẬP", result.ProposedFields["residentialAddress"]);
        Assert.Empty(result.MissingFields);
        Assert.True(result.RequiresConfirmation);
        Assert.True(result.ManualEntryAvailable);
        Assert.DoesNotContain("000000000000", result.ToString());
    }

    [Fact]
    public void MissingConflictingAndInvalidFieldsAreNotInvented()
    {
        var result = Parse(OcrDocumentKind.IdentityFront, "000000000000", "111111111111",
            "Ngày sinh: 31/02/2000", "Họ và tên:", "Quốc tịch:");
        Assert.Empty(result.ProposedFields);
        Assert.Contains("conflicting_identity_numbers", result.Warnings);
        Assert.Contains("invalid_dateOfBirth", result.Warnings);
        Assert.Contains("fullName", result.MissingFields);
        Assert.True(result.IsFallback);
    }

    [Theory]
    [InlineData("00123,45", "00123.45")]
    [InlineData("00123.45", "00123.45")]
    [InlineData("000045", "000045")]
    public void MeterParsingPreservesPrecisionWithoutCultureDependence(string input, string expected)
    {
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("vi-VN");
            foreach (var kind in Enum.GetValues<OcrDocumentKind>().Skip(2))
                Assert.Equal(expected, Parse(kind, input).ProposedFields["reading"]);
        }
        finally { CultureInfo.CurrentCulture = before; }
    }

    [Theory]
    [InlineData("12.345,67")]
    [InlineData("1,234,567")]
    [InlineData("SN12345")]
    [InlineData("O123")]
    [InlineData("-123")]
    [InlineData("12 34")]
    public void AmbiguousMeterStringsDoNotBecomeAuthoritativeNumbers(string input)
        => Assert.Empty(Parse(OcrDocumentKind.DigitalElectricity, input).ProposedFields);

    [Fact]
    public void MultipleDisplaysAndSerialNumbersRequireManualSelection()
    {
        var result = Parse(OcrDocumentKind.MechanicalWater, "123.45", "2026");
        Assert.Empty(result.ProposedFields);
        Assert.Contains("ambiguous_reading", result.Warnings);
    }
}
