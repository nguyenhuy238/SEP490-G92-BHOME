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
    public Dictionary<OcrDocumentKind, ImageProfile> Profiles { get; set; } = Enum.GetValues<OcrDocumentKind>()
        .ToDictionary(x => x, _ => new ImageProfile());

    public bool IsValid() => MaxImageBytes is >= 1024 and <= 10 * 1024 * 1024 &&
        MaxPixels is >= 10000 and <= 20_000_000 && MaxDimension is >= 320 and <= 2048 &&
        TimeoutMilliseconds is >= 100 and <= 9000 && MaxConcurrency is >= 1 and <= 4 &&
        InferenceThreads is >= 1 and <= 4 && MaxTextRegions is >= 1 and <= 64 &&
        float.IsFinite(MeterDetectionMinConfidence) && MeterDetectionMinConfidence is > 0 and <= 1 &&
        float.IsFinite(AutomaticClassificationMinConfidence) && AutomaticClassificationMinConfidence is > 0 and <= 1 &&
        MeterDetector.IsValid() &&
        AutomaticProfile.ClockwiseQuarterTurns is >= 0 and <= 3 && AutomaticProfile.MinLaplacianVariance >= 0 &&
        Enum.GetValues<OcrDocumentKind>().All(x => Profiles.TryGetValue(x, out var p) &&
            p.ClockwiseQuarterTurns is >= 0 and <= 3 && p.MinLaplacianVariance >= 0);
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
