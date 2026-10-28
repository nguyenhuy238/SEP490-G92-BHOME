using BHome.Application.Ocr;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.Ocr;

// Load/check models before the HTTP listener accepts images, outside the request deadline.
internal sealed class OcrWarmup(OcrOptions options, Lazy<IOcrEngine> engine) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (options.Enabled) _ = engine.Value;
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
