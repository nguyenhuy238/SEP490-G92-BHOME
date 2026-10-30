using System.Globalization;
using System.Text;
using BHome.Application.Ocr;

namespace BHome.Application.UnitTests.Ocr;

public sealed class OcrParserTests
{
    [Fact]
    public void FrontFieldsOnOneRowDoNotSwallowAnotherLabel()
    {
        var result = Parse(OcrDocumentKind.IdentityFront,
            "Giới tính / Sex: Nữ   Quốc tịch / Nationality: Việt Nam",
            "Ngày sinh: 01/02/2000   Có giá trị đến: 01/02/2040");
        Assert.Equal("Nữ", result.ProposedFields["gender"]);
        Assert.Equal("Việt Nam", result.ProposedFields["nationality"]);
        Assert.Equal("2000-02-01", result.ProposedFields["dateOfBirth"]);
        Assert.Equal("2040-02-01", result.ProposedFields["dateOfExpiry"]);
    }

    [Theory]
    [InlineData(OcrDocumentKind.IdentityFront)]
    [InlineData(OcrDocumentKind.IdentityBack)]
    public void IdentityAddressUsesContinuationRowsAndStopsAtTheNextField(OcrDocumentKind kind)
    {
        OcrLine[] lines = [
            new("Nơi cư trú / Place of residence:", .96f) { Bounds = new(30, 100, 300, 20) },
            new("THÔN GIẢ LẬP", .94f) { Bounds = new(30, 130, 150, 20) },
            new("XÃ KIỂM THỬ, TỈNH MÔ PHỎNG", .91f) { Bounds = new(30, 160, 290, 20) },
            new("Ngày cấp: 01/02/2024", .99f) { Bounds = new(30, 200, 280, 20) }
        ];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), kind);
        Assert.Equal("THÔN GIẢ LẬP XÃ KIỂM THỬ, TỈNH MÔ PHỎNG", result.ProposedFields["residentialAddress"]);
        Assert.Equal(.91f, result.Confidence["residentialAddress"]);
        Assert.Equal("2024-02-01", result.ProposedFields["dateOfIssue"]);
    }

    [Fact]
    public void IdentityLabelsDoNotBorrowValuesFromAnUnrelatedColumn()
    {
        OcrLine[] lines = [new("Họ và tên:", .99f) { Bounds = new(20, 30, 180, 20) },
            new("VIỆT NAM", .99f) { Bounds = new(650, 30, 150, 20) },
            new("NGƯỜI KIỂM THỬ", .97f) { Bounds = new(20, 60, 250, 20) }];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.IdentityFront);
        Assert.Equal("NGƯỜI KIỂM THỬ", result.ProposedFields["fullName"]);
    }

    [Fact]
    public void BackAddressDoesNotAppendMrzOrFingerprintBoilerplate()
    {
        OcrLine[] lines = [new("Nơi cư trú: ĐỊA CHỈ GIẢ LẬP", .99f) { Bounds = new(20, 20, 300, 20) },
            new("IDVNM000000000000<<<<<<<<<<<<", .99f) { Bounds = new(20, 50, 300, 20) }];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.IdentityBack);
        Assert.Equal("ĐỊA CHỈ GIẢ LẬP", result.ProposedFields["residentialAddress"]);
    }

    [Theory]
    [InlineData(OcrDocumentKind.MechanicalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.DigitalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.MechanicalWater, "m³")]
    [InlineData(OcrDocumentKind.DigitalWater, "m^3")]
    public void UnitsJustBelowTheDisplayAreAssociatedByCoordinates(OcrDocumentKind kind, string unit)
    {
        OcrLine[] lines = [new("00123.45", .97f) { Bounds = new(30, 20, 180, 40) },
            new(unit, .94f) { Bounds = new(170, 70, 40, 20) },
            new("2026", .99f) { Bounds = new(30, 220, 80, 20) }, new("S/N: 987654321", .99f)];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), kind);
        Assert.Equal("00123.45", result.ProposedFields["reading"]);
        Assert.Equal(.94f, result.Confidence["reading"]);
    }

    [Theory]
    [InlineData(OcrDocumentKind.MechanicalElectricity, "kWh 00123.45")]
    [InlineData(OcrDocumentKind.DigitalElectricity, "Chỉ số điện: 00123.45 kWh")]
    [InlineData(OcrDocumentKind.MechanicalWater, "㎥ 00123.45")]
    [InlineData(OcrDocumentKind.DigitalWater, "Chỉ số nước: 00123.45 m^3")]
    public void PrefixUnitsAndUtilityReadingLabelsKeepTheObservedQuantity(OcrDocumentKind kind, string line)
        => Assert.Equal("00123.45", Parse(kind, line, "S/N: 987654321").ProposedFields["reading"]);

    [Theory]
    [InlineData(OcrDocumentKind.MechanicalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.MechanicalWater, "m³")]
    public void MechanicalWheelChunksWithASeparateDecimalAreCombined(OcrDocumentKind kind, string unit)
    {
        OcrLine[] lines = [new("001", .96f) { Bounds = new(20, 40, 45, 30) },
            new("23", .94f) { Bounds = new(69, 40, 30, 30) },
            new(".", .95f) { Bounds = new(103, 62, 4, 5) },
            new("45", .92f) { Bounds = new(111, 40, 30, 30) },
            new(unit, .96f) { Bounds = new(150, 40, 40, 30) }];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), kind);
        Assert.Equal("00123.45", result.ProposedFields["reading"]);
    }

    [Theory]
    [InlineData("123.45 m3/h")]
    [InlineData("123.45 L/min")]
    public void WaterFlowRateIsNotTotalConsumption(string input)
        => Assert.Empty(Parse(OcrDocumentKind.DigitalWater, input).ProposedFields);

    [Fact]
    public void TwoSeparateReadoutsCannotBeJoinedWithoutDecimalEvidence()
    {
        OcrLine[] lines = [new("123", .99f) { Bounds = new(20, 30, 50, 30) },
            new("456", .99f) { Bounds = new(75, 30, 50, 30) },
            new("m3", .99f) { Bounds = new(135, 30, 35, 30) }];
        var proposal = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.MechanicalWater);
        Assert.Empty(proposal.ProposedFields);
        Assert.Contains("ambiguous_reading", proposal.Warnings);
    }

    [Fact]
    public void AddressWithoutAValueCannotBorrowMrzAndNameCannotBorrowAnUnlabelledDate()
    {
        var address = Parse(OcrDocumentKind.IdentityBack, "Nơi cư trú:", "IDVNM000000000000<<<<<<<<<<<<");
        Assert.False(address.ProposedFields.ContainsKey("residentialAddress"));
        var name = Parse(OcrDocumentKind.IdentityFront, "Họ và tên:", "01/02/2000");
        Assert.False(name.ProposedFields.ContainsKey("fullName"));
        Assert.Contains("invalid_fullName", name.Warnings);
    }

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

    [Theory]
    [InlineData("Ngày, tháng, năm / Date, month, year: 1/2/2020")]
    [InlineData("Ngay cap: 01-02-2020")]
    [InlineData("Ngày cấp", "/ Date of issue", "01.02.2020")]
    public void BackIssueDateSupportsPrintedAndSplitBilingualLabels(params string[] lines)
    {
        var result = Parse(OcrDocumentKind.IdentityBack, lines);
        Assert.Equal("2020-02-01", result.ProposedFields["dateOfIssue"]);
        Assert.DoesNotContain("unsupported_or_unreadable_layout", result.Warnings);
        Assert.True(result.RequiresConfirmation);
    }

    [Fact]
    public void BackIssuePlaceIsReadOnlyFromAnExplicitLabel()
    {
        var result = Parse(OcrDocumentKind.IdentityBack, "Nơi cấp / Place of issue:", "CƠ QUAN GIẢ LẬP");
        Assert.Equal("CƠ QUAN GIẢ LẬP", result.ProposedFields["placeOfIssue"]);
        Assert.Empty(Parse(OcrDocumentKind.IdentityBack, "01/02/2020", "CƠ QUAN GIẢ LẬP").ProposedFields);
    }

    [Theory]
    [InlineData(OcrDocumentKind.MechanicalElectricity, "00123.45 kWh")]
    [InlineData(OcrDocumentKind.DigitalElectricity, "00123,45kWh")]
    [InlineData(OcrDocumentKind.MechanicalWater, "00123.45 m³")]
    [InlineData(OcrDocumentKind.DigitalWater, "00123,45m3")]
    public void MeterReadingIsSeparatedFromSerialAndTechnicalNumbers(OcrDocumentKind kind, string reading)
    {
        var result = Parse(kind, "S/N: 987654321", "2026", "220 V 50 Hz", "5(80) A", reading);
        Assert.Equal("00123.45", result.ProposedFields["reading"]);
        Assert.True(result.RequiresConfirmation);
    }

    [Theory]
    [InlineData("S/N: 987654321")]
    [InlineData("220 V")]
    [InlineData("50 Hz")]
    [InlineData("5(80) A")]
    [InlineData("No. 12345678")]
    [InlineData("1.8.0")]
    [InlineData("123 m³")]
    public void TechnicalNumbersAndWrongUtilityAreNeverReadings(string line)
        => Assert.Empty(Parse(OcrDocumentKind.DigitalElectricity, line).ProposedFields);

    [Fact]
    public void MultipleUnitLabelledDisplaysRemainAmbiguous()
    {
        var result = Parse(OcrDocumentKind.DigitalElectricity, "123.45 kWh", "456.78 kWh");
        Assert.Empty(result.ProposedFields);
        Assert.Contains("ambiguous_reading", result.Warnings);
    }

    [Fact]
    public void ConflictingIssueDatesCannotBeRestoredByARepeatedThirdLabel()
    {
        var result = Parse(OcrDocumentKind.IdentityBack, "Ngày cấp: 01/02/2020", "Date of issue: 02/02/2020",
            "Ngày cấp: 01/02/2020");
        Assert.False(result.ProposedFields.ContainsKey("dateOfIssue"));
        Assert.Contains("conflicting_dateOfIssue", result.Warnings);
    }

    [Fact]
    public void UnreadableDisplayCannotTurnTheManufactureYearIntoAReading()
    {
        var result = Parse(OcrDocumentKind.MechanicalElectricity, "00123.45KWE", "2026");
        Assert.Empty(result.ProposedFields);
        Assert.Contains("ambiguous_reading", result.Warnings);
    }

    [Theory]
    [InlineData(OcrDocumentKind.MechanicalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.DigitalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.MechanicalWater, "m³")]
    [InlineData(OcrDocumentKind.DigitalWater, "m3")]
    public void SeparatelyDetectedDigitWheelsAndUnitUseImageCoordinates(OcrDocumentKind kind, string unit)
    {
        var lines = "00123.45".Select((c, i) => new OcrLine(c.ToString(), .95f)
        { Bounds = c == '.' ? new(20 + i * 16, 66, 4, 4) : new(20 + i * 16, 50, 12, 20) }).ToList();
        lines.Add(new(unit, .9f) { Bounds = new(155, 50, 30, 20) });
        lines.Add(new("2026", .99f) { Bounds = new(20, 120, 50, 20) });
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), kind);
        Assert.Equal("00123.45", result.ProposedFields["reading"]);
        Assert.Equal(.9f, result.Confidence["reading"]);
    }

    [Fact]
    public void UnitInAnotherRowDoesNotDisambiguateNumericLabels()
    {
        OcrLine[] lines = [new("123", .99f) { Bounds = new(20, 10, 50, 20) },
            new("456", .99f) { Bounds = new(20, 90, 50, 20) },
            new("kWh", .99f) { Bounds = new(80, 150, 40, 20) }];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", []), OcrDocumentKind.DigitalElectricity);
        Assert.Empty(result.ProposedFields);
        Assert.Contains("ambiguous_reading", result.Warnings);
    }

    [Theory]
    [InlineData("Ngày cấp / Date of issue: 01/07/2024", "2024-07-01")]
    [InlineData("Ngày, tháng, năm / Date, month, year: 01/02/2021", "2021-02-01")]
    public void BothCardGenerationsUseObservedIssueDates(string line, string expected)
        => Assert.Equal(expected, Parse(OcrDocumentKind.IdentityBack, line).ProposedFields["dateOfIssue"]);

    [Fact]
    public void IssueDateCannotBorrowExpiryFromTheNextField()
    {
        var result = Parse(OcrDocumentKind.IdentityBack, "Ngày cấp", "Có giá trị đến: 01/02/2040");
        Assert.False(result.ProposedFields.ContainsKey("dateOfIssue"));
        Assert.Equal("2040-02-01", result.ProposedFields["dateOfExpiry"]);
    }

    [Fact]
    public void LayoutWarningsAndMinimumConfidenceArePreserved()
    {
        OcrLine[] lines = [new("00123.45", .95f) { Bounds = new(20, 50, 100, 25) },
            new("kWh", .65f) { Bounds = new(125, 50, 40, 25) }, new("S/N: 12345678", .99f)];
        var result = OcrFieldParser.Parse(new(lines, "synthetic", ["possible_glare"]), OcrDocumentKind.DigitalElectricity);
        Assert.Equal("00123.45", result.ProposedFields["reading"]);
        Assert.Equal(.65f, result.Confidence["reading"]);
        Assert.Contains("low_confidence", result.Warnings);
        Assert.Contains("possible_glare", result.Warnings);
    }

    [Fact]
    public void NumericOverflowAndIncorrectDateRemainManualFallback()
    {
        Assert.Empty(Parse(OcrDocumentKind.MechanicalWater, "99999999999999999999999999999999999999 m3").ProposedFields);
        var result = Parse(OcrDocumentKind.IdentityBack, "Ngày, tháng, năm: 31/02/2021");
        Assert.Empty(result.ProposedFields);
        Assert.Contains("invalid_dateOfIssue", result.Warnings);
    }
}
