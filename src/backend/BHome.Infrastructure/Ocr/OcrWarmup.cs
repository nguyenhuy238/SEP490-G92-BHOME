using BHome.Application.Ocr;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.Ocr;

// Load/check models before the HTTP listener accepts images, outside the request deadline.
internal sealed class OcrWarmup(OcrOptions options, Lazy<IOcrEngine> engine, IMeterSceneDetector meterDetector, YoloWaterDigitRecognizer waterDigits) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (options.Enabled) { _ = engine.Value; meterDetector.Warmup(cancellationToken); }
        if (options.Enabled && options.MeterDetector.Enabled && options.MeterDetector.WaterDigitsEnabled) waterDigits.Warmup(cancellationToken);
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
