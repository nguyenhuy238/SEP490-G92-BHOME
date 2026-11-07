using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class ExperimentalGeometryTests
{
    [Fact]
    public void ExperimentalConfigurationRequiresFrozenNeutralPreprocessing()
    {
        var options=new OcrOptions { ExperimentalMeter=new() { Enabled=true,
            ClassifierPath="classifier.onnx",ClassifierSha256=new string('0',64),EnglishModelDirectory="english",
            Categories=[BHome.Application.Ocr.OcrDocumentKind.DigitalElectricity] } };
        Assert.True(options.IsValid());
        options.MaxDimension=1280;Assert.False(options.IsValid());options.MaxDimension=1600;
        options.AutomaticProfile.EnhanceContrast=true;Assert.False(options.IsValid());
        options.ExperimentalMeter.Enabled=false;Assert.True(options.IsValid());
    }
    [Fact]
    public void RowMarginKeepsRealPixelsAndStopsAtAdjacentUnitRegion()
    {
        var row=new Rect(20,10,80,40);var unit=new Rect(110,10,40,40);
        var expanded=ExperimentalMeterRecognizer.ExpandNumericRow(row,[row,unit],new Size(200,100));
        Assert.Equal(0,expanded.Left);Assert.Equal(110,expanded.Right);Assert.Equal(row.Y,expanded.Y);Assert.Equal(row.Height,expanded.Height);
    }
    [Fact]
    public void AUnitOnAnotherRowDoesNotCutOffTheThinTerminalDigit()
    {
        var row=new Rect(20,10,80,40);var unit=new Rect(105,70,40,20);
        Assert.Equal(120,ExperimentalMeterRecognizer.ExpandNumericRow(row,[row,unit],new Size(200,100)).Right);
    }
    [Fact]
    public void BlankPixelsAreNotActiveAndRepeatedEightsAreNotAStringVeto()
    {
        using var image=new Mat(80,300,MatType.CV_8UC3,Scalar.White);
        Assert.False(ExperimentalMeterRecognizer.HasActiveInk(image));
        Cv2.PutText(image,"88888",new Point(5,60),HersheyFonts.HersheySimplex,1.5,Scalar.Black,3);
        Assert.True(ExperimentalMeterRecognizer.HasActiveInk(image));
    }
}
