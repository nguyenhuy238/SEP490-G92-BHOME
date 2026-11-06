using BHome.Application.Ocr;

namespace BHome.Application.UnitTests.Ocr;

public sealed class AutomaticOcrTests
{
    [Theory]
    [InlineData("CÔNG TƠ ĐIỆN TỬ 1 PHA 2 DÂY", "00123 kWh", "electricity_digital")]
    [InlineData("DIGITAL WATER METER", "00123 m3", "water_digital")]
    [InlineData("MECHANICAL WATER METER", "00123 m3", "water_mechanical")]
    [InlineData("MECHANICAL ELECTRICITY METER", "00123 kWh", "electricity_mechanical")]
    public void ExplicitDeviceLabelsResolveTechnologyAsTextEvidenceWithoutFakeConfidence(string label, string reading, string category)
    {
        var result = Route(Text(label, reading));
        Assert.Equal(category, result.DetectedCategory); Assert.Null(result.ClassificationConfidence);
        Assert.Equal("text_rules", result.ClassificationSource); Assert.True(result.MeterProposal!.RequiresConfirmation);
    }
    [Fact]
    public void ConflictingTechnologyLabelsAndUnitsRemainAmbiguous()
    {
        Assert.Equal("ambiguous", Route(Text("DIGITAL WATER METER", "MECHANICAL WATER METER", "00123 m3")).ClassificationStatus);
        Assert.Equal("ambiguous", Route(Text("DIGITAL WATER METER", "00123 m3", "00123 kWh")).ClassificationStatus);
        Assert.Equal("unknown", Route(Text("DIGITAL WATER METER")).ClassificationStatus);
        Assert.Equal("ambiguous", Route(Text("DIGITAL WATER METER", "00123 kWh")).ClassificationStatus);
    }
    [Theory]
    [InlineData("00123.45 m3", "water", 2)]
    [InlineData("00123.45 kWh", "electricity", 2)]
    [InlineData("unlabeled meter", "meter", 4)]
    public void LocalizedReadingRemainsProvisionalWithoutInventingTechnology(string page, string partial, int candidates)
    {
        var result = AutomaticOcrRouter.Route(new(Text(page), MeterRegion: new(Text("00123.45"), .96f, "data:image/jpeg;base64,AA==")), .9f);
        Assert.Equal("ambiguous", result.ClassificationStatus); Assert.Equal("unknown", result.DetectedCategory);
        Assert.Null(result.ClassificationConfidence); Assert.Equal(.96f, result.DetectionConfidence);
        Assert.Equal(partial, result.PartialCategory); Assert.Equal(candidates, result.CandidateCategories.Count);
        Assert.Equal("00123.45", result.MeterProposal!.ProposedFields["reading"]);
        Assert.Contains("decimal_separator_unverified", result.MeterProposal.Warnings);
        Assert.True(result.RequiresReview); Assert.True(result.MeterProposal.RequiresConfirmation);
        Assert.DoesNotContain("base64", result.ToString());
    }

    [Theory]
    [InlineData("unclear_digit")]
    [InlineData("text_region_limit")]
    [InlineData("conflicting_reading")]
    [InlineData("blur_or_low_detail")]
    [InlineData("orientation_uncertain")]
    public void UnsafeLocalizedEvidenceCannotProposeReading(string warning)
    {
        var region = Text("00123.45") with { Warnings = [warning] };
        var result = AutomaticOcrRouter.Route(new(Text(), MeterRegion: new(region, .96f)), .9f);
        Assert.Empty(result.MeterProposal!.ProposedFields); Assert.True(result.MeterProposal.IsFallback);
    }

    [Fact]
    public void LocalizedMultipleNumbersCannotChooseOneAndIdentityEvidenceKeepsItsRoute()
    {
        var result = AutomaticOcrRouter.Route(new(Text(), MeterRegion: new(Text("00123", "00456"), .96f)), .9f);
        Assert.Empty(result.MeterProposal!.ProposedFields);
        result = AutomaticOcrRouter.Route(new(Front(), MeterRegion: new(Text("00123"), .96f)), .9f);
        Assert.NotNull(result.IdentityProposal); Assert.Null(result.MeterProposal);
    }
    internal static OcrText Text(params string[] lines) => new(lines.Select(t => new OcrLine(t, .98f)).ToArray(), "synthetic", []);
    private static OcrText Front() => Text("CĂN CƯỚC CÔNG DÂN", "Số: 000000000000", "Họ và tên: NGƯỜI KIỂM THỬ", "Ngày sinh: 01/02/2000");
    private static AutomaticOcrResult Route(OcrText text, OcrCategoryDecision? visual = null) => AutomaticOcrRouter.Route(new(text, visual), .9f);

    [Fact]
    public void FrontIsIdentifiedFromStrongTextEvidenceWithoutFakeClassificationProbability()
    {
        var result = Route(Front());
        Assert.Equal("classified", result.ClassificationStatus);
        Assert.Equal("cccd_front", result.DetectedCategory);
        Assert.Equal("text_rules", result.ClassificationSource);
        Assert.Null(result.ClassificationConfidence);
        Assert.NotNull(result.IdentityProposal);
        Assert.Equal("NGƯỜI KIỂM THỬ", result.IdentityProposal.ProposedFields["fullName"]);
        Assert.Null(result.MeterProposal);
        Assert.DoesNotContain("000000000000", result.ToString());
    }

    [Fact]
    public void BackRequiresIssueAndIndependentSideSpecificEvidence()
    {
        Assert.Equal("unknown", Route(Text("Ngày cấp: 01/02/2024")).ClassificationStatus);
        var result = Route(Text("Ngày cấp: 01/02/2024", "Nơi cấp: CƠ QUAN GIẢ LẬP"));
        Assert.Equal("cccd_back", result.DetectedCategory);
        Assert.Equal("2024-02-01", result.IdentityProposal!.ProposedFields["dateOfIssue"]);
    }

    [Theory]
    [InlineData("00123.45 kWh", "electricity_mechanical", "electricity_digital")]
    [InlineData("00123.45 m³", "water_mechanical", "water_digital")]
    public void MeterUnitCannotDetermineDisplayTechnology(string text, string first, string second)
    {
        var result = Route(Text(text));
        Assert.Equal("ambiguous", result.ClassificationStatus);
        Assert.Equal(new[] { first, second }, result.CandidateCategories);
        Assert.Equal(first.StartsWith("water", StringComparison.Ordinal) ? "water" : "electricity", result.PartialCategory);
        Assert.Null(result.MeterProposal);
        Assert.Null(result.IdentityProposal);
    }

    [Fact]
    public void FrontBackAndMixedObjectsCannotBeRoutedArbitrarily()
    {
        var mixed = Front() with { Lines = [.. Front().Lines, new("Ngày cấp: 01/02/2024", .98f), new("Nơi cấp: CƠ QUAN GIẢ LẬP", .98f)] };
        Assert.Equal("ambiguous", Route(mixed).ClassificationStatus);
        Assert.Null(Route(mixed).IdentityProposal);
        mixed = Front() with { Lines = [.. Front().Lines, new("00123.45 kWh", .98f)] };
        Assert.Equal("ambiguous", Route(mixed).ClassificationStatus);
    }

    [Theory]
    [InlineData("blur_or_low_detail")]
    [InlineData("text_region_limit")]
    [InlineData("orientation_uncertain")]
    public void PoorOrIncompleteEvidenceDoesNotIdentifyASide(string warning)
        => Assert.Equal("unknown", Route(Front() with { Warnings = [warning] }).ClassificationStatus);

    [Fact]
    public void LowConfidenceAndUnknownTextDoNotProduceFields()
    {
        Assert.Equal("unknown", Route(Front() with { Lines = Front().Lines.Select(l => l with { Confidence = .5f }).ToArray() }).ClassificationStatus);
        Assert.Equal("unknown", Route(Text("12345", "220 V 50 Hz", "1600 imp/kWh")).ClassificationStatus);
        Assert.Equal("unknown", Route(Text()).ClassificationStatus);
    }

    [Theory]
    [InlineData(OcrDocumentKind.IdentityFront)]
    [InlineData(OcrDocumentKind.IdentityBack)]
    [InlineData(OcrDocumentKind.MechanicalElectricity)]
    [InlineData(OcrDocumentKind.DigitalElectricity)]
    [InlineData(OcrDocumentKind.MechanicalWater)]
    [InlineData(OcrDocumentKind.DigitalWater)]
    public void VerifiedAdapterDecisionRoutesToTheExistingParserForEachKind(OcrDocumentKind kind)
    {
        // Deterministic routing test only, not real classifier accuracy.
        var text = kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack
            ? Text("Số: 000000000000", "Họ và tên: NGƯỜI KIỂM THỬ", "Ngày sinh: 01/02/2000", "Ngày cấp: 01/02/2024")
            : Text(kind is OcrDocumentKind.MechanicalWater or OcrDocumentKind.DigitalWater ? "00123.45 m3" : "00123.45 kWh");
        var result = Route(text, new("classified", kind, "visual_model", .99f));
        Assert.Equal("classified", result.ClassificationStatus);
        Assert.Equal(OcrCategories.Name(kind), result.DetectedCategory);
        Assert.Equal(.99f, result.ClassificationConfidence);
        var identity = kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack;
        Assert.Equal(identity, result.IdentityProposal is not null);
        Assert.Equal(!identity, result.MeterProposal is not null);
        Assert.True((result.IdentityProposal ?? result.MeterProposal)!.RequiresConfirmation);
    }

    [Theory]
    [InlineData(.1f)]
    [InlineData(float.NaN)]
    [InlineData(float.PositiveInfinity)]
    [InlineData(1.01f)]
    public void InvalidOrLowVisualConfidenceIsExplicitlyAmbiguous(float confidence)
    {
        var result = Route(Text("123.45 kWh"), new("classified", OcrDocumentKind.DigitalElectricity, "visual_model", confidence));
        Assert.Equal("ambiguous", result.ClassificationStatus);
        Assert.Null(result.MeterProposal);
        Assert.Null(result.ClassificationConfidence);
    }

    [Fact]
    public void ContradictoryVisualKindMultipleMetersAndServiceFailureRequireReview()
    {
        Assert.Equal("ambiguous", Route(Front(), new("classified", OcrDocumentKind.DigitalWater, "visual_model", .99f)).ClassificationStatus);
        Assert.Equal("ambiguous", Route(Text(), new("classified", OcrDocumentKind.DigitalWater, "visual_model", .99f,
            [OcrDocumentKind.DigitalWater, OcrDocumentKind.DigitalWater], ["multiple_meters"])).ClassificationStatus);
        Assert.Equal("unavailable", Route(Text(), new("unavailable", null, "visual_model")).ClassificationStatus);
        Assert.Equal("unknown", Route(Text(), new("unknown", null, "visual_model")).ClassificationStatus);
    }
}
