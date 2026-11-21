using BHome.Application.Ocr;

namespace BHome.Application.UnitTests.Ocr;

public sealed class MeterReadingPrecisionTests
{
    private static OcrProposal Proposal(string value) => new(new Dictionary<string, string> { ["reading"] = value }, "synthetic")
    { Confidence = new Dictionary<string, float> { ["reading"] = .95f }, SourceImageHash = "synthetic-hash" };

    [Theory]
    [InlineData("032514", 1, "03251.4")]
    [InlineData("00012345", 2, "000123.45")]
    [InlineData("00005", 4, "0.0005")]
    [InlineData("00123.45", 2, "00123.45")]
    [InlineData("000123", 0, "000123")]
    public void ConfiguredDisplayPrecisionPreservesAllDigitsAndDoesNotRound(string raw, int precision, string expected)
    {
        var proposal = MeterReadingPrecision.Apply(Proposal(raw), precision);
        Assert.Equal(expected, proposal.ProposedFields["reading"]);
        Assert.Equal(.95f, proposal.Confidence["reading"]);
        Assert.Equal("synthetic-hash", proposal.SourceImageHash);
        Assert.True(proposal.RequiresConfirmation);
    }

    [Theory]
    [InlineData("123.45", 1)]
    [InlineData("123.45", 0)]
    [InlineData("12", 3)]
    public void ConflictingOrIncompletePrecisionIsNotSilentlyRescaledOrTruncated(string raw, int precision)
    {
        var proposal = MeterReadingPrecision.Apply(Proposal(raw), precision);
        Assert.Empty(proposal.ProposedFields);
        Assert.Empty(proposal.Confidence);
        Assert.Contains("reading", proposal.MissingFields);
        Assert.Contains("meter_precision_mismatch", proposal.Warnings);
        Assert.True(proposal.IsFallback);
    }

    [Fact]
    public void MissingConfigurationNeverAssumesLastDigitIsFractional()
    {
        var proposal = MeterReadingPrecision.Apply(Proposal("032514"), null);
        Assert.Equal("032514", proposal.ProposedFields["reading"]);
        Assert.Contains("decimal_separator_unverified", proposal.Warnings);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(5)]
    public void InvalidConfigurationIsRejected(int precision) => Assert.Throws<OcrInputException>(() => MeterReadingPrecision.Apply(Proposal("123"), precision));
}
