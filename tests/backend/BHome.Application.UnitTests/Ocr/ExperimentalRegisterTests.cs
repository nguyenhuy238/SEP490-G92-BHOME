using BHome.Application.Ocr;

namespace BHome.Application.UnitTests.Ocr;

public sealed class ExperimentalRegisterTests
{
    private static OcrLine Line(string text, float x, float y, float width = 40, float height = 20) => new(text, .99f) { Bounds = new(x, y, width, height) };

    [Theory]
    [InlineData("0")]
    [InlineData("4")]
    [InlineData("8")]
    public void LegitimateSingleDigitWithSpatialUnitIsRetained(string digits)
    {
        var result = ExperimentalRegisterSelection.Select(OcrDocumentKind.DigitalElectricity,
            [Line(digits, 0, 0), Line("kWh", 45, 0)]);
        Assert.Equal(digits, result.Candidate?.Text);
        Assert.Contains("decimal_precision_unverified", result.Warnings);
    }

    [Fact] public void TimerFourIsNotAReading() => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity, [Line("4", 0, 0), Line("kWh", 45, 0), Line("COMPTEUR HORAIRE", 0, 30)]).Candidate);

    [Theory]
    [InlineData("V")]
    [InlineData("Hz")]
    [InlineData("m3/h")]
    [InlineData("Serial")]
    public void NonBillingEvidenceVetoesNumericText(string label) => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalWater, [Line("4", 0, 0), Line(label, 45, 0), Line("m3", 65, 0)]).Candidate);

    [Fact] public void CalibrationUnitSubstringDoesNotAuthorizeConsumption() => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity, [Line("4", 0, 0), Line("1000 imp/kWh", 45, 0)]).Candidate);

    [Fact] public void UnitsOnAnUnrelatedRowDoNotAuthorizeASerial() => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity, [Line("123456", 0, 200), Line("kWh", 45, 0)]).Candidate);

    [Fact] public void StatusCodeIsNotCleanedIntoConsumption() => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity, [Line("1.8.0", 0, 0), Line("kWh", 45, 0)]).Candidate);

    [Fact] public void TwoAccumulatedCandidatesRemainAmbiguous() => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity, [Line("12", 0, 0), Line("kWh", 45, 0), Line("13", 0, 100), Line("kWh", 45, 100)]).Candidate);

    [Fact]
    public void PhaseStatusRowCannotCompeteWithTheConsumptionRow()
    {
        var result=ExperimentalRegisterSelection.Select(OcrDocumentKind.DigitalElectricity,
            [Line("000501",80,0,180,60),Line("1.180",80,65,80,40),Line("L1",175,70,25,20),Line("kWh",225,70,50,20)]);
        Assert.Equal("000501",result.Candidate?.Text);
    }
    [Theory]
    [InlineData("L1")]
    [InlineData("L2")]
    [InlineData("L3")]
    [InlineData("status")]
    public void PhaseOrStatusOnlyScreenWithUnitStillRequiresReview(string label) => Assert.Null(ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity,[Line("1.180",0,0),Line(label,45,0),Line("kWh",70,0)]).Candidate);

    [Fact] public void DecimalValueIsNotSilentlyTreatedAsAnObisCode() => Assert.Equal("1.180",ExperimentalRegisterSelection.Select(
        OcrDocumentKind.DigitalElectricity,[Line("1.180",0,0),Line("kWh",45,0)]).Candidate?.Text);
}
