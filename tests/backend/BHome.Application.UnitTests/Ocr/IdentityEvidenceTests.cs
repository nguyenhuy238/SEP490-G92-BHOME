using BHome.Application.Ocr;

namespace BHome.Application.UnitTests.Ocr;

public sealed class IdentityEvidenceTests
{
    private const string Qr = "000000001234||NGƯỜI THỬ NGHIỆM|12032001|Nam|Xã Giả Lập, Tỉnh Thử|14062023";

    [Fact]
    public void QrIsOnlyAnObservationAndDoesNotInventNationalityOriginOrExpiry()
    {
        var observations = IdentityOcrEvidence.ParseQr(Qr);
        Assert.Equal(6, observations.Count);
        var result = OcrFieldParser.Parse(new([], "synthetic", []) { IdentityObservations = observations }, OcrDocumentKind.IdentityFront);
        Assert.Equal("NGƯỜI THỬ NGHIỆM", result.ProposedFields["fullName"]);
        Assert.Equal("2001-03-12", result.ProposedFields["dateOfBirth"]);
        Assert.Equal("2023-06-14", result.ProposedFields["dateOfIssue"]);
        Assert.DoesNotContain("nationality", result.ProposedFields.Keys);
        Assert.DoesNotContain("placeOfOrigin", result.ProposedFields.Keys);
        Assert.DoesNotContain("dateOfExpiry", result.ProposedFields.Keys);
        Assert.True(result.RequiresConfirmation);
        Assert.DoesNotContain("NGƯỜI", observations[0].ToString());
    }

    [Theory]
    [InlineData("https://example.invalid/identity")]
    [InlineData("000000001234||TEST|31022001|Nam|Test address|14062023")]
    [InlineData("000000001234||TEST|12032001|Nam|Test address|14062023|extra")]
    public void UnsupportedOrInvalidQrNeverSuppliesFields(string payload) => Assert.Empty(IdentityOcrEvidence.ParseQr(payload));

    [Fact]
    public void RetryDisagreementPreservesFirstValueAndCannotBeHiddenByALaterAgreement()
    {
        var text = new OcrText([new("Họ và tên: NGƯỜI THỬ", .97f)], "synthetic", [])
        {
            IdentityObservations = [new("fullName", "NGƯỜI THỪ", .999f, "region"), new("fullName", "NGƯỜI THỬ", .999f, "qr")]
        };
        var result = OcrFieldParser.Parse(text, OcrDocumentKind.IdentityFront);
        Assert.Equal("NGƯỜI THỬ", result.ProposedFields["fullName"]);
        Assert.Equal(.5f, result.Confidence["fullName"]);
        Assert.Contains("conflicting_fullName", result.Warnings);
    }

    [Fact]
    public void AContradictoryQrCannotFillOtherMissingFieldsFromADifferentIdentity()
    {
        var text = new OcrText([new("Số / No.: 000000005678", .99f)], "synthetic", [])
        { IdentityObservations = IdentityOcrEvidence.ParseQr(Qr) };
        var result = OcrFieldParser.Parse(text, OcrDocumentKind.IdentityFront);
        Assert.Equal("000000005678", result.ProposedFields["citizenIdentityNumber"]);
        Assert.DoesNotContain("fullName", result.ProposedFields.Keys);
        Assert.DoesNotContain("dateOfBirth", result.ProposedFields.Keys);
        Assert.Contains("conflicting_citizenIdentityNumber", result.Warnings);
        Assert.Equal(.5f, result.Confidence["citizenIdentityNumber"]);
    }

    [Fact]
    public void UncheckedMrzNumbersCannotBeTreatedAsAnIdentityNumber()
    {
        var result = OcrFieldParser.Parse(new([new("IDVNM000000001234<<<<<<<<<<<<", .99f)], "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.DoesNotContain("citizenIdentityNumber", result.ProposedFields.Keys);
    }

    [Fact]
    public void MrzNeedsAllChecksAndNeverGuessesTheCenturyOrAccentedName()
    {
        var upper = "IDVNM000000001";
        upper += Digit(upper[5..]) + new string('<', 15);
        var middle = "010312" + Digit("010312") + "M310312" + Digit("310312") + "VNM" + new string('<', 11);
        middle += Digit(upper[5..] + middle[..7] + middle.Substring(8, 7) + middle.Substring(18, 11));
        var lower = "SYNTHETIC<<TEST".PadRight(30, '<');
        OcrLine[] lines = [new(upper, .99f), new(middle, .99f), new(lower, .99f)];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.Contains("mrz_checked", result.Warnings);
        Assert.Equal("Nam", result.ProposedFields["gender"]);
        Assert.DoesNotContain("dateOfBirth", result.ProposedFields.Keys);
        Assert.DoesNotContain("fullName", result.ProposedFields.Keys);
        Assert.DoesNotContain("citizenIdentityNumber", result.ProposedFields.Keys);
        lines[1] = lines[1] with { Text = middle[..29] + (middle[29] == '0' ? '1' : '0') };
        result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.Contains("mrz_unreadable", result.Warnings);
        Assert.Empty(result.ProposedFields);
    }

    [Theory]
    [InlineData('0', "1901-03-12", "Nam", 'M')]
    [InlineData('2', "2001-03-12", "Nam", 'M')]
    [InlineData('3', "2001-03-12", "Nữ", 'F')]
    public void ChipMrzCenturyMustBeEncodedInADuplicatedAndCheckedCitizenNumber(char code, string birth, string gender, char sex)
    {
        var identity = "000" + code + "01001234";
        var document = identity[3..];
        var upper = "IDVNM" + document + Digit(document) + identity + "<<" + Digit(identity);
        var middle = "010312" + Digit("010312") + sex + "310312" + Digit("310312") + "VNM" + new string('<', 11);
        middle += Digit(upper[5..] + middle[..7] + middle.Substring(8, 7) + middle.Substring(18, 11));
        OcrLine[] lines = [new(upper, .99f), new(middle, .99f), new("NGUOI<<THU".PadRight(30, '<'), .99f)];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.Equal(identity, result.ProposedFields["citizenIdentityNumber"]);
        Assert.Equal(birth, result.ProposedFields["dateOfBirth"]);
        Assert.Equal(gender, result.ProposedFields["gender"]);
        Assert.Equal("NGUOI THU", result.ProposedFields["fullName"]);
        Assert.Equal(.65f, result.Confidence["fullName"]);
        Assert.Contains("mrz_name_unaccented", result.Warnings);
        var conflict = OcrFieldParser.Parse(new([new("Số / No.: 000000005678", .99f), .. lines], "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.DoesNotContain("dateOfBirth", conflict.ProposedFields.Keys);
        Assert.DoesNotContain("fullName", conflict.ProposedFields.Keys);
        Assert.Contains("conflicting_citizenIdentityNumber", conflict.Warnings);
        Assert.DoesNotContain("dateOfExpiry", result.ProposedFields.Keys);
        // A valid composite does not replace the independent full-ID check.
        upper = upper[..29] + (upper[29] == '0' ? '1' : '0');
        middle = middle[..29] + Digit(upper[5..] + middle[..7] + middle.Substring(8, 7) + middle.Substring(18, 11));
        lines[0] = lines[0] with { Text = upper }; lines[1] = lines[1] with { Text = middle };
        result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.DoesNotContain("citizenIdentityNumber", result.ProposedFields.Keys);
        Assert.DoesNotContain("dateOfBirth", result.ProposedFields.Keys);
    }

    private static char Digit(string text)
    {
        int[] weights = [7, 3, 1];
        return (char)('0' + text.Select((c, index) => (c == '<' ? 0 : c is >= 'A' and <= 'Z' ? c - 'A' + 10 : c - '0') * weights[index % 3]).Sum() % 10);
    }
}
