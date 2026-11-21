using BHome.Application.Ocr;

namespace BHome.Infrastructure.Ocr;

public sealed class OcrOptions
{
    public bool Enabled { get; set; }
    public string ModelDirectory { get; set; } = "/models";
    public int MaxImageBytes { get; set; } = 5 * 1024 * 1024;
    public int MaxPixels { get; set; } = 12_000_000;
    public int MaxDimension { get; set; } = 1600;
    public int TimeoutMilliseconds { get; set; } = 8000;
    public int MaxConcurrency { get; set; } = 1;
    public int InferenceThreads { get; set; } = 2;
    public int MaxTextRegions { get; set; } = 48;
    // Model threshold, not an accuracy claim. Calibrate against the selected detector.
    public float MeterDetectionMinConfidence { get; set; } = .8f;
    public float AutomaticClassificationMinConfidence { get; set; } = .9f;
    public ImageProfile AutomaticProfile { get; set; } = new();
    public YoloMeterOptions MeterDetector { get; set; } = new();
    public YoloCategoryOptions VisualClassifier { get; set; } = new();
    public ExperimentalMeterOptions ExperimentalMeter { get; set; } = new();
    public Dictionary<OcrDocumentKind, ImageProfile> Profiles { get; set; } = Enum.GetValues<OcrDocumentKind>()
        .ToDictionary(x => x, _ => new ImageProfile());

    public bool IsValid() => MaxImageBytes is >= 1024 and <= 10 * 1024 * 1024 &&
        MaxPixels is >= 10000 and <= 20_000_000 && MaxDimension is >= 320 and <= 2048 &&
        TimeoutMilliseconds is >= 100 and <= 9000 && MaxConcurrency is >= 1 and <= 4 &&
        InferenceThreads is >= 1 and <= 4 && MaxTextRegions is >= 1 and <= 64 &&
        float.IsFinite(MeterDetectionMinConfidence) && MeterDetectionMinConfidence is > 0 and <= 1 &&
        float.IsFinite(AutomaticClassificationMinConfidence) && AutomaticClassificationMinConfidence is > 0 and <= 1 &&
        MeterDetector.IsValid() && VisualClassifier.IsValid() && ExperimentalMeter.IsValid() &&
        (!ExperimentalMeter.Enabled || (MaxDimension == 1600 && AutomaticProfile.ClockwiseQuarterTurns == 0 &&
            !AutomaticProfile.EnhanceContrast && !AutomaticProfile.Denoise && !AutomaticProfile.Threshold)) &&
        (!VisualClassifier.Enabled || VisualClassifier.CandidateThreshold <= AutomaticClassificationMinConfidence) &&
        AutomaticProfile.ClockwiseQuarterTurns is >= 0 and <= 3 && AutomaticProfile.MinLaplacianVariance >= 0 &&
        Enum.GetValues<OcrDocumentKind>().All(x => Profiles.TryGetValue(x, out var p) &&
            p.ClockwiseQuarterTurns is >= 0 and <= 3 && p.MinLaplacianVariance >= 0);
}

public sealed class ExperimentalMeterOptions
{
    public bool Enabled { get; set; }
    public string ClassifierPath { get; set; } = "";
    public string ClassifierSha256 { get; set; } = "";
    public string EnglishModelDirectory { get; set; } = "";
    public float UtilityThreshold { get; set; } = .55f;
    public float TechnologyThreshold { get; set; } = .75f;
    public bool RefineUnitCrops { get; set; } = true;
    public OcrDocumentKind[] Categories { get; set; } = [];
    public bool IsValid() => float.IsFinite(UtilityThreshold) && UtilityThreshold is > 0 and <= 1 &&
        float.IsFinite(TechnologyThreshold) && TechnologyThreshold is > 0 and <= 1 &&
        Categories.Distinct().Count() == Categories.Length && Categories.All(c => c is OcrDocumentKind.MechanicalElectricity or
            OcrDocumentKind.DigitalElectricity or OcrDocumentKind.MechanicalWater or OcrDocumentKind.DigitalWater) &&
        (!Enabled || (!string.IsNullOrWhiteSpace(ClassifierPath) && ClassifierSha256.Length == 64 && ClassifierSha256.All(Uri.IsHexDigit) && !string.IsNullOrWhiteSpace(EnglishModelDirectory)));
}

// Experimental four-class YOLOv8 detect export, FP32/416/no embedded NMS.
// Disabled by default; the adapter additionally requires a Development host.
public sealed class YoloCategoryOptions
{
    public bool Enabled { get; set; }
    public string ModelPath { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public float CandidateThreshold { get; set; } = .25f;
    public float NmsThreshold { get; set; } = .45f;
    public bool IsValid() => float.IsFinite(CandidateThreshold) && CandidateThreshold is > 0 and <= 1 &&
        float.IsFinite(NmsThreshold) && NmsThreshold is > 0 and <= 1 &&
        (!Enabled || !string.IsNullOrWhiteSpace(ModelPath) && Sha256.Length == 64 && Sha256.All(Uri.IsHexDigit));
}

public sealed class YoloMeterOptions
{
    public bool Enabled { get; set; }
    public bool WaterDigitsEnabled { get; set; }
    public string ModelDirectory { get; set; } = "";
    public float ConfidenceThreshold { get; set; } = .5f;
    public float NmsThreshold { get; set; } = .7f;
    public bool IsValid() => ConfidenceThreshold is > 0 and <= 1 && NmsThreshold is > 0 and <= 1;
}

public sealed class ImageProfile
{
    // Optional corrections only; preserve colour unless measured evidence justifies a transform.
    public int ClockwiseQuarterTurns { get; set; }
    public bool EnhanceContrast { get; set; }
    public bool Denoise { get; set; }
    public bool Threshold { get; set; }
    public double MinLaplacianVariance { get; set; } = 15;
}
