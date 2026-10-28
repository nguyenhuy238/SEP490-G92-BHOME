using System.Security.Cryptography;
using BHome.Application.Common;
using BHome.Application.Ocr;
using Microsoft.Extensions.Logging;

namespace BHome.Infrastructure.Ocr;

// Singleton: bounds the entire read/preprocess/inference pipeline, including queued requests.
public sealed class LocalOcrService : IOcrService, IDisposable
{
    private readonly OcrOptions options;
    private readonly Lazy<IOcrEngine> engine;
    private readonly ILogger<LocalOcrService> logger;
    private readonly SemaphoreSlim slots;

    public LocalOcrService(OcrOptions options, Lazy<IOcrEngine> engine, ILogger<LocalOcrService> logger)
    {
        this.options = options; this.engine = engine; this.logger = logger;
        slots = new SemaphoreSlim(options.MaxConcurrency, options.MaxConcurrency);
    }

    public Task<OcrProposal> ExtractAsync(Stream temporaryInput, OcrInputKind kind, CancellationToken cancellationToken)
        => ExtractAsync(temporaryInput, kind switch
        {
            OcrInputKind.IdentityCard => OcrDocumentKind.IdentityFront,
            OcrInputKind.MeterReading => OcrDocumentKind.DigitalElectricity,
            _ => throw new OcrInputException("unsupported_profile")
        }, cancellationToken);

    public async Task<OcrProposal> ExtractAsync(Stream temporaryInput, OcrDocumentKind kind, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!options.Enabled) throw new IntegrationUnavailableException("internal OCR");
        if (!Enum.IsDefined(kind)) throw new OcrInputException("unsupported_profile");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.TimeoutMilliseconds);
        var entered = false;
        byte[]? buffer = null;
        try
        {
            // Do not build an unbounded queue of images in managed memory.
            entered = await slots.WaitAsync(0, timeout.Token);
            if (!entered) return Fallback("ocr_busy");
            // Session initialization occurs once. Deployment warmup must precede accepting uploads.
            var readyEngine = engine.Value;
            buffer = new byte[options.MaxImageBytes + 1];
            var length = 0;
            while (length < buffer.Length)
            {
                var read = await temporaryInput.ReadAsync(buffer.AsMemory(length), timeout.Token);
                if (read == 0) break;
                length += read;
            }
            ImagePreprocessor.ValidateHeader(buffer.AsSpan(0, length), options.MaxImageBytes, options.MaxPixels);
            var text = await readyEngine.RecognizeAsync(buffer.AsMemory(0, length), kind, timeout.Token);
            timeout.Token.ThrowIfCancellationRequested();
            var proposal = OcrFieldParser.Parse(text, kind);
            return kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack ? proposal :
                proposal with { SourceImageHash = Convert.ToHexString(SHA256.HashData(buffer.AsSpan(0, length))) };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { return Fallback("ocr_timeout"); }
        catch (OcrInputException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception) when (exception is IOException or InvalidDataException or
            Microsoft.ML.OnnxRuntime.OnnxRuntimeException or OpenCvSharp.OpenCVException or
            TypeInitializationException or DllNotFoundException or BadImageFormatException)
        {
            // Do not attach exception messages, model paths, text or images to telemetry.
            logger.LogWarning("Internal OCR unavailable ({ErrorType}); manual entry required", exception.GetType().Name);
            return Fallback("ocr_unavailable");
        }
        finally
        {
            if (buffer is not null) CryptographicOperations.ZeroMemory(buffer);
            if (entered) slots.Release();
        }
    }

    private static OcrProposal Fallback(string code) => new(new Dictionary<string, string>(), OnnxOcrEngine.Version)
    { IsFallback = true, Warnings = [code] };

    public void Dispose() => slots.Dispose();
}
