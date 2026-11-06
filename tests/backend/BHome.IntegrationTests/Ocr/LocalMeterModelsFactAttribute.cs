namespace BHome.IntegrationTests.Ocr;

// Explicit opt-in: public model artifacts/fixtures are provisioned offline, never
// downloaded implicitly by tests or replaced with fake inference.
public sealed class LocalMeterModelsFactAttribute : FactAttribute
{
    public LocalMeterModelsFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")))
            Skip = "Set BHOME_OCR_LOCAL_EVALUATION_ROOT after provisioning pinned public model evaluation artifacts.";
    }
}
